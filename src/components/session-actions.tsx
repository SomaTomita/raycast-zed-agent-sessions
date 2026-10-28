import { Action, ActionPanel, Clipboard, Icon, showToast, Toast, Keyboard } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import { editorLabel, openProjectInNewWindow } from "../lib/editor";
import { revealProject } from "../lib/focus";
import { goToSession } from "../lib/goto";
import { readLiveSessions } from "../lib/registry";
import { readCodexRuntime } from "../lib/codex-live";
import { CodexRecord } from "../lib/codex-records";
import { resumeCommand, resumeInTerminal, TerminalApp } from "../lib/resume";
import { providerLabel, sessionKey } from "../lib/session-types";
import { resolveBinary } from "../lib/binary";
import { shellQuote } from "../lib/quote";
import { SessionItem } from "../lib/sessions";
import { TranscriptView } from "./transcript-view";
import { ZedWindowPicker } from "./zed-window-picker";
import { FilterProps, SessionFilters } from "./session-filters";

interface Props {
  readonly item: SessionItem;
  readonly terminal: TerminalApp;
  readonly editor: string;
  readonly claudeBin: string;
  readonly codexBin: string;
  readonly onRefresh: () => void;
  readonly onToggleDetail: () => void;
  readonly filters: FilterProps;
}

// Shared by all rows: repeated Enter must not launch overlapping copies.
const pending = new Set<string>();

