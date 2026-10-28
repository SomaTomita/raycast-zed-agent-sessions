import assert from "node:assert/strict";
import test from "node:test";

import type * as ZedTerminalModule from "../src/lib/zed-terminal";
import type { ZedKey } from "../src/lib/zed-input";
import { loadLib } from "./helpers/load-lib";

const COMMAND = "cd '/work/app' && '/bin/claude' '--resume' '11111111-2222-4333-8444-555555555555'";
const FAST = { waitMs: 60, stepMs: 5, settleMs: 0 } as const;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realTargets = require("../src/lib/zed-targets") as typeof import("../src/lib/zed-targets");

interface World {
  /** The user's Zed keymap.json: text, or null when the file does not exist. */
  keymap?: string | null;
  zed?: number | null;
  titles?: string[];
  focused?: string;
  frontmost?: number | null;
  clipboard?: string;
  /** How many new terminals one Ctrl+Shift+` produces (0 models a rebound key). */
  newTerminals?: number;
  shellCwd?: string | null;
  projectRoots?: string[];
  cwdIsDirectory?: boolean;
  /** Changes made behind our back after the terminal opens. */
  clipboardAfterOpen?: string;
  focusedAfterOpen?: string;
  frontmostAfterOpen?: number;
}

async function prefill(world: World, command = COMMAND, cwd = "/work/app") {
  const posted: ZedKey[] = [];
  let opened = false;
  let clipboard = world.clipboard ?? COMMAND;
  let focused = world.focused ?? "app";
  let frontmost = world.frontmost === undefined ? 680 : world.frontmost;

  const module = loadLib<typeof ZedTerminalModule>("zed-terminal", {
    "node:os": { homedir: () => "/home/test" },
    "node:fs/promises": {
      stat: async (path: string) => {
        if (path.endsWith("keymap.json")) {
          if (world.keymap === null || world.keymap === undefined) {
            throw Object.assign(new Error("no keymap"), { code: "ENOENT" });
          }
          return { size: world.keymap.length, isDirectory: () => false };
        }
        return { size: 0, isDirectory: () => world.cwdIsDirectory !== false };
      },
      readFile: async () => world.keymap ?? "",
      realpath: async (path: string) => path,
    },
    "./native-zed": {
      zedPid: async () => (world.zed === undefined ? 680 : world.zed),
      inspectZedWindows: async () => ({ titles: [], focused, reached: false }),
    },
    "./zed-input": {
      frontmostPid: async () => frontmost,
      postZedKey: async (_pid: number, key: ZedKey) => {
        posted.push(key);
        if (key === "new-terminal") {
          opened = true;
          if (world.clipboardAfterOpen !== undefined) clipboard = world.clipboardAfterOpen;
          if (world.focusedAfterOpen !== undefined) focused = world.focusedAfterOpen;
          if (world.frontmostAfterOpen !== undefined) frontmost = world.frontmostAfterOpen;
        }
      },
    },
    "./windows": { listWindowTitles: async () => world.titles ?? ["app"] },
    "./zed-workspaces": {
      readZedSnapshot: async () => ({
        kind: "available",
        workspaces: [{ windowId: 1, paths: world.projectRoots ?? ["/work/app"] }],
      }),
    },
    "./zed-targets": realTargets,
    "./run": {
      run: async (command_: string, args: readonly string[]) => {
        if (command_ === "/usr/bin/pbpaste") return clipboard;
        if (command_ === "/bin/ps" && args.includes("pid=,ppid=,comm=")) {
          const count = opened ? (world.newTerminals ?? 1) : 0;
          return [
            "700 680 /usr/bin/login",
            "701 700 -zsh",
            ...Array.from({ length: count }, (_, i) => `${9001 + i} 680 /usr/bin/login`),
          ].join("\n");
        }
        if (command_ === "/bin/ps") return "9001 680\n9101 9001\n700 680\n701 700";
        if (command_ === "/usr/sbin/lsof") {
          return world.shellCwd === null ? "" : `p9101\nfcwd\nn${world.shellCwd ?? "/work/app"}`;
        }
        throw new Error(`unexpected command ${command_}`);
      },
    },
  });

  const result = await module.prefillZedTerminal({ cwd, command, ...FAST });
  return { result, posted };
}

function assertSkipped(outcome: Awaited<ReturnType<typeof prefill>>, pattern: RegExp, keys: ZedKey[]): void {
  assert.equal(outcome.result.kind, "skipped");
  assert.match(outcome.result.kind === "skipped" ? outcome.result.reason : "", pattern);
  assert.deepEqual(outcome.posted, keys);
}

