import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { APPS, DEVICES, LAUNCHCTL, LOG, NO_BOOTED, SIPS } from './fixtures'

const PLUGIN = 'simpane'
const UDID = 'E4A103F5-F2F5-4BBA-98BC-2246BC8E63F5'
const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: 'simpane',
  props: {
    title: 'Simulator',
    isFocused: false,
    bodyColumns: 46,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
  viewport: { columns: 180, rows: 40 },
} as const

type World = {
  /** The names in the session's folder. */
  entries?: string[]
  /** What `simctl list devices -j` prints; null when `xcrun` cannot be run at all. */
  devices?: string | null
  appearance?: string
}

const callTool = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never) as Promise<{ result?: unknown; isError?: true }>

const slash = ($: Engine) => $.command.run({ command: PLUGIN, args: '' } as never) as Promise<{ text?: string }>

const world = (on: On, { devices = DEVICES, appearance = 'light', entries = [] }: World = {}) => {
  const seen = {
    ran: [] as string[],
    opened: [] as string[],
    tools: [] as string[],
    filled: [] as string[],
    appearance,
    textSize: 'large',
    bash: [] as string[],
  }
  const clock = mock.clock(on, { now: 5_000 })
  mock.env(on, { TMPDIR: '/tmp/t/' })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => {
    seen.tools.push(e.name)

    return { value: { tool: `mcp__${PLUGIN}__${e.name}` } }
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('fs.list', () => ({ value: entries.map(name => ({ name, isDirectory: name.endsWith('.xcodeproj') })) as never }))
  on('prompt.fill', (_$, e) => {
    seen.filled.push(e.text)

    return { isFilled: true as const }
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    seen.bash.push(e.command)

    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  on('process.run', (_$, e) => {
    const line = e.argv.join(' ')
    const args = e.argv[0] === 'xcrun' ? e.argv.slice(2) : e.argv
    const answer = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    seen.ran.push(line.replaceAll(UDID, 'UDID'))

    if (devices === null && e.argv[0] === 'xcrun') {
      throw new Error('spawn xcrun ENOENT')
    }

    if (args[0] === 'list') {
      return answer(devices ?? '')
    }

    if (args[0] === 'ui' && args[2] === 'appearance') {
      seen.appearance = args[3] ?? seen.appearance

      return answer(`${seen.appearance}\n`)
    }

    if (args[0] === 'ui' && args[2] === 'content_size') {
      seen.textSize = args[3] === 'increment' ? 'extra-large' : args[3] === 'decrement' ? 'medium' : (args[3] ?? seen.textSize)

      return answer(`${seen.textSize}\n`)
    }

    if (line.includes('launchctl list')) {
      return answer(LAUNCHCTL)
    }

    if (line.includes('listapps')) {
      return answer(APPS)
    }

    if (line.includes('log show')) {
      return answer(LOG)
    }

    return answer(line.includes('pixelWidth') ? SIPS : '')
  })

  return { seen, clock }
}

test('/simpane opens the pane on the booted simulator with its screenshot, settings and app', async ($, on) => {
  const { seen } = world(on)

  expect((await slash($)).text).toBe('Simulator pane opened: iPhone 17 · iOS 27.0 · light · text large.')
  expect(seen.opened).toEqual(['simpane'])
  expect(seen.ran).toContain('xcrun simctl io UDID screenshot --type=png /tmp/t/simpane/UDID.png')
  expect(seen.ran).toContain('/usr/bin/sips -Z 1000 /tmp/t/simpane/UDID.png --out /tmp/t/simpane/UDID-small.png')
  expect(seen.tools).toEqual(['screenshot', 'logs', 'set'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'iPhone 17' })).toMatchObject({ props: { bold: true } })
  expect(await ui.find({ type: 'Text', text: 'iOS 27.0 · light · text large' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Tideline · mobi.bouncingball.Tideline' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toMatchObject({
    props: {
      source: { file: `/tmp/t/simpane/${UDID}-small.png`, format: 'png', generation: 5_000 },
      columns: 29,
      rows: 30,
      alt: `Screenshot saved to /tmp/t/simpane/${UDID}.png`,
    },
  })
  await ui.unmount()
})

test('the pane switches appearance and text size, and sends the screenshot to the prompt', async ($, on) => {
  const { seen } = world(on)
  await slash($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ key: 'appearance' })).toMatchObject({ props: { label: 'Dark' } })
  await ui.press({ key: 'appearance' })
  expect(seen.ran).toContain('xcrun simctl ui UDID appearance dark')
  expect(await ui.find({ key: 'appearance' })).toMatchObject({ props: { label: 'Light' } })
  expect(await ui.find({ type: 'Text', text: 'iOS 27.0 · dark · text large' })).toBeDefined()

  await ui.press({ key: 'bigger' })
  expect(await ui.find({ type: 'Text', text: 'iOS 27.0 · dark · text extra-large' })).toBeDefined()

  await ui.press({ key: 'send' })
  expect(seen.filled).toEqual([`Look at the simulator screenshot at /tmp/t/simpane/${UDID}-small.png `])

  await ui.press({ key: 'live' })
  expect(await ui.find({ key: 'live' })).toMatchObject({ props: { label: 'Live off' } })
  await ui.unmount()
})

test("the pane shows the app's own log on request", async ($, on) => {
  world(on)
  await slash($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'logs' })
  expect(await ui.find({ type: 'Text', text: 'Logs · last minute · Tideline' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /redraw \(×3\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /fault: Fatal error: Index out of range/ })).toMatchObject({ props: { color: 'error' } })
  expect(await ui.find({ type: 'Text', text: /libMobileGestalt/ })).toBeUndefined()

  await ui.press({ key: 'logs' })
  expect(await ui.find({ type: 'Text', text: /redraw/ })).toBeUndefined()
  await ui.unmount()
})

test('with no simulator booted the pane offers the last ones used, and no tools are declared', async ($, on) => {
  const { seen } = world(on, { devices: NO_BOOTED })

  expect((await slash($)).text).toBe('Simulator pane opened. No simulator is booted.')
  expect(seen.tools).toEqual([])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'No simulator is booted.' })).toBeDefined()
  expect(await ui.find({ key: `boot-${UDID}` })).toMatchObject({ props: { label: 'Boot iPhone 17 (iOS 27.0)' } })
  await ui.press({ key: `boot-${UDID}` })
  expect(seen.ran).toContain('xcrun simctl boot UDID')
  await ui.unmount()
})

