/**
 * Real-device regression for Zed window navigation. Manual only: it is not part of `npm test` or CI.
 *
 *   ZED_GUI_TEST=1 npm run test:gui            window navigation
 *   ZED_GUI_TEST=1 npm run test:gui -- spaces  also the fullscreen (own Space) check
 *
 * What it touches on your machine:
 * - It raises each of your existing Zed windows once, then returns focus to where it started.
 * - It opens a few disposable Zed windows whose folder names start with `ztq-`, in a temp directory,
 *   and closes only those. It refuses to start if a `ztq-` window is already open.
 * - The `spaces` check puts one disposable window into native fullscreen and switches Spaces.
 * It needs Zed running, and Accessibility and Automation permission for the terminal you run it from.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type * as EditorModule from "../../src/lib/editor";
import type * as FocusModule from "../../src/lib/focus";
import type * as NativeZedModule from "../../src/lib/native-zed";
import type * as WindowsModule from "../../src/lib/windows";
import type * as ZedTargetsModule from "../../src/lib/zed-targets";
import type * as ZedWorkspacesModule from "../../src/lib/zed-workspaces";
import { installRaycastShim, lib, osascript, report, sleep, until, type Report } from "./support";

const PREFIX = "ztq-";

if (process.platform !== "darwin") {
  console.error("This test drives macOS and Zed.");
  process.exit(2);
}
if (process.env.ZED_GUI_TEST !== "1") {
  console.error(
    "Refusing to run: this opens, raises and closes Zed windows on your desktop.\n" +
      "Read the header of tests/gui/zed.gui.ts, then run: ZED_GUI_TEST=1 npm run test:gui",
  );
  process.exit(2);
}

installRaycastShim();
const { revealProject } = lib<typeof FocusModule>("focus");
const { listWindowTitles, focusWindowTitle } = lib<typeof WindowsModule>("windows");
const { openProjectInNewWindow } = lib<typeof EditorModule>("editor");
const { inspectZedWindows, zedPid } = lib<typeof NativeZedModule>("native-zed");
const { readZedSnapshot } = lib<typeof ZedWorkspacesModule>("zed-workspaces");
const { resolveZedTarget } = lib<typeof ZedTargetsModule>("zed-targets");

const titles = (): Promise<string[]> => listWindowTitles("zed");

async function focused(): Promise<string> {
  const pid = await zedPid();
  return pid === null ? "" : (await inspectZedWindows(pid)).focused;
}

/** Windows Accessibility can see, which is the current Space only. */
async function visibleNames(): Promise<string[]> {
  const out = await osascript(`tell application "System Events" to tell process "zed"
  set out to ""
  repeat with w in windows
    set out to out & (name of w) & linefeed
  end repeat
  return out
end tell`);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function resolvable(cwd: string): Promise<boolean> {
  return resolveZedTarget(cwd, await titles(), await readZedSnapshot()).kind === "matched";
}

async function fullscreenState(title: string): Promise<string> {
  return osascript(`tell application "System Events" to tell process "zed"
  try
    set w to first window whose name starts with "${title}"
    return (value of attribute "AXFullScreen" of w) as text
  on error
    return "not-visible"
  end try
end tell`);
}

async function setFullscreen(title: string, on: boolean): Promise<void> {
  await osascript(`tell application "System Events" to tell process "zed"
  set w to first window whose name starts with "${title}"
  set value of attribute "AXFullScreen" of w to ${on ? "true" : "false"}
end tell`);
}

/** Closes only windows whose title starts with the disposable prefix, leaving fullscreen first. */
async function cleanup(pid: number | null): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const mine = (await titles()).filter((title) => title.startsWith(PREFIX));
    if (mine.length === 0) return;
    await focusWindowTitle("zed", mine[0], pid ?? 0).catch(() => false);
    await sleep(1_500);
    await setFullscreen(mine[0], false).catch(() => undefined);
    await sleep(3_000);
    await osascript(`tell application "System Events" to tell process "zed"
  repeat with w in (every window whose name starts with "${PREFIX}")
    try
      click (first button of w whose subrole is "AXCloseButton")
      exit repeat
    end try
  end repeat
end tell`).catch(() => undefined);
    await sleep(1_500);
  }
}