test("when every check passes, exactly a new terminal and then a paste are sent", async () => {
  const outcome = await prefill({});
  assert.deepEqual(outcome.result, { kind: "typed" });
  assert.deepEqual(outcome.posted, ["new-terminal", "paste"]);
});

test("a command with a newline is refused, because pasting it would run it", async () => {
  assertSkipped(await prefill({}, "echo one\nrm -rf ~"), /single short line/, []);
  assertSkipped(await prefill({}, "echo one\r"), /single short line/, []);
  assertSkipped(await prefill({}, ""), /single short line/, []);
  assertSkipped(await prefill({}, "x".repeat(5_000)), /single short line/, []);
});

test("a missing or non-directory project is refused", async () => {
  assertSkipped(await prefill({ cwdIsDirectory: false }), /does not exist/, []);
  assertSkipped(await prefill({}, COMMAND, "relative/path"), /does not exist/, []);
});

test("a Zed keymap that mentions Ctrl+Shift+` stops everything before any key", async () => {
  assertSkipped(await prefill({ keymap: '[{"bindings":{"ctrl-shift-`":"editor::Cut"}}]' }), /keymap/, []);
  assertSkipped(await prefill({ keymap: '{"Shift-Ctrl-`": "x"}' }), /keymap/, []);
});

test("an unrelated keymap, or none at all, does not stop it", async () => {
  assert.equal((await prefill({ keymap: '[{"bindings":{"cmd-k v":"markdown::OpenPreview"}}]' })).result.kind, "typed");
  assert.equal((await prefill({ keymap: null })).result.kind, "typed");
});

test("without a single Zed process nothing is sent", async () => {
  assertSkipped(await prefill({ zed: null }), /not running/, []);
});

test("a window that cannot be matched to the project is not trusted", async () => {
  assertSkipped(await prefill({ titles: ["other-project"] }), /could not be confirmed/, []);
});

test("a window that is not the focused one stops everything before any key", async () => {
  assertSkipped(await prefill({ focused: "somewhere else" }), /not in front/, []);
});

test("if another application has the keyboard, no key is sent", async () => {
  assertSkipped(await prefill({ frontmost: 4242 }), /not in front/, []);
  assertSkipped(await prefill({ frontmost: null }), /not in front/, []);
});

test("a clipboard that no longer holds the command stops everything before any key", async () => {
  assertSkipped(await prefill({ clipboard: "something else" }), /clipboard no longer holds/, []);
});

test("if Zed opens no terminal (the key is rebound), nothing is pasted", async () => {
  assertSkipped(await prefill({ newTerminals: 0 }), /did not open a new terminal/, ["new-terminal"]);
});

test("if more than one terminal appeared, it is unclear which is ours and nothing is pasted", async () => {
  assertSkipped(await prefill({ newTerminals: 2 }), /more than one new terminal/, ["new-terminal"]);
});

test("a new terminal that did not open in the project's directory gets nothing", async () => {
  assertSkipped(await prefill({ shellCwd: "/Users/someone" }), /did not open in the project/, ["new-terminal"]);
  assertSkipped(await prefill({ shellCwd: "/work/app-two" }), /did not open in the project/, ["new-terminal"]);
});

test("a terminal whose directory cannot be read gets nothing", async () => {
  assertSkipped(await prefill({ shellCwd: null }), /could not be read/, ["new-terminal"]);
});

test("a clipboard that changed while Zed was busy is not pasted", async () => {
  assertSkipped(await prefill({ clipboardAfterOpen: "a password" }), /clipboard changed/, ["new-terminal"]);
});

test("a window that lost focus while Zed was busy is not pasted into", async () => {
  assertSkipped(await prefill({ focusedAfterOpen: "another window" }), /lost focus/, ["new-terminal"]);
  assertSkipped(await prefill({ frontmostAfterOpen: 4242 }), /lost focus/, ["new-terminal"]);
});

test("a project inside a multi-folder window is accepted when the terminal opens in one of its folders", async () => {
  const outcome = await prefill(
    { projectRoots: ["/work/app", "/work/lib"], titles: ["app, lib"], focused: "app, lib", shellCwd: "/work/lib" },
    COMMAND,
    "/work/lib",
  );
  assert.equal(outcome.result.kind, "typed");
});

test("a session in a subdirectory is accepted when the terminal opens at the project root", async () => {
  const outcome = await prefill({ shellCwd: "/work/app" }, COMMAND, "/work/app/packages/ui");
  assert.equal(outcome.result.kind, "typed");
});

test("the key sequence never contains anything but a new terminal and a paste, in that order", async () => {
  const outcome = await prefill({});
  assert.deepEqual(outcome.posted, ["new-terminal", "paste"]);
  assert.ok(!outcome.posted.some((key) => (key as string) === "return"));
});
