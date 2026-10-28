# Zed integration

Implementation choice: project-window navigation plus explicit command copy. Automatic command entry and Terminal Thread creation are disabled.

## Evidence

- Local Zed CLI: 1.25.3; `--new` and `--existing` are present. No terminal-targeted execution option is exposed by its help.
- Read-only `PRAGMA table_info(workspaces)` confirmed local workspace paths, window/session IDs and remote connection metadata.
- Workspace paths are validated conservatively. Ambiguous legacy comma-separated encodings are not split into guessed paths.
- The resolver uses Stable's database only. It does not mix Preview or remote workspaces into local Stable window matching.
- PromptCast's `runInZed` at commit `6bc5707602cfa3506e557e0677f14e216a8fafe7` starts the CLI, opens the command palette, creates a Terminal Thread, then pastes a command with fixed delays. Successful AppleScript execution does not establish terminal-targeted delivery or session startup.

## Implemented behavior

A unique DB-corroborated title can be focused through the Window menu. Exact path identity is used for project filtering and root containment. Same-name roots, duplicate windows, unsupported encodings and missing DB access produce ambiguous/unknown results. Stored database rows can lag the UI, so they are corroborating evidence rather than a window-control API.

Explicit window selection is available by unique title. This selects a window, not a terminal. Duplicate titles are displayed without an automatic focus action. Unknown resolution does not open a new window implicitly; a separate explicit action can do so with `--new`.

No CLI path is handed to an existing Zed window to guess which project it should display. By default no keystroke or paste is sent and no process is terminated. The opt-in **Zed Terminal** preference is the one exception, described below.

## Real GUI validation

The initial sandboxed System Events probe failed with error `-10827`; a permitted unsandboxed probe succeeded. A separate-data-directory Zed process was attempted but exited with `zed is already running`, so no isolated process was assumed to be available.

Four disposable windows were then opened with `--new`: two distinct project names and two same-named projects at different paths. Existing projects were never replaced, closed, or given terminal input.

Checks passed:

- New Zed windows appeared for the disposable projects.
- Production window resolution focused the unique disposable project; direct `AXFocusedWindow` confirmed its title.
- Revealing that existing project preserved the window count.
- Same-name ambiguity blocked automatic selection and extra window creation.
- Original project windows remained present throughout.
- Only the four disposable windows were closed at cleanup, using their own `AXCloseButton` elements. The original three project windows remained.

This testing exposed two problems that were fixed: System Events could return stale AX window objects, and a Zed helper process had the same executable path as the GUI process. GUI PID resolution now uses `NSRunningApplication` by bundle ID. `native-zed.ts` reads and raises fresh AX elements through standard JXA/ApplicationServices, without a Swift runtime/compiler dependency or simulated keys. A Zed move reports success only after focused-title confirmation.

Still unverified: moving across a different Space/fullscreen desktop and remote/multi-root workspace variants. These were not tested by changing the user's existing desktop arrangement.

Out of scope: jumping to a live session hosted in VS Code, Cursor or any other editor. Host detection, window matching and the Window-menu fallback are designed and tested for Zed only, and may not work elsewhere.

Future terminal automation requires a delivery mechanism tied to the intended terminal. A new `sidebar_terminal_threads` row or a foreground check alone does not provide that guarantee. No actual session was launched or resumed as part of the window smoke tests.

## Experimental: typing the resume command into a new Zed terminal

Off by default (the **Zed Terminal** preference). Implemented in `src/lib/zed-terminal.ts` and `src/lib/zed-input.ts`.

What was tried on Zed 1.25.3, and what it showed:

- Ctrl+Shift+`posted to the Zed process opens a new terminal, and Cmd+V then pastes the clipboard into it. Shown by pasting`touch <file>` and pressing Return in a test: the file appeared.
- A new terminal is detectable without reading the screen: Zed starts a `login` process per terminal, so one more `login` under the Zed process means one more terminal. Its shell's working directory (read with `lsof`) tells where it opened.
- Typing into the new terminal's tty directly (TIOCSTI) is refused by macOS (`Operation not permitted`).
- Accessibility exposes only the standard window buttons, not the tabs. Zed's database stores the tab order and which tab is active, but not which tab belongs to which process. A terminal's environment variables could not be read.
- Cmd+1 did nothing and Cmd+2 opened an extra terminal in the test window, so tab switching by keystroke is not usable. Selecting the existing tab that hosts a running session is therefore not supported.

Safety design: only two key presses can be sent (a table in `zed-input.ts`, with no Return); the paste happens only after the window, the clipboard and the new terminal have been checked, and a clipboard or focus change in between stops it. Each check has a test, and each was verified to fail when removed. A real-device check lives in `tests/gui` (`ZED_GUI_TEST=1 npm run test:gui -- terminal`).

Known limits: it relies on Zed's default Ctrl+Shift+` for a new terminal. A user keymap that mentions that key disables the feature, and a rebinding made elsewhere is caught by the "exactly one new terminal appeared" check, in which case nothing is pasted.
