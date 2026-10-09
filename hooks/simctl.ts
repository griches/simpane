import type { App, Device } from '../types'
import { commands } from './shell'

type Json = Record<string, unknown>

const record = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {})

const list = (value: unknown): Json[] => (Array.isArray(value) ? value.map(record) : [])

const text = (value: unknown) => (typeof value === 'string' ? value : '')

const json = (raw: string): Json => {
  try {
    return record(JSON.parse(raw))
  } catch {
    return {}
  }
}

/** `com.apple.CoreSimulator.SimRuntime.iOS-27-0` as `iOS 27.0`. */
export const runtimeName = (identifier: string) => {
  const [platform = '', ...version] = identifier.slice(identifier.lastIndexOf('.') + 1).split('-')

  return version.length === 0 ? platform : `${platform} ${version.join('.')}`
}

/** The simulators `simctl list devices -j` lists, the most recently used first; `state` narrows them. */
export const parseDevices = (raw: string, state?: 'Booted' | 'Shutdown'): Device[] =>
  Object.entries(record(json(raw).devices))
    .flatMap(([runtime, devices]) =>
      list(devices)
        .filter(one => one.isAvailable !== false && (state === undefined || one.state === state))
        .map(one => ({ udid: text(one.udid), name: text(one.name), runtime: runtimeName(runtime), usedAt: text(one.lastUsedAt) })),
    )
    .filter(one => one.udid !== '')
    .sort((a, b) => b.usedAt.localeCompare(a.usedAt))
    .map(({ usedAt: _usedAt, ...device }) => device)

/**
 * The app in front: of the apps `launchctl list` shows running, the newest
 * that `simctl listapps` (as JSON) says the developer installed, or the one
 * `preferred` names when it is running.
 */
export const parseApp = (launchctl: string, apps: string, preferred: string | null): App | null => {
  const installed = json(apps)
  const running = [...launchctl.matchAll(/^(\d+)\s+\S+\s+UIKitApplication:([^[\s]+)/gm)]
    .map(found => ({ pid: Number(found[1]), bundleId: found[2] ?? '' }))
    .sort((a, b) => b.pid - a.pid)
  const own = running.filter(one => record(installed[one.bundleId]).ApplicationType === 'User')
  const picked = own.find(one => one.bundleId === preferred) ?? own[0]

  if (picked === undefined) {
    return null
  }

  const info = record(installed[picked.bundleId])
  const executable = text(info.CFBundleExecutable)

  return {
    bundleId: picked.bundleId,
    name: text(info.CFBundleDisplayName) || text(info.CFBundleName) || executable || picked.bundleId,
    executable: executable || picked.bundleId.slice(picked.bundleId.lastIndexOf('.') + 1),
  }
}

/** The pixel size `sips -g pixelWidth -g pixelHeight` printed. */
export const parseSize = (raw: string) => {
  const width = Number(/pixelWidth:\s*(\d+)/.exec(raw)?.[1] ?? 0)
  const height = Number(/pixelHeight:\s*(\d+)/.exec(raw)?.[1] ?? 0)

  return width > 0 && height > 0 ? { width, height } : null
}

/** A terminal cell is about twice as tall as it is wide. */
const CELL_ASPECT = 2.1

/** The box of terminal cells a picture fills without distortion, inside the room given. */
export const fit = (width: number, height: number, room: { columns: number; rows: number }) => {
  const columns = Math.max(1, Math.min(255, room.columns, Math.floor((room.rows * CELL_ASPECT * width) / height)))
  const rows = Math.max(1, Math.min(255, room.rows, Math.round((columns * height) / width / CELL_ASPECT)))

  return { columns, rows }
}

const LOG_LINE = /^\d{4}-\d\d-\d\d (\d\d:\d\d:\d\d)\.\d+\s+(\S+)\s+\S+\[\d+:[0-9a-f]+\]\s+(.*)$/
const LEVEL: Record<string, string> = { E: 'error', F: 'fault', Df: '', Db: 'debug', I: 'info' }
const LOG_WIDTH = 300

/**
 * An app's own lines out of `log show --style compact`: what it logged
 * itself and every error or fault in its process, system chatter dropped,
 * repeats folded, each line cut to a width.
 */
export const filterLog = (raw: string, executable: string, contains: string | null): string[] => {
  const kept: { line: string; times: number }[] = []
  const wanted = contains?.toLowerCase() ?? null

  for (const line of raw.split('\n')) {
    const found = LOG_LINE.exec(line)

    if (found === null) {
      // A message's later lines belong to the line kept before them.
      const last = kept.at(-1)

      if (last !== undefined && /^\s+\S/.test(line) && last.times === 1 && last.line.length < LOG_WIDTH * 3) {
        last.line += `\n${line.slice(0, LOG_WIDTH)}`
      }

      continue
    }

    const [, time = '', type = '', rest = ''] = found
    const isSerious = type === 'E' || type === 'F'
    const subsystem = /^\[([^:\]]*):/.exec(rest)?.[1]
    const library = /^\(([^)]+)\)/.exec(rest)?.[1]
    const isOwn =
      subsystem !== undefined
        ? !subsystem.startsWith('com.apple.')
        : library === undefined || library === executable || library.startsWith(`${executable}.`)

    if (type === 'A' || (!isSerious && !isOwn)) {
      continue
    }

    const message = rest.replace(/^\(([^)]+)\)\s*/, '').slice(0, LOG_WIDTH)

    if (wanted !== null && !message.toLowerCase().includes(wanted)) {
      continue
    }

    const told = `${time} ${LEVEL[type] === undefined || LEVEL[type] === '' ? '' : `${LEVEL[type]}: `}${message}`
    const last = kept.at(-1)

    if (last !== undefined && last.line.slice(9) === told.slice(9)) {
      last.times += 1
    } else {
      kept.push({ line: told, times: 1 })
    }
  }

  return kept.map(one => (one.times > 1 ? `${one.line} (×${one.times})` : one.line))
}

const SIMCTL_CHANGES = new Set([
  'boot', 'shutdown', 'install', 'uninstall', 'launch', 'terminate', 'openurl', 'ui', 'status_bar', 'erase', 'addmedia', 'push', 'privacy', 'location',
])

/** What a Bash command does to a simulator: whether its screen may change, and the app it launches. */
export const readCommand = (command: string): { changesScreen: boolean; launched: string | null } => {
  let changesScreen = false
  let launched: string | null = null

  for (const one of commands(command)) {
    const args = one.name === 'xcrun' ? one.args.filter(arg => !arg.startsWith('-')) : [one.name, ...one.args]
    const [tool, verb] = args

    if (tool === 'simctl' && verb !== undefined && SIMCTL_CHANGES.has(verb)) {
      changesScreen = true

      if (verb === 'launch') {
        // `simctl launch [flags] <device> <bundle id> [arguments]`
        launched = args.slice(2).filter(arg => !arg.startsWith('-'))[1] ?? launched
      }
    } else if (tool === 'xcodebuild' || one.name === 'xcodebuild') {
      changesScreen ||= /simulator/i.test(command)
    }
  }

  return { changesScreen, launched }
}
