import { basename } from "node:path";

import { runAppleScript } from "@raycast/utils";

import { activateProcess } from "./activate";
import { appleQuote } from "./quote";
import { readZedSnapshot } from "./zed-workspaces";
import { resolveZedTarget } from "./zed-targets";
import { inspectZedWindows, zedPid } from "./native-zed";

/** Zed titles windows `project — active file`; a multi-root workspace lists roots as `a, b`. */
const TITLE_SEPARATOR = " — ";
const ROOT_SEPARATOR = ", ";
/** AppleScript renders a menu separator's name as this. */
const MENU_SEPARATOR = "missing value";

/**
 * Window titles from the application's own Window menu.
 *
 * `windows of process` through the accessibility API only reports windows on the **current Space**,
 * so with one window per desktop it returns one entry out of six. The Window menu lists every
 * window regardless of Space, and clicking an entry switches to it.
 */
async function listMenuWindowTitles(processName: string): Promise<string[]> {
  const output = await runAppleScript(`tell application "System Events"
  if not (exists process ${appleQuote(processName)}) then return ""
  tell process ${appleQuote(processName)}
    try
      set theItems to menu items of menu 1 of menu bar item "Window" of menu bar 1
    on error
      return ""
    end try
    set out to ""
    repeat with mi in theItems
      set out to out & (name of mi as text) & linefeed
    end repeat
    return out
  end tell
end tell`);

  // The window list sits after the last separator; everything before it is window commands.
  const lines = output.split("\n").map((line) => line.trim());
  const lastSeparator = lines.lastIndexOf(MENU_SEPARATOR);
  return lines.slice(lastSeparator + 1).filter((line) => line.length > 0 && line !== MENU_SEPARATOR);
}

/** Fallback for applications without a Window menu: accessibility windows, current Space only. */
async function listAccessibilityWindowTitles(processName: string): Promise<string[]> {
  const output = await runAppleScript(`tell application "System Events"
  if not (exists process ${appleQuote(processName)}) then return ""
  tell process ${appleQuote(processName)}
    set out to ""
    repeat with w in windows
      set out to out & (name of w) & linefeed
    end repeat
    return out
  end tell
end tell`);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export type WindowSnapshot =
  { readonly kind: "available"; readonly titles: string[] } | { readonly kind: "unavailable" };

export async function readWindowTitles(processName: string): Promise<WindowSnapshot> {
  try {
    const fromMenu = await listMenuWindowTitles(processName);
    if (fromMenu.length > 0) {
      return { kind: "available", titles: fromMenu };
    }
  } catch {
    // fall through to the accessibility list
  }
  try {
    return {
      kind: "available",
      titles: await listAccessibilityWindowTitles(processName),
    };
  } catch {
    if (processName === "zed") {
      try {
        const pid = await zedPid();
        if (pid !== null)
          return {
            kind: "available",
            titles: (await inspectZedWindows(pid)).titles,
          };
      } catch {
        /* Unknown access is kept separate from an empty window list. */
      }
    }
    return { kind: "unavailable" };
  }
}

export async function listWindowTitles(processName: string): Promise<string[]> {
  const snapshot = await readWindowTitles(processName);
  return snapshot.kind === "available" ? snapshot.titles : [];
}

/** Every project root currently shown by that application's windows. */
export async function listProjectRoots(processName: string): Promise<Set<string>> {
  return new Set((await listWindowTitles(processName)).flatMap(rootsOf));
}

/** Project roots a window title claims, e.g. `api, web — main.ts` -> both names. */
function rootsOf(title: string): string[] {
  const projectPart = title.split(TITLE_SEPARATOR)[0] ?? "";
  return projectPart
    .split(ROOT_SEPARATOR)
    .map((root) => root.trim())
    .filter((root) => root.length > 0);
}

/**
 * Switches to the existing window for `cwd` and returns true.
 * Returns false when no window matches, leaving the application untouched, so the caller can
 * decide what to do instead of mutating an existing workspace.
 *
 * Zed requires exact DB path corroboration; other editors require a unique title match.
 */
export async function focusProjectWindow(
  appName: string,
  processName: string,
  cwd: string,
  hostPid: number,
): Promise<boolean> {
  const target = basename(cwd);
  if (target.length === 0) {
    return false;
  }

  const titles = await listWindowTitles(processName);
  let title: string;
  if (appName === "Zed") {
    const resolved = resolveZedTarget(cwd, titles, await readZedSnapshot());
    if (resolved.kind !== "matched") return false;
    title = resolved.title;
  } else {
    const matches = titles.filter((entry) => rootsOf(entry).includes(target));
    if (matches.length !== 1) return false;
    title = matches[0];
  }

  return focusWindowTitle(processName, title, hostPid);
}

/** Called only with a unique title, or after the user explicitly selects a window. */
export async function focusWindowTitle(processName: string, title: string, hostPid = 0): Promise<boolean> {
  if ((await listWindowTitles(processName)).filter((entry) => entry === title).length !== 1) return false;

  const nativePid = processName === "zed" ? await zedPid() : null;
  if (nativePid !== null) {
    try {
      if ((await inspectZedWindows(nativePid, title)).reached) return true;
    } catch {
      /* Fall back to the Window menu for windows on other Spaces. */
    }
  }

  // Clicking a menu item needs the application in front, and activation by pid never launches it.
  if (hostPid > 0) {
    try {
      await activateProcess(hostPid);
    } catch {
      return false;
    }
  }

  const clicked = await runAppleScript(`tell application "System Events"
  if not (exists process ${appleQuote(processName)}) then return "missing"
  tell process ${appleQuote(processName)}
    set frontmost to true
    try
      set matchingItems to every menu item of menu 1 of menu bar item "Window" of menu bar 1 whose name is ${appleQuote(title)}
      if (count of matchingItems) is not 1 then return "missing"
      repeat with mi in matchingItems
        if (name of mi as text) is ${appleQuote(title)} then
          click mi
          return "ok"
        end if
      end repeat
    on error
      return "missing"
    end try
    try
      set matchingWindows to every window whose name is ${appleQuote(title)}
      if (count of matchingWindows) is not 1 then return "missing"
      perform action "AXRaise" of item 1 of matchingWindows
      return "ok"
    on error
      return "missing"
    end try
  end tell
end tell`);

  if (clicked.trim() !== "ok") return false;
  if (processName === "zed") {
    if (nativePid === null) return false;
    try {
      return (await inspectZedWindows(nativePid)).focused === title;
    } catch {
      return false;
    }
  }
  return true;
}
