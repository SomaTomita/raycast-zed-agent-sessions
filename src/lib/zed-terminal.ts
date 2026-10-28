import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { inspectZedWindows, zedPid } from "./native-zed";
import { run } from "./run";
import { frontmostPid, postZedKey } from "./zed-input";
import { listWindowTitles } from "./windows";
import { containsProject, resolveZedTarget } from "./zed-targets";
import { readZedSnapshot } from "./zed-workspaces";

/**
 * Opens a new terminal in the project's Zed window and pastes a command into it, without running it.
 *
 * Zed has no API for this, so it takes two key presses (see zed-input.ts). Because a key sent to the
 * wrong place could paste a command into an editor buffer, every step is checked before the next one,
 * and any doubt stops the sequence. The command is never typed or run here: the user presses Return.
 */
export type PrefillResult = { readonly kind: "typed" } | { readonly kind: "skipped"; readonly reason: string };

export interface PrefillOptions {
  readonly cwd: string;
  /** The exact text that must be on the clipboard. It is pasted, never typed, and must be one line. */
  readonly command: string;
  /** How long to wait for Zed to settle at each step. Tests shorten these. */
  readonly waitMs?: number;
  readonly stepMs?: number;
  readonly settleMs?: number;
}

const MAX_COMMAND_LENGTH = 4_096;
const MAX_KEYMAP_BYTES = 1_000_000;
/** A user keymap that mentions this key may have given it another meaning, so it is not pressed. */
const REBOUND_KEY = /(ctrl-shift-|shift-ctrl-)`/i;

const skipped = (reason: string): PrefillResult => ({ kind: "skipped", reason });
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function keymapMayRebindNewTerminal(): Promise<boolean> {
  const file = join(homedir(), ".config/zed/keymap.json");
  try {
    if ((await stat(file)).size > MAX_KEYMAP_BYTES) return true;
    return REBOUND_KEY.test(await readFile(file, "utf8"));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/** pids of the `login` processes Zed starts for its terminals. */
async function terminalLogins(zed: number): Promise<number[]> {
  const table = await run("/bin/ps", ["-axo", "pid=,ppid=,comm="]);
  return table
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => Number(cols[1]) === zed && (cols[2] ?? "").endsWith("/login"))
    .map((cols) => Number(cols[0]));
}

async function childOf(parent: number): Promise<number | null> {
  const table = await run("/bin/ps", ["-axo", "pid=,ppid="]);
  const child = table
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .find((cols) => cols[1] === parent);
  return child === undefined ? null : child[0];
}

async function cwdOf(pid: number): Promise<string | null> {
  const output = await run("/usr/sbin/lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"]);
  const line = output.split("\n").find((entry) => entry.startsWith("n"));
  return line === undefined ? null : line.slice(1);
}

async function same(a: string, b: string): Promise<boolean> {
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return false;
  }
}

async function poll<T>(task: () => Promise<T | null>, waitMs: number, stepMs: number): Promise<T | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const value = await task();
    if (value !== null) return value;
    if (Date.now() >= deadline) return null;
    await sleep(stepMs);
  }
}

export async function prefillZedTerminal(options: PrefillOptions): Promise<PrefillResult> {
  const { cwd, command } = options;
  const waitMs = options.waitMs ?? 6_000;
  const stepMs = options.stepMs ?? 200;
  const settleMs = options.settleMs ?? 500;

  try {
    if (command.length === 0 || command.length > MAX_COMMAND_LENGTH || /[\r\n]/.test(command)) {
      return skipped("the command is not a single short line");
    }
    if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) {
      return skipped("the project directory does not exist");
    }
    if (await keymapMayRebindNewTerminal()) {
      return skipped("your Zed keymap mentions Ctrl+Shift+`, so it is not pressed");
    }

    const zed = await zedPid();
    if (zed === null) return skipped("Zed is not running, or more than one Zed is");

    // The window must be the project's, and in front, before any key is sent. The workspace list is read
    // on every attempt: a window opened a moment ago reaches Zed's database a little later.
    const target = await poll(
      async () => {
        const snapshot = await readZedSnapshot();
        const resolved = resolveZedTarget(cwd, await listWindowTitles("zed"), snapshot);
        if (resolved.kind !== "matched" || snapshot.kind !== "available") return null;
        const roots = snapshot.workspaces
          .flatMap((workspace) => workspace.paths)
          .filter((path) => containsProject(cwd, path));
        return { title: resolved.title, roots };
      },
      waitMs,
      stepMs,
    );
    if (target === null) return skipped("the project's Zed window could not be confirmed");
    const roots = target.roots;

    const inFront = async (): Promise<boolean> =>
      (await frontmostPid()) === zed && (await inspectZedWindows(zed)).focused === target.title;
    if ((await poll(async () => ((await inFront()) ? true : null), waitMs, stepMs)) === null) {
      return skipped("the project's Zed window is not in front");
    }

    if ((await run("/usr/bin/pbpaste", [])) !== command) return skipped("the clipboard no longer holds the command");

    // Open a terminal, and only go on if exactly one new terminal appeared.
    const before = new Set(await terminalLogins(zed));
    await postZedKey(zed, "new-terminal");
    const fresh = await poll(
      async () => {
        const added = (await terminalLogins(zed)).filter((pid) => !before.has(pid));
        return added.length > 0 ? added : null;
      },
      waitMs,
      stepMs,
    );
    if (fresh === null) return skipped("Zed did not open a new terminal (is Ctrl+Shift+` rebound?)");
    if (fresh.length !== 1) return skipped("more than one new terminal appeared");

    const shell = await poll(() => childOf(fresh[0]), waitMs, stepMs);
    const shellCwd = shell === null ? null : await cwdOf(shell);
    if (shellCwd === null) return skipped("the new terminal's directory could not be read");
    const inProject = (await Promise.all(roots.map((root) => same(root, shellCwd)))).some(Boolean);
    if (!inProject) return skipped("the new terminal did not open in the project's directory");

    // Last look before the only paste: nothing may have changed while Zed was busy.
    await sleep(settleMs);
    if (!(await inFront())) return skipped("the project's Zed window lost focus");
    if ((await run("/usr/bin/pbpaste", [])) !== command) return skipped("the clipboard changed");

    await postZedKey(zed, "paste");
    return { kind: "typed" };
  } catch (error) {
    return skipped(error instanceof Error ? error.message : "an unexpected error");
  }
}
