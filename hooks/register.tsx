import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { App, Device, Screen, Shot } from '../types'
import { filterLog, fit, parseApp, parseDevices, parseSize, readCommand } from './simctl'

const PANE = 'simpane'
const TITLE = 'Simulator'
const COMMAND = 'simpane'
// Patterns, since the mod's own tools are not among the tools the type declarations list.
const SCREENSHOT_TOOL = /^mcp__simpane__screenshot$/
const LOGS_TOOL = /^mcp__simpane__logs$/
const SET_TOOL = /^mcp__simpane__set$/
const XCODE_MCP_TOOL = /^mcp__.+__(BuildProject|RunAllTests|RunSomeTests)$/
/** The longest side, in pixels, of the copy the pane draws and Claude reads. */
const SMALL_SIDE = 1000
const SETTLE_MS = 1500
const PANE_LOG_LINES = 14
const TOOL_LOG_LINES = 150
const APPLE_PROJECT = /\.(xcodeproj|xcworkspace)$|^(Package\.swift|project\.yml|Project\.swift|Podfile)$/
const TEXT_SIZES = [
  'extra-small', 'small', 'medium', 'large', 'extra-large', 'extra-extra-large', 'extra-extra-extra-large',
  'accessibility-medium', 'accessibility-large', 'accessibility-extra-large', 'accessibility-extra-extra-large', 'accessibility-extra-extra-extra-large',
]
const EMPTY: Screen = { status: 'unknown', device: null, devices: [], candidates: [], shot: null, appearance: '', textSize: '', app: null }

const screen = atom({ plugin: 'simpane', key: 'screen' } as const, EMPTY)
const isLive = atom({ plugin: 'simpane', key: 'isLive' } as const, true)
const logs = atom({ plugin: 'simpane', key: 'logs' } as const, null)
const isBusy = atom({ plugin: 'simpane', key: 'isBusy' } as const, false)

/** What cannot be kept in `$.state`: which simulator and app the person or Claude last pointed at. */
const chosen = { udid: null as string | null, bundleId: null as string | null, hasTools: false }

/** Runs a command and answers its output, or null when it failed or could not start. */
const run = async ($: EngineInterface, argv: readonly string[], timeoutMs = 20_000) => {
  try {
    const ran = await $.process.run(argv, { timeoutMs })

    return ran.exitCode === 0 ? ran.stdout : null
  } catch {
    return null
  }
}

const simctl = ($: EngineInterface, args: readonly string[], timeoutMs?: number) => run($, ['xcrun', 'simctl', ...args], timeoutMs)

const folder = async ($: EngineInterface) => `${((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')}/simpane`

