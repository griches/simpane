# simpane

**The iOS Simulator beside your Claude Code session, and a way for Claude to see it.**

simpane is a Claude Code mod for people building iOS apps. It puts a live picture of the booted simulator in a pane, with switches for dark mode and text size and your app's own log lines. It also gives Claude three tools, so that after changing a view it can take a screenshot and look, read what your app logged, or flip to dark mode and check again, without asking you to describe the screen.

## Install

Needs macOS with Xcode, and Claude Code 2.1.295 or later.

```
/plugin marketplace add griches/simpane
/plugin install simpane@simpane
```

Or from a shell:

```sh
claude plugin marketplace add griches/simpane
claude plugin install simpane@simpane
```

Run `/reload-plugins` in a session that is already open.

## The pane

`/simpane` opens it. It also opens by itself when Claude installs or launches an app, or builds for a simulator.

```
iPhone 17
iOS 27.0 · light · text large
┌──────────────┐
│              │
│   (screen)   │
│              │
└──────────────┘
Tideline · mobi.bouncingball.Tideline

r: Refresh  l: Live on  a: Dark  u: Text +  d: Text −
s: Send to Claude  g: Logs
```

| Key | What it does |
| --- | --- |
| `r` | Takes a fresh screenshot |
| `l` | Live on or off. On, the picture is retaken every two seconds while the pane is on screen |
| `a` | Switches the simulator between light and dark |
| `u` `d` | Steps Dynamic Type up or down, through the accessibility sizes |
| `s` | Puts the screenshot's path in your prompt, to ask Claude about what you are looking at |
| `g` | Shows the last minute of your app's own log |
| `n` | Moves to the next simulator, when more than one is booted |

With no simulator booted, the pane offers the last three you used, to boot with one key.

The picture is drawn in terminals that show images: Ghostty, kitty and others with the kitty graphics protocol. Elsewhere, and in the desktop app, the pane shows the device, the app and the screenshot's path, and Claude's tools work the same.

## What Claude can do

| Tool | What it does |
| --- | --- |
| `screenshot` | Takes a screenshot and answers its path, with the device, appearance, text size and the app in front. Claude reads the file to see the screen |
| `logs` | Answers what your app logged lately: `print`, `NSLog`, `os_log` and `Logger` output and every error or fault in its process. System chatter is removed and repeats are folded. Takes `seconds`, `contains` and `bundleId` |
| `set` | Sets light or dark appearance, a Dynamic Type size, a clean 9:41 status bar, or opens a URL or deep link. Answers a fresh screenshot |

In a folder with an Xcode project, a workspace or a `Package.swift`, Claude has the tools from the first prompt. In any other folder they are declared the first time a booted simulator is seen, so a session that never touches iOS pays nothing for them.

Things to ask once it is installed:

- "Build and run, then check the settings screen looks right in dark mode."
- "Step the text size up to the largest accessibility size and tell me what truncates."
- "Launch the app and tell me why the list is empty. Check the logs."
- "Give me a clean status bar and take the store screenshots."

## The log filter

A simulator's log for one app runs to thousands of lines a minute, nearly all of it the system talking to itself. simpane keeps:

- Lines your app wrote under its own subsystem, or with none.
- Every error and fault in your app's process, whoever logged it.

It drops activity markers and Apple-subsystem chatter, folds identical lines that follow each other into one with a count, and cuts long lines. Claude gets the last 150 lines at most.

## Settings

Both under simpane in `/config`.

| Setting | Default | What it does |
| --- | --- | --- |
| Live refresh, in seconds | 2 | `1`, `5`, or `off` for refresh on demand only |
| Open the pane | on | Off: only on `/simpane` |

## Limits

- Simulators only, not devices.
- It shows the screen and changes settings. It does not tap, type or scroll: `simctl` has no way to.
- Each refresh runs `simctl io screenshot`, which takes about a second, so Live is a slideshow and not video.
- The app in front is taken to be the most recently launched app that you installed. Pass `bundleId` to the logs tool to name another.

## Works well with

[xcpane](https://github.com/griches/xcpane) reads `xcodebuild` output into a pane of errors. With both, Claude builds, sees why it failed, fixes it, runs it and looks at the result.

## Privacy

simpane makes no network requests and calls no model. It runs `xcrun simctl` and `sips` on your Mac and writes screenshots to your temporary folder.

## Development

```sh
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## Licence

MIT. See [LICENSE](LICENSE).