export function SessionActions({
  item,
  terminal,
  editor,
  claudeBin,
  codexBin,
  onRefresh,
  onToggleDetail,
  filters,
}: Props) {
  const preferred = item.provider === "codex" ? codexBin : claudeBin;
  const terminalLabel = terminal === "iTerm" ? "iTerm2" : "Terminal";

  /** `quiet` skips the success toast when the caller reports the copy together with its own result. */
  async function copyCommand(quiet = false): Promise<boolean> {
    try {
      if (!item.resumable) throw new Error("CLI resume has not been verified for this session source");
      await Clipboard.copy(await resumeCommand(item, preferred));
      if (!quiet) {
        await showToast({
          style: Toast.Style.Success,
          title: "Copied resume command",
          message: "Paste it in the project's Zed terminal; avoid resuming a session that is already running",
        });
      }
      return true;
    } catch (error) {
      await showFailureToast(error, { title: "Could not copy resume command" });
      return false;
    }
  }

  /** `copied` is set when the resume command is already in the clipboard, so both outcomes say so. */
  async function openEditor(copied = false) {
    try {
      const reused = await revealProject(editor, item.cwd, item.live?.hostKind === "editor" ? item.live.hostPid : 0);
      await showToast({
        style: Toast.Style.Success,
        title: reused ? `Moved to ${editorLabel(editor)} project` : `Opened new ${editorLabel(editor)} window`,
        message: copied
          ? "Resume command copied; paste it in the project's terminal"
          : "Project window only; no terminal command was sent",
      });
    } catch (error) {
      await showFailureToast(error, {
        title: copied
          ? "Resume command copied, but no unique project window was found"
          : "Could not identify a unique project window",
      });
    }
  }

  async function openInNewWindow() {
    try {
      await openProjectInNewWindow(editor, item.cwd);
    } catch (error) {
      await showFailureToast(error, { title: "Could not open project" });
    }
  }

  /** A second press while a window action is still running is ignored, so one Enter opens one window. */
  async function once(task: () => Promise<void>) {
    const key = `window:${sessionKey(item.provider, item.sessionId)}`;
    if (pending.has(key)) return;
    pending.add(key);
    try {
      await task();
    } finally {
      pending.delete(key);
    }
  }

  async function primary() {
    if (item.live !== null) {
      try {
        const result = await goToSession(item);
        if (result.kind !== "needs-resume") {
          await showToast({
            style: Toast.Style.Success,
            title: result.title,
            message: result.message,
          });
          return;
        }
        await openEditor();
      } catch (error) {
        await showFailureToast(error, { title: "Could not reach session" });
      }
      return;
    }
    // Copy first: lookup failure leaves a useful command without injecting it anywhere.
    const copied = item.resumable && (await copyCommand(true));
    await openEditor(copied);
  }

  async function explicitTerminalResume() {
    const key = sessionKey(item.provider, item.sessionId);
    if (pending.has(key)) return;
    pending.add(key);
    try {
      // A background job has no process or registry file, so the liveness checks below cannot see it.
      if (!item.resumable || item.live || item.agent !== null || item.state === "unknown")
        throw new Error("Session is running or its ownership is unknown; automatic resume was blocked");
      if (item.provider === "claude") {
        if ((await readLiveSessions()).some((live) => live.sessionId === item.sessionId))
          throw new Error("This session is already running");
      } else {
        const session: CodexRecord = {
          id: item.sessionId,
          cwd: item.cwd,
          path: item.transcript?.path ?? "",
          title: item.title,
          firstPrompt: "",
          updatedAt: item.lastActivityMs,
          branch: item.gitBranch,
          model: item.model,
          source: item.source,
          resumable: item.resumable,
        };
        const runtime = await readCodexRuntime([session]);
        if (runtime.uncertain || runtime.live.has(item.sessionId))
          throw new Error("Could not confirm this Codex session is stopped");
      }
      await resumeInTerminal({ terminal, target: item, preferred });
      await showToast({
        style: Toast.Style.Success,
        title: `Sent resume command to ${terminalLabel}`,
        message: "Check the terminal for CLI startup",
      });
      onRefresh();
    } catch (error) {
      await showFailureToast(error, { title: "Could not resume session" });
    } finally {
      pending.delete(key);
    }
  }

  return (
    <ActionPanel>
      <ActionPanel.Section>
        {item.agent !== null ? (
          <Action
            title="Copy Attach Command"
            icon={Icon.CopyClipboard}
            onAction={async () => {
              try {
                const id = item.agent?.id ?? "";
                if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error("Invalid background job ID");
                await Clipboard.copy(
                  `${shellQuote(await resolveBinary("claude", claudeBin))} attach ${shellQuote(id)}`,
                );
                await showToast({ style: Toast.Style.Success, title: "Copied attach command" });
              } catch (error) {
                await showFailureToast(error, { title: "Could not copy attach command" });
              }
            }}
          />
        ) : (
          <Action
            title={
              item.live
                ? "Go to Session Window"
                : item.resumable
                  ? `Open in ${editorLabel(editor)} and Copy Resume Command`
                  : `Open Project in ${editorLabel(editor)}`
            }
            icon={Icon.AppWindow}
            onAction={() => once(primary)}
          />
        )}
        <Action
          title={`Move to ${editorLabel(editor)} Project`}
          icon={Icon.Code}
          shortcut={Keyboard.Shortcut.Common.Edit}
          onAction={() => once(() => openEditor())}
        />
        {editor === "Zed" ? (
          <Action.Push title="Choose Zed Window" icon={Icon.AppWindow} target={<ZedWindowPicker />} />
        ) : null}
        <Action
          title={`Open Project in New ${editorLabel(editor)} Window`}
          icon={Icon.Plus}
          onAction={() => once(openInNewWindow)}
        />
        {item.transcript ? (
          <Action.Push
            title="Open Transcript"
            icon={Icon.Document}
            shortcut={{ modifiers: ["cmd"], key: "return" }}
            target={<TranscriptView item={item} />}
          />
        ) : null}
        <Action
          title="Toggle Details"
          icon={Icon.Sidebar}
          shortcut={{ modifiers: ["cmd"], key: "d" }}
          onAction={onToggleDetail}
        />
      </ActionPanel.Section>
      <ActionPanel.Section title={providerLabel(item.provider)}>
        {item.resumable ? (
          <Action
            title="Copy Resume Command"
            icon={Icon.CopyClipboard}
            shortcut={Keyboard.Shortcut.Common.Copy}
            onAction={() => copyCommand()}
          />
        ) : null}
        {item.agent === null && item.resumable && !item.live && item.state !== "unknown" ? (
          <Action title={`Resume in ${terminalLabel}`} icon={Icon.Terminal} onAction={explicitTerminalResume} />
        ) : null}
        <Action.CopyToClipboard
          title="Copy Session ID"
          content={item.sessionId}
          shortcut={Keyboard.Shortcut.Common.Pin}
        />
        {item.cwd ? <Action.CopyToClipboard title="Copy Directory Path" content={item.cwd} /> : null}
        {item.cwd ? <Action.ShowInFinder title="Open Project Folder" path={item.cwd} /> : null}
        {item.transcript ? <Action.ShowInFinder title="Show Transcript in Finder" path={item.transcript.path} /> : null}
        <Action
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={onRefresh}
        />
      </ActionPanel.Section>
      <SessionFilters {...filters} />
    </ActionPanel>
  );
}
