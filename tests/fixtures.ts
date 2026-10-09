// Output of `xcrun simctl` and `log show` on Xcode 27, cut down. The Tideline lines are written in the same
// format the system lines came in, since the machine these were captured on had no app of its own installed.

export const DEVICES = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.watchOS-27-0': [],
    'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
      {
        dataPath: '/Users/dev/Library/Developer/CoreSimulator/Devices/E4A103F5-F2F5-4BBA-98BC-2246BC8E63F5/data',
        udid: 'E4A103F5-F2F5-4BBA-98BC-2246BC8E63F5',
        lastUsedAt: '2026-10-09T08:05:38Z',
        isAvailable: true,
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
        state: 'Booted',
        name: 'iPhone 17',
      },
      { udid: '5F2B42D3-A1D8-4E94-AFAA-97E34ADEC766', lastUsedAt: '2026-10-01T10:00:00Z', isAvailable: true, state: 'Shutdown', name: 'iPhone 17 Pro' },
      { udid: 'B6D07FEB-6993-4314-B3FA-CE432C6DC29E', isAvailable: true, state: 'Shutdown', name: 'iPhone Air' },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
      { udid: '11111111-2222-3333-4444-555555555555', lastUsedAt: '2026-10-05T10:00:00Z', isAvailable: true, state: 'Shutdown', name: 'iPad Pro 13-inch (M4)' },
      { udid: '99999999-2222-3333-4444-555555555555', isAvailable: false, state: 'Shutdown', name: 'iPhone 15' },
    ],
  },
})

export const NO_BOOTED = DEVICES.replace('"Booted"', '"Shutdown"')

export const LAUNCHCTL = [
  'PID\tStatus\tLabel',
  '10005\t0\tUIKitApplication:com.apple.mobilesafari[d3bb][rb-legacy]',
  '10112\t0\tUIKitApplication:mobi.bouncingball.Tideline[7c1e][rb-legacy]',
  '9933\t0\tUIKitApplication:com.apple.Spotlight[156e][rb-legacy]',
  '-\t0\tcom.apple.springboard.services',
].join('\n')

export const APPS = JSON.stringify({
  'com.apple.mobilesafari': { ApplicationType: 'System', CFBundleExecutable: 'MobileSafari', CFBundleDisplayName: 'Safari', CFBundleIdentifier: 'com.apple.mobilesafari' },
  'mobi.bouncingball.Tideline': { ApplicationType: 'User', CFBundleExecutable: 'Tideline', CFBundleDisplayName: 'Tideline', CFBundleIdentifier: 'mobi.bouncingball.Tideline' },
  'mobi.bouncingball.Other': { ApplicationType: 'User', CFBundleExecutable: 'Other', CFBundleName: 'Other', CFBundleIdentifier: 'mobi.bouncingball.Other' },
})

export const SIPS = '/tmp/t/simpane/E4A103F5-F2F5-4BBA-98BC-2246BC8E63F5.png\n  pixelWidth: 1206\n  pixelHeight: 2622\n'

export const LOG = [
  'getpwuid_r did not find a match for uid 501',
  'Timestamp               Ty Process[PID:TID]',
  '2026-10-09 09:06:13.119 Df Tideline[10112:0] [com.apple.libsystem.libdispatch:] BUG in libdispatch: 26A434 24A434 - 612 - 0x4',
  '2026-10-09 09:06:13.125 Df Tideline[10112:19172] [com.apple.xpc:connection] [0x103e29630] activating connection: mach=true listener=false peer=false name=com.apple.cfprefsd.daemon',
  '2026-10-09 09:06:13.129 Df Tideline[10112:19172] (libMobileGestalt.dylib) No persisted cache on this platform.',
  '2026-10-09 09:06:13.144 A  Tideline[10112:19172] (libsystem_containermanager.dylib) container_query_t',
  '2026-10-09 09:06:13.210 Df Tideline[10112:19172] [mobi.bouncingball.Tideline:network] Fetching stations near 51.5, -0.1',
  '2026-10-09 09:06:13.402 Df Tideline[10112:19172] (Tideline.debug.dylib) loaded 12 stations',
  '2026-10-09 09:06:14.000 Df Tideline[10112:19172] [mobi.bouncingball.Tideline:chart] redraw',
  '2026-10-09 09:06:14.016 Df Tideline[10112:19172] [mobi.bouncingball.Tideline:chart] redraw',
  '2026-10-09 09:06:14.033 Df Tideline[10112:19172] [mobi.bouncingball.Tideline:chart] redraw',
  '2026-10-09 09:06:14.610 E  Tideline[10112:19208] [com.apple.network:connection] nw_connection_copy_connected_local_endpoint_block_invoke [C3] Connection has no local endpoint',
  '2026-10-09 09:06:15.002 E  Tideline[10112:19172] [mobi.bouncingball.Tideline:network] Decoding failed: keyNotFound(CodingKeys(stringValue: "height", intValue: nil))',
  '    at ForecastService.swift:41',
  '2026-10-09 09:06:15.148 Df Tideline[10112:19172] [com.apple.UIKit.tracing:UITraceManager] UITraceInitialize: registering notify listener',
  '2026-10-09 09:06:15.900 F  Tideline[10112:19172] (libswiftCore.dylib) Fatal error: Index out of range',
].join('\n')
