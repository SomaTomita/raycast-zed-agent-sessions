import { run } from "./run";

export async function zedPid(): Promise<number | null> {
  const script = `ObjC.import("AppKit");
const applications = $.NSRunningApplication.runningApplicationsWithBundleIdentifier($("dev.zed.Zed"));
const pids = [];
for (let i = 0; i < Number(applications.count); i++) pids.push(Number(applications.objectAtIndex(i).processIdentifier));
JSON.stringify(pids);`;
  const pids = JSON.parse(await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", script])) as number[];
  return pids.length === 1 && Number.isInteger(pids[0]) && pids[0] > 1 ? pids[0] : null;
}

/** Direct AX avoids System Events' stale window cache. No keystrokes or project changes. */
export async function inspectZedWindows(
  pid: number,
  focusTitle?: string,
): Promise<{ titles: string[]; focused: string; reached: boolean }> {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("Invalid Zed process");
  const script = `ObjC.import("ApplicationServices"); ObjC.import("AppKit");
function run(argv) {
  const app = $.AXUIElementCreateApplication(Number(argv[0]));
  function attr(element, name) {
    const output = Ref();
    if ($.AXUIElementCopyAttributeValue(element, $(name), output) !== 0) return null;
    return ObjC.castRefToObject(output[0]);
  }
  const windows = attr(app, "AXWindows");
  if (windows === null) throw new Error("Zed Accessibility windows unavailable");
  const titles = [], matches = [];
  for (let i = 0; i < Number(windows.count); i++) {
    const window = windows.objectAtIndex(i), value = attr(window, "AXTitle");
    const title = value === null ? "" : String(ObjC.unwrap(value));
    titles.push(title);
    if (title === argv[1]) matches.push(window);
  }
  let attempted = false;
  if (argv[1] && matches.length === 1) {
    const window = matches[0];
    if ($.AXUIElementPerformAction(window, $("AXRaise")) === 0) {
      $.AXUIElementSetAttributeValue(window, $("AXMain"), $(true));
      const running = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]));
      if (!running.isNil()) running.activateWithOptions($.NSApplicationActivateIgnoringOtherApps);
      attempted = true;
    }
  }
  const focusedWindow = attr(app, "AXFocusedWindow");
  const focusedValue = focusedWindow === null ? null : attr(focusedWindow, "AXTitle");
  const focused = focusedValue === null ? "" : String(ObjC.unwrap(focusedValue));
  return JSON.stringify({ titles: titles, focused: focused, reached: attempted && focused === argv[1] });
}`;
  return JSON.parse(
    await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, String(pid), focusTitle ?? ""]),
  ) as { titles: string[]; focused: string; reached: boolean };
}
