# Raycast Zed Agent Sessions

Search local **Claude Code and Codex** sessions from Raycast and return to their project windows in Zed.

This extends the original Claude Code Sessions extension. Its internal extension name (`claude-code-sessions`) and command ID (`sessions`) are retained so existing Raycast aliases and shortcuts can continue to work. The GitHub repository is [raycast-zed-agent-sessions](https://github.com/SomaTomita/raycast-zed-agent-sessions).

## What it does

- Shows Claude and Codex sessions in one searchable list, with provider labels.
- Selects Claude Code / Codex in the top agent dropdown. **Filter Sessions** (Cmd+Shift+F) combines process status, working state, and exact project directory. Same-named projects remain separate.
- Reads recent conversation previews and a larger transcript view for either provider.
- Goes back to an existing session's hosting window or scriptable terminal tab.
- Opens a stopped session's project and copies its validated resume command for manual use in Zed.
- Offers an explicit Zed window picker when the project-to-window mapping is uncertain.

## Zed behavior

Claude is orange and Codex is blue. Working is yellow; Idle is neutral gray so activity and provider colors do not compete. Open Sessions use filled provider-colored circles; History uses gray clock icons. The list has two sections: **Open Sessions** for sessions with observed live ownership, and **History** for saved conversations without confirmed live ownership. History does not prove a process has stopped; detailed runtime evidence remains in the detail pane.

Only confirmed activity is badged **Working** or **Idle**. Activity that cannot be established has no badge; it is never guessed to be idle. The list does not show project-open icons: a folder being open in Zed is not evidence that the conversation itself is open.

For a live session, Enter tries to reach its existing host. For Zed, the extension corroborates a window title with local project paths recorded in Zed's Stable workspace database. It refuses automatic selection when several paths or windows share a name. A window-level jump does **not** mean that the correct terminal tab has been selected. Direct macOS Accessibility is used to raise the window and confirm the focused title; the Window menu remains a fallback for other Spaces. System Events can cache stale window objects, so its successful menu action alone is not considered proof of a Zed window jump.

For history, Enter copies a resume command and tries to reveal the project's window. It creates a new window only when the project is not found by the resolver. If workspace information is unavailable or ambiguous, it reports that and leaves the command available for manual use. Use **Choose Zed Window** to select a unique window title yourself, or **Open Project in New Zed Window** to explicitly create one.

New project windows use `zed --new`. If a CLI that guarantees a new window cannot be found, the extension stops instead of handing the path to an arbitrary existing window. Merely moving between windows never sends a command to a terminal.

**Automatic resume inside Zed is not enabled.** Zed 1.25.3's CLI does not expose a terminal-targeted command execution option. PromptCast demonstrates an alternative using command-palette keystrokes and Terminal Threads, but fixed delays and global keystrokes cannot reliably bind input to a particular terminal. This implementation copies the command instead. Paste it only after selecting the intended Zed terminal and checking that the same session is not already running.

The automatic project resolver supports Zed Stable's local workspace records. Remote projects, unsupported path encodings, and Preview/Nightly databases are not used to corroborate Stable windows. A manual window selection is by its displayed title; it is not a verified full-path association. Identically titled windows require selection within Zed itself.

## Data sources and status

### Claude Code

- `~/.claude/sessions/<pid>.json`: live registry, validated against running processes.
- `~/.claude/projects/<project>/<session-id>.jsonl`: recent history and transcript previews.
- `~/.claude/history.jsonl`: recent prompts.
- `claude agents --all --json`: optional status and background-job metadata, cached for 45 seconds.

`CLAUDE_CONFIG_DIR` is honored. Live registry refreshes run every 3 seconds; history refreshes every 30 seconds. Unknown registry statuses are not presented as working.

### Codex

- `~/.codex/state_<version>.sqlite`: a read-only, schema-checked catalog query. The newest compatible database is used.
- `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`: bounded recent-file fallback if the catalog is unavailable.
- Open rollout files or `thread-writer-locks/<session-id>.lock` descriptors held by Codex processes: evidence that a session is in use.

`CODEX_HOME` is honored. Archived, subagent, and noninteractive `exec` threads are excluded. Other origins may appear as history, but CLI resume actions are offered only for known `cli`/`tui` sources.

Codex ownership checks use full paths, not filename or directory-name matches. An open descriptor is evidence of use, not proof that the CLI is busy or waiting. For owned sessions, `task_started`, `task_complete`, and `turn_aborted` rollout events provide Working/Idle state. A delayed completion from an older turn does not override a newer turn. The initial lifecycle scan is bounded at 64 MB, and subsequent refreshes read only appended data; oversized or incomplete evidence remains unconfirmed. No hooks or agent-setting changes are required. If a Codex process exists but the selected session cannot be associated with it, status remains **Runtime Unknown**. This also prevents automatic terminal resume. A lock file merely existing on disk is never used as live evidence.

Codex history refreshes every 30 seconds; ownership and activity refresh every 3 seconds. Check the terminal for current activity; the list is a snapshot. Source failures show a notice, and previously loaded rows are retained when a refresh fails.

## Actions

| Action                                                           | Shortcut    |
| ---------------------------------------------------------------- | ----------- |
| Go to live session window / open project and copy resume command | Enter       |
| Move to selected editor's project window                         | Cmd+E       |
| Open transcript                                                  | Cmd+Enter   |
| Toggle details                                                   | Cmd+D       |
| Copy resume command                                              | Cmd+Shift+C |
| Copy session ID                                                  | Cmd+.       |
| Refresh sources                                                  | Cmd+R       |

The action panel also offers **Choose Zed Window**, explicit new-window opening, folder/transcript reveal, and **Resume in Terminal/iTerm2** for stopped sessions. Terminal resume rechecks ownership and suppresses overlapping requests within the extension. It cannot atomically exclude another program starting the same session at the same instant. Live or uncertain sessions are never automatically resumed. The extension does not terminate processes from its action panel.

VS Code and Cursor remain available in editor preferences. They retain project-window navigation and explicit new-window opening; they do not gain Zed-specific database logic.

## Preferences

| Preference    | Default  | Meaning                                                     |
| ------------- | -------- | ----------------------------------------------------------- |
| Editor        | Zed      | Project window navigation and explicit opening              |
| Terminal      | Terminal | Optional external terminal resume; iTerm2 is also supported |
| Claude CLI    | claude   | Known executable lookup or an absolute executable path      |
| Codex CLI     | codex    | Known executable lookup or an absolute executable path      |
| History Limit | 80       | Recent sessions per provider, capped at 500                 |

Binaries are resolved from known locations (including `~/.local/bin`) and absolute entries in the inherited PATH. Shell startup files, functions and aliases are not executed. If your shell's `codex` is a dashboard function, resume uses the actual Codex executable rather than that function. Set an executable wrapper's absolute path explicitly if you want that behavior.

## Security and privacy

The extension reads session history and Zed workspace metadata locally. It does not upload transcripts, read authentication files/private keys/`.env` files, modify agent settings, install hooks, or write to the source databases. Session files are external input: UUIDs are validated, executables are resolved, and shell arguments are quoted individually. Codex transcript previews also validate that the resolved file remains inside a session store.

Only explicit copy actions change the clipboard; copied commands remain there for you to paste. Clipboard managers may retain them. No simulated keystrokes or automatic clipboard paste are used for Zed. Source errors are reported without logging transcript bodies.

macOS Accessibility access for **Raycast** is required for window menus and selection. Permission granted to a terminal or another app does not grant it to Raycast.

## Development and verification

```sh
npm install
npm test
npm run build
npm run lint
npm run format:check
npm run dev
```

Tests compile with TypeScript and use Node's built-in test runner. Synthetic fixtures cover command injection boundaries, provider identity collisions, exact-path ownership, read-only SQLite catalogs, fallback discovery, and ambiguous Zed targets. `npm run build` writes the installed development bundle under Raycast's extension directory.

See [verification notes](docs/verification.md) and [Zed integration limits](docs/zed-integration.md) for what was checked and what requires GUI testing.

## References

- [PromptCast](https://github.com/raycast/extensions/tree/6bc5707602cfa3506e557e0677f14e216a8fafe7/extensions/codex-claude-cli): provider-specific commands and Zed Terminal Thread workflow; its fixed-delay input automation is not used here.
- [Codex Sessions](https://github.com/raycast/extensions/tree/353e21d9404a329d21bf75a6efea6149f179b75b/extensions/codex-sessions): read-only catalog and bounded rollout fallback.
- [Perch](https://github.com/ReScienceLab/Perch): agent-independent session identity and resume concepts.
- [Agent Sessions](https://github.com/jazzyalex/agent-sessions): source separation and incremental indexing concepts.

This implementation uses those projects as design references; it does not incorporate their source files. Existing generated architecture images describe the earlier Claude-only implementation and are not current specifications.