/** Takes a screenshot of `device` and makes the scaled copy the pane draws. */
const capture = async ($: EngineInterface, device: Device): Promise<Shot | null> => {
  const dir = await folder($)
  const path = `${dir}/${device.udid}.png`
  const smallPath = `${dir}/${device.udid}-small.png`
  await run($, ['/bin/mkdir', '-p', dir])

  if ((await simctl($, ['io', device.udid, 'screenshot', '--type=png', path])) === null) {
    return null
  }

  const scaled = await run($, ['/usr/bin/sips', '-Z', String(SMALL_SIDE), path, '--out', smallPath])
  const size = parseSize((await run($, ['/usr/bin/sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path])) ?? '')
  const at = await $.clock.now()

  return { path, smallPath: scaled === null ? path : smallPath, width: size?.width ?? 0, height: size?.height ?? 0, at, generation: at }
}

const appOf = async ($: EngineInterface, device: Device): Promise<App | null> => {
  const [running, installed] = await Promise.all([
    simctl($, ['spawn', device.udid, 'launchctl', 'list']),
    run($, ['/bin/sh', '-c', 'xcrun simctl listapps "$1" | plutil -convert json -o - -', 'sh', device.udid]),
  ])

  return running === null || installed === null ? null : parseApp(running, installed, chosen.bundleId)
}

/** Declares the tools Claude can use, the first time a simulator is seen: a session with none pays nothing for them. */
const offerTools = async ($: EngineInterface) => {
  if (chosen.hasTools) {
    return
  }

  chosen.hasTools = true
  await $.tool.register({
    name: 'screenshot',
    description:
      'Takes a screenshot of the booted iOS Simulator and answers the path of the PNG, with the device, its appearance, text size and the app in front. Read the file at that path to see the screen. Call it after a change to the UI to check how it looks, instead of asking the user to describe it.',
    inputSchema: {
      type: 'object',
      properties: { size: { type: 'string', enum: ['small', 'full'], description: 'small (default): scaled to 1000 pixels, cheaper to read. full: the device resolution.' } },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'logs',
    description:
      "Answers what the app in front of the booted iOS Simulator logged lately: its own messages (print, NSLog, os_log, Logger) and every error or fault in its process, with system chatter removed and repeats folded. Call it when the app misbehaves or crashes, instead of reading the device's whole log.",
    inputSchema: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'How far back to read, 60 by default, 600 at most.' },
        contains: { type: 'string', description: 'Keep only lines containing this text, compared without case.' },
        bundleId: { type: 'string', description: "The app's bundle identifier; the app in front by default." },
      },
    },
  })
  await $.tool.register({
    name: 'set',
    description:
      'Changes how the booted iOS Simulator looks, then answers a fresh screenshot path: light or dark appearance, Dynamic Type text size, a clean 9:41 status bar for store screenshots, or a URL to open (a deep link or a web page). Use it to check a screen in dark mode or at accessibility text sizes.',
    inputSchema: {
      type: 'object',
      properties: {
        appearance: { type: 'string', enum: ['light', 'dark'] },
        textSize: { type: 'string', enum: [...TEXT_SIZES, 'increment', 'decrement'] },
        statusBar: { type: 'string', enum: ['clean', 'default'] },
        openUrl: { type: 'string' },
      },
    },
  })
}

/** Reads the simulators and, when one is booted, its screen, its settings and the app in front. */
const look = async ($: EngineInterface): Promise<Screen> => {
  const listed = await simctl($, ['list', 'devices', '-j'])

  if (listed === null) {
    const none: Screen = { ...EMPTY, status: 'unavailable' }
    await update($, screen, () => none)

    return none
  }

  const devices = parseDevices(listed, 'Booted')
  const device = devices.find(one => one.udid === chosen.udid) ?? devices[0]

  if (device === undefined) {
    const none: Screen = { ...EMPTY, status: 'absent', candidates: parseDevices(listed, 'Shutdown').filter(one => /^i(Phone|Pad)/.test(one.name)).slice(0, 3) }
    await update($, screen, () => none)

    return none
  }

  chosen.udid = device.udid
  await offerTools($).catch(() => undefined)
  const [shot, appearance, textSize, app] = await Promise.all([
    capture($, device),
    simctl($, ['ui', device.udid, 'appearance']),
    simctl($, ['ui', device.udid, 'content_size']),
    appOf($, device),
  ])
  const seen: Screen = {
    status: 'ready',
    device,
    devices,
    candidates: [],
    shot,
    appearance: (appearance ?? '').trim(),
    textSize: (textSize ?? '').trim(),
    app,
  }
  await update($, screen, () => seen)

  return seen
}

/** `look`, one at a time: a refresh asked for while one runs is dropped, since that one is already fresh. */
const refresh = async ($: EngineInterface): Promise<Screen> => {
  if (await read($, isBusy)) {
    return read($, screen)
  }

  await update($, isBusy, () => true)

  try {
    return await look($)
  } finally {
    await update($, isBusy, () => false).catch(() => undefined)
  }
}

const appLogs = async ($: EngineInterface, device: Device, app: App, seconds: number, contains: string | null) => {
  const predicate = `process == "${app.executable.replace(/["\\]/g, '')}" AND (NOT subsystem BEGINSWITH "com.apple." OR messageType == error OR messageType == fault)`
  const raw = await simctl($, ['spawn', device.udid, 'log', 'show', '--last', `${seconds}s`, '--style', 'compact', '--predicate', predicate], 60_000)

  return raw === null ? null : filterLog(raw, app.executable, contains)
}

/** `iPhone 17 · iOS 27.0 · dark · text large`. */
const headline = (seen: Screen) =>
  [seen.device?.name, seen.device?.runtime, seen.appearance, seen.textSize === '' ? '' : `text ${seen.textSize}`].filter(Boolean).join(' · ')

/** What a tool answers after looking: where the picture is and what is on screen. */
const described = (seen: Screen, size: 'small' | 'full') => {
  if (seen.status === 'unavailable') {
    return "simpane could not run `xcrun simctl`: it needs macOS with Xcode's command line tools."
  }

  if (seen.device === null) {
    return 'No simulator is booted. Boot one with `xcrun simctl boot <device>` or from Xcode, then call this again.'
  }

  if (seen.shot === null) {
    return `${headline(seen)}: the screenshot could not be taken.`
  }

  const path = size === 'full' ? seen.shot.path : seen.shot.smallPath
  const front = seen.app === null ? 'None of your own apps is running.' : `App in front: ${seen.app.name} (${seen.app.bundleId}).`

  return [`${headline(seen)}. ${front}`, `Screenshot (${seen.shot.width}×${seen.shot.height} on the device): ${path}`, 'Read that file to see the screen.'].join('\n')
}

const openPane = ($: EngineInterface) => {
  void $.ui.open({ id: PANE, title: TITLE, columns: 46 }).catch(() => undefined)
}

/** The timer that keeps the picture fresh, while there is one. */
const timer: { ticker: { cancel: () => void } | null } = { ticker: null }

const unwatch = () => {
  timer.ticker?.cancel()
  timer.ticker = null
}

/** Keeps the picture fresh while the pane is on screen and Live is on. */
const watch = ($: EngineInterface, every: number) => {
  if (timer.ticker !== null || every === 0) {
    return
  }

  timer.ticker = $.clock.every(every, () => {
    void (async () => {
      const [pane] = (await $.ui.panes()).filter(one => one.id === PANE)

      if (pane === undefined) {
        unwatch()
      } else if (pane.isShown && pane.isPlaced && (await read($, isLive))) {
        await refresh($)
      }
    })().catch(() => undefined)
  })
}

export const register: Register = (on, options) => {
  const every = options.refresh === 'off' ? 0 : Number(options.refresh ?? 2) * 1000 || 2000
  const autoOpen = options.autoOpen !== false
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show the iOS Simulator beside the session: live screenshot, appearance, text size, app logs',
    })
    // In an Apple project Claude has the tools from the first prompt; elsewhere they wait until a simulator is seen.
    const entries = await $.fs.list().catch(() => [])

    if (entries.some(one => APPLE_PROJECT.test(one.name))) {
      await offerTools($).catch(() => undefined)
    }

    // A pane left open across a reload keeps being refreshed.
    const panes = await $.ui.panes().catch(() => [])

    if (panes.some(one => one.id === PANE)) {
      watch($, every)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    await $.ui.open({ id: PANE, title: TITLE, columns: 46 })
    const seen = await refresh($)
    watch($, every)

    if (seen.status === 'unavailable') {
      return { text: "simpane needs macOS with Xcode's command line tools: `xcrun simctl` could not be run." }
    }

    return { text: seen.device === null ? 'Simulator pane opened. No simulator is booted.' : `Simulator pane opened: ${headline(seen)}.` }
  })

  on('ui.close', { id: PANE }, ($, e, next) => {
    unwatch()

    return next(e)
  })

  on('tool.call', { tool: SCREENSHOT_TOOL }, async ($, e) => {
    const size = (e as { size?: unknown }).size === 'full' ? 'full' : 'small'

    return { result: described(await look($), size) }
  })

  on('tool.call', { tool: LOGS_TOOL }, async ($, e) => {
    const asked = e as { seconds?: unknown; contains?: unknown; bundleId?: unknown }
    const seconds = Math.min(600, Math.max(5, typeof asked.seconds === 'number' && Number.isFinite(asked.seconds) ? Math.round(asked.seconds) : 60))

    if (typeof asked.bundleId === 'string' && asked.bundleId !== '') {
      chosen.bundleId = asked.bundleId
    }

    const seen = await look($)

    if (seen.device === null) {
      return { result: described(seen, 'small') }
    }

    if (seen.app === null) {
      return { result: 'None of your own apps is running in the simulator, so there is no app log to read. Launch the app, then call this again.' }
    }

    const lines = await appLogs($, seen.device, seen.app, seconds, typeof asked.contains === 'string' && asked.contains !== '' ? asked.contains : null)

    if (lines === null) {
      return { result: `The log of ${seen.device.name} could not be read.` }
    }

    const shown = lines.slice(-TOOL_LOG_LINES)
    const head = `${seen.app.name} (${seen.app.bundleId}) on ${seen.device.name}, last ${seconds}s: ${lines.length} line${lines.length === 1 ? '' : 's'} of its own${lines.length > shown.length ? `, the last ${shown.length} shown` : ''}.`

    return { result: lines.length === 0 ? `${head} Nothing logged by the app and no errors in its process.` : [head, ...shown].join('\n') }
  })

  on('tool.call', { tool: SET_TOOL }, async ($, e) => {
    const asked = e as { appearance?: unknown; textSize?: unknown; statusBar?: unknown; openUrl?: unknown }
    const before = await read($, screen)
    const device = before.device ?? (await look($)).device

    if (device === null) {
      return { result: described(await read($, screen), 'small') }
    }

    const done: string[] = []
    const apply = async (what: string, args: readonly string[]) => {
      done.push((await simctl($, args)) === null ? `${what}: failed` : what)
    }

    if (asked.appearance === 'light' || asked.appearance === 'dark') {
      await apply(`appearance ${asked.appearance}`, ['ui', device.udid, 'appearance', asked.appearance])
    }

    if (typeof asked.textSize === 'string' && [...TEXT_SIZES, 'increment', 'decrement'].includes(asked.textSize)) {
      await apply(`text size ${asked.textSize}`, ['ui', device.udid, 'content_size', asked.textSize])
    }

    if (asked.statusBar === 'clean') {
      await apply('clean status bar', ['status_bar', device.udid, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3'])
    } else if (asked.statusBar === 'default') {
      await apply('default status bar', ['status_bar', device.udid, 'clear'])
    }

    if (typeof asked.openUrl === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(asked.openUrl)) {
      await apply(`opened ${asked.openUrl}`, ['openurl', device.udid, asked.openUrl])
    }

    if (done.length === 0) {
      return { result: 'Nothing to change: name an appearance, a text size, a status bar or a URL.' }
    }

    await $.clock.sleep(SETTLE_MS).catch(() => undefined)

    return { result: [`Done: ${done.join(', ')}.`, described(await look($), 'small')].join('\n') }
  })

  // A command that changes what the simulator shows is followed by a fresh look, once the screen has settled.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const { changesScreen, launched } = readCommand(e.command)
    const ran = await next(e)

    if (changesScreen && ran.deny === undefined) {
      chosen.bundleId = launched ?? chosen.bundleId
      $.clock.after(SETTLE_MS, () => {
        void (async () => {
          const seen = await refresh($)

          if (autoOpen && seen.device !== null) {
            openPane($)
            watch($, every)
          }
        })().catch(() => undefined)
      })
    }

    return ran
  })

  on('tool.call', { tool: XCODE_MCP_TOOL }, async ($, e, next) => {
    const ran = await next(e)
    $.clock.after(SETTLE_MS, () => {
      void refresh($).catch(() => undefined)
    })

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const seen = await read($, screen)
    const live = await read($, isLive)
    const lines = await read($, logs)

    if (e.surface === 'terminal') {
      const { Box, Button, Image, Text } = $.ui.resolve(e)
      const room = { columns: Math.max(8, e.props.bodyColumns - 1), rows: Math.max(6, (e.viewport?.rows ?? 40) - (lines === null ? 9 : 9 + PANE_LOG_LINES)) }
      const box = seen.shot === null || seen.shot.width === 0 ? null : fit(seen.shot.width, seen.shot.height, room)

      return (
        <Box flexDirection="column">
          {seen.status === 'unavailable' && <Text dimColor>simpane needs macOS with Xcode's command line tools.</Text>}
          {seen.status === 'unknown' && <Text dimColor>Looking for a booted simulator…</Text>}
          {seen.status === 'absent' && (
            <Box flexDirection="column">
              <Text dimColor>No simulator is booted.</Text>
              {seen.candidates.map((device, at) => (
                <Button
                  key={`boot-${device.udid}`}
                  hotkey={String(at + 1)}
                  plain
                  label={`Boot ${device.name} (${device.runtime})`}
                  onPress={async () => {
                    chosen.udid = device.udid
                    await simctl($, ['boot', device.udid], 120_000)
                    await simctl($, ['bootstatus', device.udid], 180_000)
                    await refresh($)
                  }}
                />
              ))}
              <Button key="refresh" hotkey="r" plain label="Look again" onPress={() => refresh($)} />
            </Box>
          )}
          {seen.status === 'ready' && (
            <Box flexDirection="column">
              <Text bold>{seen.device?.name ?? ''}</Text>
              <Text dimColor>{[seen.device?.runtime, seen.appearance, seen.textSize === '' ? '' : `text ${seen.textSize}`].filter(Boolean).join(' · ')}</Text>
              {seen.shot !== null && box !== null && (
                <Image
                  key="screen"
                  source={{ file: seen.shot.smallPath, format: 'png', generation: seen.shot.generation }}
                  columns={box.columns}
                  rows={box.rows}
                  alt={`Screenshot saved to ${seen.shot.path}`}
                />
              )}
              {seen.shot === null && <Text color="warning">The screenshot could not be taken.</Text>}
              <Text dimColor>{seen.app === null ? 'None of your own apps is running.' : `${seen.app.name} · ${seen.app.bundleId}`}</Text>
              <Box flexDirection="row" gap={2} flexWrap="wrap" marginTop={1}>
                <Button key="refresh" hotkey="r" plain label="Refresh" onPress={() => refresh($)} />
                <Button key="live" hotkey="l" plain label={live ? 'Live on' : 'Live off'} onPress={() => update($, isLive, lives => !lives)} />
                <Button
                  key="appearance"
                  hotkey="a"
                  plain
                  label={seen.appearance === 'dark' ? 'Light' : 'Dark'}
                  onPress={async () => {
                    await simctl($, ['ui', seen.device?.udid ?? 'booted', 'appearance', seen.appearance === 'dark' ? 'light' : 'dark'])
                    await refresh($)
                  }}
                />
                <Button
                  key="bigger"
                  hotkey="u"
                  plain
                  label="Text +"
                  onPress={async () => {
                    await simctl($, ['ui', seen.device?.udid ?? 'booted', 'content_size', 'increment'])
                    await refresh($)
                  }}
                />
                <Button
                  key="smaller"
                  hotkey="d"
                  plain
                  label="Text −"
                  onPress={async () => {
                    await simctl($, ['ui', seen.device?.udid ?? 'booted', 'content_size', 'decrement'])
                    await refresh($)
                  }}
                />
              </Box>
              <Box flexDirection="row" gap={2} flexWrap="wrap">
                <Button
                  key="send"
                  hotkey="s"
                  plain
                  label="Send to Claude"
                  onPress={async () => {
                    const fresh = await refresh($)

                    if (fresh.shot !== null) {
                      await $.prompt.fill({ text: `Look at the simulator screenshot at ${fresh.shot.smallPath} `, mode: 'insert' })
                    }
                  }}
                />
                <Button
                  key="logs"
                  hotkey="g"
                  plain
                  label={lines === null ? 'Logs' : 'Hide logs'}
                  onPress={async () => {
                    if (lines !== null || seen.device === null || seen.app === null) {
                      await update($, logs, () => null)
                    } else {
                      await update($, logs, () => ['Reading…'])
                      const found = await appLogs($, seen.device, seen.app, 60, null)
                      await update($, logs, () => found ?? ['The log could not be read.'])
                    }
                  }}
                />
                {seen.devices.length > 1 && (
                  <Button
                    key="device"
                    hotkey="n"
                    plain
                    label="Next device"
                    onPress={async () => {
                      const at = seen.devices.findIndex(one => one.udid === seen.device?.udid)
                      chosen.udid = seen.devices[(at + 1) % seen.devices.length]?.udid ?? null
                      await refresh($)
                    }}
                  />
                )}
              </Box>
              {lines !== null && (
                <Box flexDirection="column" marginTop={1}>
                  <Text bold>{`Logs · last minute${seen.app === null ? '' : ` · ${seen.app.name}`}`}</Text>
                  {lines.length === 0 && <Text dimColor>Nothing logged by the app.</Text>}
                  {lines.slice(-PANE_LOG_LINES).map(line => (
                    <Text wrap="truncate-end" color={/ (error|fault): /.test(line) ? 'error' : undefined}>
                      {line.split('\n')[0] ?? ''}
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      )
    }

    // Other surfaces draw no pictures from a file: the facts and the path stand in.
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {seen.status === 'unavailable' && <Text dimColor>simpane needs macOS with Xcode's command line tools.</Text>}
        {(seen.status === 'absent' || seen.status === 'unknown') && <Text dimColor>No simulator is booted.</Text>}
        {seen.status === 'ready' && (
          <Box flexDirection="column">
            <Text bold>{seen.device?.name ?? ''}</Text>
            <Text dimColor>{[seen.device?.runtime, seen.appearance, seen.textSize === '' ? '' : `text ${seen.textSize}`].filter(Boolean).join(' · ')}</Text>
            <Text dimColor>{seen.app === null ? 'None of your own apps is running.' : `${seen.app.name} · ${seen.app.bundleId}`}</Text>
            {seen.shot !== null && <Text>{`Screenshot: ${seen.shot.path}`}</Text>}
            <Text dimColor>The live picture is drawn in a terminal that shows images (Ghostty, kitty). Ask Claude to look at the simulator from here.</Text>
          </Box>
        )}
      </Box>
    )
  })
}
