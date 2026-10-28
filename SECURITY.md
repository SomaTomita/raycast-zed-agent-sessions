# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private reporting: **Security** tab, then **Report a vulnerability**. If that button is not there, open an issue that says only that you have a security report and asks for a private way to send it. Leave the details out of the issue.

Useful in a report: what you did, what you expected, what happened, your macOS, Raycast and Zed versions, and whether Claude Code or Codex was involved. This is a personal project, so replies are best effort and there is no fixed response time.

## What the extension does

Knowing this makes a report easier to scope.

- It reads local files: `~/.claude` (or `CLAUDE_CONFIG_DIR`), `~/.codex` (or `CODEX_HOME`) and Zed's Stable workspace database, which it opens read-only. It does not read authentication files, private keys or `.env` files.
- It makes no network requests and uploads nothing.
- It runs fixed commands with argument arrays (`ps`, `lsof`, `sqlite3`, `osascript`, the `claude` and `codex` CLIs). Session ids are validated as UUIDs, paths and commands are quoted for the shell and for AppleScript, and values reach JXA as arguments, not as script text.
- It raises windows and selects terminal tabs through Accessibility and Automation, and it never terminates a process.
- By default it sends no key to Zed. The opt-in **Zed Terminal** preference sends two fixed key presses to the Zed process, Ctrl+Shift+` (new terminal) and Cmd+V (paste the resume command), after checking the window, the clipboard and the new terminal. It cannot send Return or any other key, so it never runs anything: you press Enter yourself.
- It writes to the clipboard only when you ask it to copy a resume or attach command.

## In scope

- A way to make the extension run a command or script the user did not choose.
- A way to make it act on the wrong window, process or session in a way that causes loss.
- A way to make the opt-in Zed Terminal feature paste into the wrong place (for example an editor buffer), send a key other than the two listed, or paste anything but the resume command.
- A way to make it read or expose files it should not, or put something unexpected on the clipboard.

## Out of scope

- Issues that need an attacker who can already run code as you or edit your session files and Zed database.
- The two low-severity `npm audit` entries in the Raycast API and esbuild build tooling, which affect a Windows development server and are tracked upstream.
- Other editors: live-session jump is designed for Zed only.

## Supported versions

Only the latest commit on `main`.
