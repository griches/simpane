export type Device = {
  udid: string
  name: string
  /** `iOS 27.0`, `watchOS 26.2`. */
  runtime: string
}

/** A simulator that could be booted, offered when none is running. */
export type Candidate = Device

export type App = {
  bundleId: string
  name: string
  /** The process name, which the device's log is filtered by. */
  executable: string
}

export type Shot = {
  /** The screenshot as the simulator took it. */
  path: string
  /** A copy scaled down for the pane and for Claude to read. */
  smallPath: string
  width: number
  height: number
  at: number
  /** Changes with every capture, so a redraw reads the file again. */
  generation: number
}

export type Screen = {
  /** `absent`: no simulator is booted. `unavailable`: `xcrun simctl` could not be run on this machine. */
  status: 'unknown' | 'ready' | 'absent' | 'unavailable'
  device: Device | null
  /** Every booted simulator, when more than one is. */
  devices: Device[]
  candidates: Candidate[]
  shot: Shot | null
  appearance: string
  textSize: string
  app: App | null
}

declare module 'claude-code' {
  interface PluginState {
    'simpane': {
      screen: Screen
      isLive: boolean
      /** The foreground app's own log lines, when the pane shows them. */
      logs: string[] | null
      isBusy: boolean
    }
  }
}
