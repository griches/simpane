import { describe, expect, test } from 'claude-code/testing'

import { filterLog, fit, parseApp, parseDevices, parseSize, readCommand, runtimeName } from '../hooks/simctl'
import { APPS, DEVICES, LAUNCHCTL, LOG, SIPS } from './fixtures'

describe('simulators', () => {
  test('the booted one, and the ones that could be booted, most recently used first', () => {
    expect(parseDevices(DEVICES, 'Booted')).toEqual([{ udid: 'E4A103F5-F2F5-4BBA-98BC-2246BC8E63F5', name: 'iPhone 17', runtime: 'iOS 27.0' }])
    expect(parseDevices(DEVICES, 'Shutdown').map(one => `${one.name} (${one.runtime})`)).toEqual([
      'iPad Pro 13-inch (M4) (iOS 18.5)',
      'iPhone 17 Pro (iOS 27.0)',
      'iPhone Air (iOS 27.0)',
    ])
    expect(parseDevices('not json')).toEqual([])
    expect(runtimeName('com.apple.CoreSimulator.SimRuntime.watchOS-26-2')).toBe('watchOS 26.2')
  })

  test("the app in front is the developer's, not the system's", () => {
    expect(parseApp(LAUNCHCTL, APPS, null)).toEqual({ bundleId: 'mobi.bouncingball.Tideline', name: 'Tideline', executable: 'Tideline' })
    expect(parseApp(LAUNCHCTL.replace(/^.*Tideline.*\n/m, ''), APPS, null)).toBeNull()
    expect(parseApp(LAUNCHCTL, '{}', null)).toBeNull()
  })

  test('a picture is fitted to the pane without distortion', () => {
    expect(parseSize(SIPS)).toEqual({ width: 1206, height: 2622 })
    expect(parseSize('nothing')).toBeNull()
    // A tall phone in a tall pane is bounded by the rows it has.
    expect(fit(1206, 2622, { columns: 45, rows: 31 })).toEqual({ columns: 29, rows: 30 })
    // A landscape tablet is bounded by the columns.
    expect(fit(2732, 2048, { columns: 45, rows: 31 })).toEqual({ columns: 45, rows: 16 })
  })
})

describe('the app log', () => {
  test("keeps the app's own lines and every error, folds repeats, drops system chatter", () => {
    expect(filterLog(LOG, 'Tideline', null)).toEqual([
      '09:06:13 [mobi.bouncingball.Tideline:network] Fetching stations near 51.5, -0.1',
      '09:06:13 loaded 12 stations',
      '09:06:14 [mobi.bouncingball.Tideline:chart] redraw (×3)',
      '09:06:14 error: [com.apple.network:connection] nw_connection_copy_connected_local_endpoint_block_invoke [C3] Connection has no local endpoint',
      '09:06:15 error: [mobi.bouncingball.Tideline:network] Decoding failed: keyNotFound(CodingKeys(stringValue: "height", intValue: nil))\n    at ForecastService.swift:41',
      '09:06:15 fault: Fatal error: Index out of range',
    ])
  })

  test('can be narrowed to lines containing some text', () => {
    expect(filterLog(LOG, 'Tideline', 'DECODING')).toHaveLength(1)
    expect(filterLog('', 'Tideline', null)).toEqual([])
  })
})

describe('commands that change the screen', () => {
  test('simctl and simulator builds', () => {
    expect(readCommand('xcrun simctl launch booted mobi.bouncingball.Tideline')).toEqual({ changesScreen: true, launched: 'mobi.bouncingball.Tideline' })
    expect(readCommand('xcrun simctl launch --console-pty E4A103F5 mobi.bouncingball.Tideline -debug 1').launched).toBe('mobi.bouncingball.Tideline')
    expect(readCommand('xcrun simctl install booted build/Tideline.app && xcrun simctl launch booted mobi.bouncingball.Tideline')).toEqual({
      changesScreen: true,
      launched: 'mobi.bouncingball.Tideline',
    })
    expect(readCommand("xcodebuild -scheme Tideline -destination 'platform=iOS Simulator,name=iPhone 17' test").changesScreen).toBe(true)
    expect(readCommand('xcrun simctl ui booted appearance dark').changesScreen).toBe(true)
  })

  test('what leaves it alone', () => {
    expect(readCommand('xcrun simctl list devices').changesScreen).toBe(false)
    expect(readCommand('xcodebuild -scheme Tideline -destination platform=macOS build').changesScreen).toBe(false)
    expect(readCommand('echo "simctl launch booted x"').changesScreen).toBe(false)
    expect(readCommand('swift build').changesScreen).toBe(false)
  })
})