test('where xcrun cannot be run the pane says what is needed', async ($, on) => {
  world(on, { devices: null })

  expect((await slash($)).text).toBe("simpane needs macOS with Xcode's command line tools: `xcrun simctl` could not be run.")
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /needs macOS with Xcode's command line tools/ })).toBeDefined()
    await ui.unmount()
  }
})

test('surfaces that draw no pictures show the facts and the path', async ($, on) => {
  world(on)
  await slash($)

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'iPhone 17' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: `Screenshot: /tmp/t/simpane/${UDID}.png` })).toBeDefined()
    await ui.unmount()
  }
})

test('the screenshot tool answers the path and what is on screen', async ($, on) => {
  world(on)
  await slash($)

  const small = await callTool($, { tool: 'mcp__simpane__screenshot', tool_use_id: 'toolu_1' })
  expect(small.result).toBe(
    [
      'iPhone 17 · iOS 27.0 · light · text large. App in front: Tideline (mobi.bouncingball.Tideline).',
      `Screenshot (1206×2622 on the device): /tmp/t/simpane/${UDID}-small.png`,
      'Read that file to see the screen.',
    ].join('\n'),
  )
  const full = await callTool($, { tool: 'mcp__simpane__screenshot', size: 'full', tool_use_id: 'toolu_2' })
  expect(full.result).toContain(`/tmp/t/simpane/${UDID}.png`)
})

