# Verification

Date: 2026-10-28.

This extends the existing Raycast extension. PromptCast was inspected as a design reference; it was not installed or run. No agent/Zed settings or hooks were edited, and no session process was terminated by any check below.

## Automated checks

- `npm test`: 171 passing tests. Synthetic fixtures cover read-only SQLite catalogs, optional schema columns, archived filtering, rollout fallback, symlink confinement, command quoting and UUID validation, exact-path ownership, provider-isolated live merging, Codex lifecycle activity, Zed target resolution, host detection, and the action paths below. Modules that call AppleScript or the Raycast API are loaded with fakes (`tests/helpers/load-lib.ts`); no test touches a real window or the real clipboard.
  - `session-actions`: the real component is called and each action's handler is run against a fake Raycast API. Checked: what reaches the clipboard, the exact toast text for a reused window, a new window, an ambiguous window (the failure must say the command was copied), a row that cannot be resumed, a failed copy, live sessions with and without a GUI host, and background-job attach commands including a hostile job id.
  - `goto`: terminal-tab lookup per host kind, fallback to activating the host, Zed raise, reasons reported when no window matches, no-GUI-host sessions needing resume, activation failure.
  - `focus` and `windows`: window titles from the Window menu with accessibility and native-AX fallbacks, unique-match rule, refusal of ambiguous targets, a menu click not counting as success until the focused title is confirmed, AppleScript string escaping.
  - `resume`: command construction for both providers, shell and AppleScript escaping, vanished directories, UUID validation before anything runs.
  - `zed-workspaces` and `native-zed`: read-only Stable database access, remote and ambiguous rows, unavailable versus empty, single-instance pid resolution, arguments passed outside script text.
  - `host`: a `Python.app` wrapper around a CLI is not mistaken for its host (found during GUI testing, see below); process-table parsing; chains that end without a GUI app.
  - `registry`, `process-age`, `agents`: a stale session file whose pid now belongs to another process is not shown as live; the cached CLI status only wins while the registry has not changed since and the session matches; the CLI cache and its invalidation.
  - `binary`: a symlinked CLI is returned as the link, not its versioned target, so a copied command survives an upgrade; non-executable, directory and shell-command inputs are refused.
  - `quote`: both quoters are round-tripped through a real `/bin/sh` and a real `osascript` with hostile strings, not compared with themselves.
  - `codex-runtime`: no Codex process means stopped; any Codex process without a visible handle on a session means unknown; `lsof` or `ps` failure is uncertain.
- Mutation check: five deliberate breakages of production code (Terminal using the iTerm lookup, a menu click accepted without confirming focus, the database no longer opened read-only, unknown Zed targets no longer refused, several Zed instances accepted) were each caught by exactly one failing test, then reverted. Four more in `session-actions` (a toast claiming the command was copied when it was not, a command never copied, the ambiguous failure no longer mentioning the copy, a background job id no longer validated) and each of the defect fixes listed below, reverted one at a time, were each caught by at least one failing test.
- `tsc --noEmit`, `npm run build`, `npm run lint` (manifest, icons, ESLint, Prettier) and `npm run format:check` pass.

## Static review

- Full git history and tracked files were scanned for credentials, key material, personal paths and addresses: none found.
- Commands run through `execFile` with argument arrays; no `shell: true`, `eval` or network calls. AppleScript/JXA text is fixed, and dynamic values (pid, title, tty, resume command) are validated and quoted or passed as arguments.
- `npm audit` reports two low-severity entries in the Raycast API / esbuild build-tool chain (a Windows development-server issue). Removing them requires a major Raycast API update and is not forced here.

## Real GUI checks

Run against a live Zed 1.25.3 on macOS with Raycast. Only disposable projects were opened, with names that match no real project, and only those windows were closed afterwards, through their own native close buttons.

Raycast:

- Launched the built extension and visually verified the combined list, the agent dropdown, the Open Sessions/History sections, provider labels, confirmed Working/Idle badges, and the registered command **Coding Agent Sessions**.

Zed window navigation (production focus code, fresh native AX focused-window data):

- Each of the three existing project windows was moved to without creating another window; the focused title matched after every move.
- A disposable project was opened with `--new`; asking for it again reused that window.
- A project that was not open produced exactly one new window; a second request reused it.
- Two same-named projects at different paths were refused as ambiguous and no window was created.
- Cleanup: window count and titles returned to the starting state, and focus returned to the original window.

Across Spaces:

