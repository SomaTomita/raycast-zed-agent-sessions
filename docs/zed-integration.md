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

No CLI path is handed to an existing Zed window to guess which project it should display. No global keystrokes, synthetic paste, or process termination are used.

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