test('the logs tool answers only what the app said, narrowed on request', async ($, on) => {
  const { seen } = world(on)
  await slash($)

  const all = await callTool($, { tool: 'mcp__simpane__logs', seconds: 120, tool_use_id: 'toolu_1' })
  expect(String(all.result).split('\n')[0]).toBe('Tideline (mobi.bouncingball.Tideline) on iPhone 17, last 120s: 6 lines of its own.')
  expect(all.result).toContain('09:06:15 fault: Fatal error: Index out of range')
  expect(all.result).not.toContain('UITraceInitialize')
  expect(seen.ran.find(line => line.includes('log show'))).toContain(
    'log show --last 120s --style compact --predicate process == "Tideline" AND (NOT subsystem BEGINSWITH "com.apple." OR messageType == error OR messageType == fault)',
  )

  const narrowed = await callTool($, { tool: 'mcp__simpane__logs', contains: 'decoding', tool_use_id: 'toolu_2' })
  expect(String(narrowed.result).split('\n')[0]).toContain('1 line of its own')
})

test('the set tool changes the simulator and answers a fresh screenshot', async ($, on) => {
  const { seen, clock } = world(on)
  await slash($)

  const pending = callTool($, {
    tool: 'mcp__simpane__set',
    appearance: 'dark',
    textSize: 'accessibility-large',
    statusBar: 'clean',
    openUrl: 'tideline://station/42',
    tool_use_id: 'toolu_1',
  })
  await clock.advance(2_000)
  const set = await pending

  expect(seen.ran).toContain('xcrun simctl ui UDID appearance dark')
  expect(seen.ran).toContain('xcrun simctl ui UDID content_size accessibility-large')
  expect(seen.ran).toContain('xcrun simctl status_bar UDID override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3')
  expect(seen.ran).toContain('xcrun simctl openurl UDID tideline://station/42')
  expect(String(set.result).split('\n')[0]).toBe('Done: appearance dark, text size accessibility-large, clean status bar, opened tideline://station/42.')
  expect(set.result).toContain('iPhone 17 · iOS 27.0 · dark · text accessibility-large')

  expect((await callTool($, { tool: 'mcp__simpane__set', openUrl: 'not a url', tool_use_id: 'toolu_2' })).result).toContain('Nothing to change')
})

test('a command that launches an app is followed by a fresh look and the pane', async ($, on) => {
  const { seen, clock } = world(on)

  await $.tool.call({ tool: 'Bash', command: 'xcrun simctl launch booted mobi.bouncingball.Tideline', tool_use_id: 'toolu_1' })
  expect(seen.ran).toEqual([])

  await clock.advance(2_000)
  expect(seen.ran).toContain('xcrun simctl io UDID screenshot --type=png /tmp/t/simpane/UDID.png')
  expect(seen.opened).toEqual(['simpane'])
})

test('other commands are left alone', async ($, on) => {
  const { seen, clock } = world(on)

  await $.tool.call({ tool: 'Bash', command: 'swift build', tool_use_id: 'toolu_1' })
  await $.tool.call({ tool: 'Bash', command: 'xcrun simctl list devices', tool_use_id: 'toolu_2' })
  await clock.advance(5_000)

  expect(seen.bash).toHaveLength(2)
  expect(seen.ran).toEqual([])
  expect(seen.opened).toEqual([])
})

test('with autoOpen off a launch refreshes the picture without opening the pane', { options: { autoOpen: false } }, async ($, on) => {
  const { seen, clock } = world(on)

  await $.tool.call({ tool: 'Bash', command: 'xcrun simctl launch booted mobi.bouncingball.Tideline', tool_use_id: 'toolu_1' })
  await clock.advance(2_000)

  expect(seen.ran.some(line => line.includes('screenshot'))).toBe(true)
  expect(seen.opened).toEqual([])
})

test('in an Apple project the tools are there from the first prompt, elsewhere not until a simulator is seen', async ($, on) => {
  const apple = world(on, { entries: ['Tideline.xcodeproj', 'README.md'] })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(apple.seen.tools).toEqual(['screenshot', 'logs', 'set'])
  expect(apple.seen.ran).toEqual([])
})

test('a session in another kind of project declares no tools and runs nothing at start', async ($, on) => {
  const { seen } = world(on, { entries: ['package.json', 'src'] })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(seen.tools).toEqual([])
  expect(seen.ran).toEqual([])
})