interface Existing {
  readonly path: string;
  readonly title: string;
}

/** Existing projects that resolve to exactly one window, so a move to them is unambiguous. */
async function uniqueExistingProjects(base: readonly string[], scratch: string): Promise<Existing[]> {
  const snapshot = await readZedSnapshot();
  if (snapshot.kind !== "available") return [];
  const found: Existing[] = [];
  for (const workspace of snapshot.workspaces) {
    const path = workspace.paths[0];
    if (!path || path.startsWith(scratch) || found.some((entry) => entry.path === path)) continue;
    const target = resolveZedTarget(path, base, snapshot);
    if (target.kind === "matched") found.push({ path, title: target.title });
  }
  return found;
}

async function navigation(out: Report, pid: number, base: readonly string[], scratch: string): Promise<void> {
  const existing = await uniqueExistingProjects(base, scratch);

  // Every existing window that resolves uniquely must be moved to, never duplicated.
  for (const project of existing) {
    const before = (await titles()).length;
    let outcome: boolean | string;
    try {
      outcome = await revealProject("Zed", project.path, pid);
    } catch (error) {
      outcome = `threw: ${(error as Error).message}`;
    }
    await sleep(600);
    const now = await focused();
    const after = (await titles()).length;
    out.check(
      `existing window "${project.title}" is moved to, not duplicated`,
      outcome === true && after === before && now === project.title,
      `reused=${String(outcome)} windows ${before}->${after} focused="${now}"`,
    );
  }

  const alpha = join(scratch, `${PREFIX}alpha`);
  const beta = join(scratch, `${PREFIX}beta`);
  const dupA = join(scratch, "x", `${PREFIX}dup`);
  const dupB = join(scratch, "y", `${PREFIX}dup`);
  for (const directory of [alpha, beta, dupA, dupB]) mkdirSync(directory, { recursive: true });

  const opened = (await titles()).length;
  await openProjectInNewWindow("Zed", alpha);
  await until(async () => (await titles()).some((title) => title.startsWith(`${PREFIX}alpha`)));
  out.check("--new opens a disposable window", (await titles()).length === opened + 1);

  // The database can lag the UI: wait until the project resolves, or a reuse check could open a duplicate.
  if (!(await until(() => resolvable(alpha), 25_000))) {
    out.check("the disposable window became resolvable", false, "timed out; skipping the reuse check");
  } else {
    const before = (await titles()).length;
    const reused = await revealProject("Zed", alpha, pid);
    await sleep(600);
    const now = await focused();
    out.check(
      "an open project is reused, with no duplicate window",
      reused === true && (await titles()).length === before && now.startsWith(`${PREFIX}alpha`),
      `reused=${String(reused)} focused="${now}"`,
    );
  }

  const beforeNew = (await titles()).length;
  const reusedBeta = await revealProject("Zed", beta, pid);
  await until(async () => (await titles()).some((title) => title.startsWith(`${PREFIX}beta`)));
  out.check(
    "a project that is not open produces exactly one new window",
    reusedBeta === false && (await titles()).length === beforeNew + 1,
    `reused=${String(reusedBeta)} windows ${beforeNew}->${(await titles()).length}`,
  );

  if (!(await until(() => resolvable(beta), 25_000))) {
    out.check("the second disposable window became resolvable", false, "timed out; skipping");
  } else {
    const before = (await titles()).length;
    const reused = await revealProject("Zed", beta, pid);
    out.check("asking again reuses it", reused === true && (await titles()).length === before);
  }

  // Same folder name at two different paths must be refused, with no window created.
  await openProjectInNewWindow("Zed", dupA);
  await until(async () => (await titles()).some((title) => title.startsWith(`${PREFIX}dup`)));
  await openProjectInNewWindow("Zed", dupB);
  await until(async () => (await titles()).filter((title) => title.startsWith(`${PREFIX}dup`)).length >= 2);
  await sleep(3_000);
  const beforeAmbiguous = (await titles()).length;
  let refusal = "";
  try {
    await revealProject("Zed", dupA, pid);
  } catch (error) {
    refusal = (error as Error).message;
  }
  out.check(
    "same-name projects are refused as ambiguous and no window is created",
    refusal.length > 0 && (await titles()).length === beforeAmbiguous,
    `error="${refusal.slice(0, 80)}"`,
  );
}

