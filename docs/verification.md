# Verification

Date: 2026-10-28.

The user chose to extend the existing Raycast extension. PromptCast was inspected as a source reference; it was not installed or run. No repository rename, publication, edits to existing agent/Zed settings, hooks, or process termination were performed.

## Automated checks

- `npm test`: 20 passing tests using synthetic data. Includes read-only SQLite queries, optional schema columns, archived filtering, rollout fallback, symlink confinement, command quoting, UUID validation, exact-path ownership and provider-isolated live merging.
- `tsc --noEmit`: passed.
- `npm run build`: passed; generated the local Raycast development bundle and checked TypeScript.
- `npm run lint`: manifest and icon validation passed. Raycast initially skipped ESLint because the project did not have it installed. `npm run format:check` also passed with Prettier.

Local inspection was limited to Zed CLI help, Zed workspace schema/path encoding, and Codex catalog source categories. No authentication files or private keys were read. No existing session was resumed or stopped for validation.

## Scope

Implemented: unified Claude/Codex list and previews, provider/path filters, read-only Codex catalog and bounded fallback, observed ownership with an unknown state, safe command construction, conservative Zed window resolution, explicit window picker and manual Zed resume commands.

Not implemented: automatic command injection into Zed terminals, selection of the exact existing Zed terminal, annotations/pins, full-text transcript search, usage monitoring or hooks. The latter features are outside the initial release described by the plan.

## GUI checks completed

- Launched the built extension in Raycast and visually verified the combined list, agent dropdown, the simplified Active/History sections, Claude orange / Codex purple labels, confirmed Working/Idle badges, and blue Zed-project window icons, and registered command name **Coding Agent Sessions**.
- Opened four disposable Zed windows with the production new-window action/CLI.
- Verified production focus using fresh native AX focused-window data, existing-project reuse without another window, and same-name ambiguity refusal.
- Confirmed original project windows remained, then closed only the four disposable windows via their own native close-button elements.

The ordinary sandbox could not connect to System Events; the permitted GUI execution context could. Initial success based only on menu execution was strengthened to native focused-title validation before the final passing smoke test.

## Dependency audit

A non-breaking audit fix updated vulnerable transitive brace-expansion dependencies. The final report retains two low-severity entries in the existing Raycast API/esbuild build-tool chain for a Windows development-server issue. Removing those requires a major Raycast API update; it was not forced into this feature change.

## Remaining manual check list

1. Open two disposable Zed projects with distinct names. Select each session from Raycast; verify the correct window is focused.
2. Put one window on another Space. Repeat and verify no new window is created for a matched project.
3. Open same-named projects at different full paths. Verify automatic navigation refuses ambiguous matches; choose a unique window title explicitly.
4. Deny Accessibility access. Verify lookup failure does not spawn a session or terminate a process.
5. Copy a history session's resume command. Verify its provider, quoted executable, session UUID and project directory before pasting in a disposable terminal.
6. Verify unsupported Codex sources have no CLI resume action, and unknown/live ownership prevents external automatic resume.
7. Select VS Code/Cursor preferences and verify existing navigation behavior.

Cross-Space/fullscreen navigation, denied-access behavior in Raycast itself, and VS Code/Cursor GUI checks remain outstanding. Existing user workspaces were not rearranged for those tests. See `docs/zed-integration.md` for the completed disposable-window checks.

## UI simplification follow-up

Removed per-row Open/Closed/Process ? and Project Open/Closed badges. Activity is shown only when confirmed; unconfirmed runtime and project presence remain in details. Reopened the command without restarting Raycast and visually confirmed the new layout. All 20 tests, TypeScript, build, format checks and Raycast manifest/icon checks passed. Existing Zed windows were not manipulated during this UI-only update.

## Codex lifecycle and final activity-only UI

The earlier blue project-window icons were removed: an open project folder does not establish that a particular saved conversation is open. The final list uses Claude orange / Codex teal, Active/History sections, and confirmed Working/Idle activity only. No project-open/closed indicators remain in the list.

Codex activity now combines observed process ownership with read-only lifecycle events (`task_started`, `task_complete`, `turn_aborted`). Lifecycle records are cached and updated from appended bytes so long-running turns do not lose their start event outside a short tail. Runtime refresh is 3 seconds; catalog refresh remains 30 seconds. A read-only check of this environment returned 1 busy, 6 idle, and 0 unconfirmed owned Codex instances at that moment; no conversation body was emitted.

All 29 tests passed, including delayed old-turn completion, interruption, long turns, partial writes, cursor truncation, fast refresh, and preventing saved completion alone from implying a live session. Activity is based on lifecycle evidence, not CPU utilization or merely having a project open. Very large logs or unavailable evidence can still leave activity unconfirmed.

## Contrast and grouping refinement

Renamed the live section to Open Sessions. Codex now uses blue, Idle neutral gray, and Working yellow. Filled provider-colored circles identify open sessions; gray clock icons identify history. Section subtitles distinguish running versus saved counts. This uses native Raycast List.Section properties without artificial selectable separator rows.
