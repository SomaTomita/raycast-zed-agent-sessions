import { runAppleScript } from "@raycast/utils";

import { editorProcessName, openProjectInNewWindow } from "./editor";
import { appleQuote } from "./quote";
import { focusProjectWindow, listWindowTitles, windowsReadable } from "./windows";
import { readZedSnapshot } from "./zed-workspaces";
import { resolveZedTarget } from "./zed-targets";

/** Selects the exact iTerm2 tab running on `tty`. Returns false when no tab matches. */
export async function focusItermTab(tty: string): Promise<boolean> {
  const result = await runAppleScript(`tell application "iTerm"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (tty of s) is ${appleQuote(tty)} then
          select w
          select t
          select s
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
  return "missing"
end tell`);
  return result.trim() === "ok";
}

/** Selects the exact Terminal.app tab running on `tty`. */
export async function focusTerminalTab(tty: string): Promise<boolean> {
  const result = await runAppleScript(`tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      if (tty of t) is ${appleQuote(tty)} then
        set frontmost of w to true
        set selected of t to true
        return "ok"
      end if
    end repeat
  end repeat
  return "missing"
end tell`);
  return result.trim() === "ok";
}

/**
 * Raises the window already showing `cwd`, and only opens a new window when there is none.
 * Returns true when an existing window was reused.
 */
export async function revealProject(appName: string, cwd: string, hostPid = 0): Promise<boolean> {
  let alreadyOpen = false;
  if (appName === "Zed") {
    const [titles, snapshot] = await Promise.all([listWindowTitles("zed"), readZedSnapshot()]);
    const target = resolveZedTarget(cwd, titles, snapshot);
    if (target.kind === "ambiguous" || target.kind === "unknown") {
      const unreadable = target.kind === "unknown" && !(await windowsReadable("zed"));
      const reason = unreadable
        ? "Could not read Zed's windows; check that Raycast has Accessibility permission"
        : target.reason;
      throw new Error(`${reason}. Use Choose Zed Window or explicitly open a new window`);
    }
    alreadyOpen = target.kind === "matched";
  }
  if (await focusProjectWindow(appName, editorProcessName(appName), cwd, hostPid)) {
    return true;
  }
  // A window that exists but could not be reached must not be answered with a second window for it.
  if (alreadyOpen) {
    throw new Error("The project is already open in Zed, but its window could not be switched to. Nothing was opened");
  }
  await openProjectInNewWindow(appName, cwd);
  return false;
}

/** Whether the editor's windows can be listed; false usually means Accessibility permission is missing. */
export async function canListWindows(appName: string): Promise<boolean> {
  return windowsReadable(editorProcessName(appName));
}

/** Switches to the window for `cwd` if it exists. Never opens, launches, or replaces anything. */
export async function raiseProjectWindow(appName: string, cwd: string, hostPid: number): Promise<boolean> {
  return focusProjectWindow(appName, editorProcessName(appName), cwd, hostPid);
}