async function spaces(out: Report, pid: number, base: readonly string[], scratch: string): Promise<void> {
  const existing = await uniqueExistingProjects(base, scratch);
  const visible = await visibleNames();
  out.note(
    base.length > visible.length
      ? `${base.length - visible.length} existing window(s) live on other Spaces, so the moves above already crossed Spaces.`
      : "All existing windows are on this Space.",
  );

  const fullscreen = join(scratch, `${PREFIX}fs`);
  mkdirSync(fullscreen, { recursive: true });
  await openProjectInNewWindow("Zed", fullscreen);
  await until(async () => (await titles()).some((title) => title.startsWith(`${PREFIX}fs`)));
  out.check("the fullscreen window became resolvable", (await until(() => resolvable(fullscreen), 25_000)) !== null);
  const count = (await titles()).length;

  await setFullscreen(`${PREFIX}fs`, true);
  const entered = await until(async () => (await fullscreenState(`${PREFIX}fs`)) === "true", 10_000, 700);
  await sleep(2_500);
  out.check("the window entered native fullscreen (its own Space)", entered !== null);
  if (entered === null) return;

  out.check(
    "the Window menu lists every window from inside the fullscreen Space",
    (await titles()).length === count,
    `windows ${count} vs ${(await titles()).length}`,
  );

  // Leave the fullscreen Space for an existing project elsewhere, then come back.
  for (const target of existing.slice(0, 2)) {
    const before = (await titles()).length;
    const reused = await revealProject("Zed", target.path, pid);
    await sleep(2_500);
    const now = await focused();
    out.check(
      `from the fullscreen Space to "${target.title}"`,
      reused === true && now === target.title && (await titles()).length === before,
      `reused=${String(reused)} focused="${now}"`,
    );

    const back = await revealProject("Zed", fullscreen, pid);
    await sleep(2_500);
    const returned = await focused();
    out.check(
      `back into the fullscreen Space from "${target.title}"`,
      back === true &&
        returned.startsWith(`${PREFIX}fs`) &&
        (await fullscreenState(`${PREFIX}fs`)) === "true" &&
        (await titles()).length === before,
      `reused=${String(back)} focused="${returned}"`,
    );
  }
  if (existing.length === 0) out.note("SKIP  no uniquely resolvable existing project to switch away to");
}

async function main(): Promise<number> {
  const pid = await zedPid();
  if (pid === null) throw new Error("Zed is not running, or more than one Zed process is");
  const base = await titles();
  if (base.length === 0)
    throw new Error("The window list is unavailable; check Accessibility permission. Nothing was changed.");
  const leftover = base.filter((title) => title.startsWith(PREFIX));
  if (leftover.length > 0) {
    throw new Error(`Close these leftover test windows first: ${leftover.join(", ")}`);
  }

  const withSpaces = process.argv.slice(2).includes("spaces");
  const originalFocus = await focused();
  // Zed records real paths, and the temp directory is reached through a symlink (/var -> /private/var).
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "zed-gui-test-")));
  const out = report();
  out.note(`baseline: ${base.length} windows ${JSON.stringify(base)}, focused="${originalFocus}"`);

  try {
    await navigation(out, pid, base, scratch);
    if (withSpaces) await spaces(out, pid, base, scratch);
  } finally {
    await cleanup(pid);
    await sleep(1_500);
    const end = await titles();
    out.check(
      "cleanup: only the disposable windows were closed and the originals are intact",
      end.length === base.length &&
        base.every((title) => end.includes(title)) &&
        !end.some((t) => t.startsWith(PREFIX)),
      `windows ${base.length} -> ${end.length}`,
    );
    if (originalFocus) await focusWindowTitle("zed", originalFocus, pid).catch(() => false);
    out.note(`final focus: "${await focused()}" (started: "${originalFocus}")`);
    rmSync(scratch, { recursive: true, force: true });
  }

  const { passed, failed } = out.summary();
  console.log(`\n${passed}/${passed + failed} passed`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  async (error: unknown) => {
    console.error(`ABORT: ${(error as Error).message}`);
    await cleanup(await zedPid().catch(() => null)).catch(() => undefined);
    process.exit(2);
  },
);