- At the start, the Window menu listed three Zed windows while Accessibility saw only one: the other two lived on different Spaces. They were reached in every run, with no extra window and the correct focused title, so navigation across ordinary Spaces is covered.
- A disposable window was put into native fullscreen, which gives it its own Space. From inside that Space, an existing project on another Space was reached; then the fullscreen Space was reached again, for two different existing projects. Every move reported a reused window, the window count never changed, the focused title was the expected one, and the fullscreen window stayed fullscreen. The Window menu kept listing every window from inside the fullscreen Space.
- macOS has no public way to move a window to another Space, so the disposable window could only be given its own Space through fullscreen.

These checks are reproducible: `ZED_GUI_TEST=1 npm run test:gui -- spaces` (`tests/gui/`). It is manual only, refuses to run without the variable, and is not part of `npm test` or CI. It raises each existing Zed window once, opens and closes only windows named `ztq-*`, and restores the original focus; it refuses to start if a `ztq-` window is already open.

Results: before the script was added to the repository, the same checks were run as throwaway scripts. Their first run passed nine of ten (one wrong expectation in the script itself), and after the review fixes they passed ten of ten twice and nine of nine for the fullscreen run. The repository version then passed sixteen of sixteen on the real Zed, after one fix to the script: the temporary directory is reached through a symlink (`/var` to `/private/var`) while Zed records real paths, which made the new windows look unresolvable until the path was resolved.

Defects found by independent review and by the GUI checks, all fixed and covered by tests:

- A background job row offered Resume in Terminal, which could start a second copy of a running job. The action is no longer offered, and the handler refuses it too.
- When a window was matched but could not be switched to, the extension opened a second window for the same project. It now reports that nothing was opened. A repeated Enter while a window action is running is ignored.
- A switch to a window on another Space was judged failed because the focus was checked once, immediately after the menu click, before the Space animation finished (found by the GUI regression: one of three existing windows reported "could not be switched to" although it had focused). The focus is now polled for up to two seconds.
- The status the registry wrote could be hidden for up to 45 seconds by the cached CLI answer. The CLI answer now wins only while the registry has not changed since it was read, and only for the same session.
- A session file left by a crashed process was shown as live if its pid was reused. The process's age is now compared with the file's `startedAt` (the two agree within about two seconds on live sessions). If `ps` fails, sessions are kept rather than hidden.
- The copied resume command pinned the versioned binary behind a symlink, which an upgrade deletes. It now keeps the link.
- A missing Accessibility permission was reported as "No window shows this directory". It is now reported as a permission problem.

Defect found and fixed earlier: Codex sessions started through a Python wrapper resolved their host to Homebrew's `Python.app`, so Enter failed with "Python is no longer available". Host detection now ignores an `.app` inside a `.framework`. With the live process table, Codex sessions behind such a wrapper resolve to Zed; sessions inside tmux have no GUI host and stay unresolved by design.

Earlier, the sandboxed System Events probe failed with error `-10827`; a permitted unsandboxed run succeeded. System Events could also return stale AX window objects, so a Zed move reports success only after the focused title is confirmed through native AX.

## Scope

Implemented: unified Claude/Codex list and previews, provider/path filters, read-only Codex catalog and bounded fallback, observed ownership with an unknown state, safe command construction, conservative Zed window resolution, an explicit window picker, and manual Zed resume (the command is copied, never typed).

Not implemented: automatic command injection into Zed terminals, selection of the exact existing Zed terminal, annotations/pins, full-text transcript search, usage monitoring, hooks.

Out of scope: jumping to a live session hosted in VS Code, Cursor or any other editor. It is designed and tested for Zed only and may not work elsewhere.

## Remaining manual checks

1. Deny Accessibility access to Raycast and verify the failure is reported without spawning a session.
2. Press Enter on a history row inside Raycast and look at the toast and the pasted clipboard once. The logic is tested against a fake Raycast API, but the rendered toast has not been observed in Raycast itself.
3. Verify unsupported Codex sources have no CLI resume action, and that live or unknown ownership blocks automatic resume.
4. Open a Zed window with several folders (`zed --new dirA dirB`) and verify the jump still works. The parser rejects path values containing a comma or newline and then marks the whole snapshot unavailable; the local database only held single-folder rows, so how Zed stores multi-folder workspaces was not observed.

Denied-access behavior inside Raycast remains unverified. Existing user workspaces were not rearranged for any check. See `docs/zed-integration.md` for the Zed-specific limits.
