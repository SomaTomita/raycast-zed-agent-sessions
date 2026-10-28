import assert from "node:assert/strict";
import test from "node:test";

import type * as ZedInputModule from "../src/lib/zed-input";
import { loadLib } from "./helpers/load-lib";

interface Call {
  readonly command: string;
  readonly args: readonly string[];
}

function setup(output = ""): { input: typeof ZedInputModule; calls: Call[] } {
  const calls: Call[] = [];
  const input = loadLib<typeof ZedInputModule>("zed-input", {
    "./run": {
      run: async (command: string, args: readonly string[]) => {
        calls.push({ command, args });
        return output;
      },
    },
  });
  return { input, calls };
}

test("a new terminal is requested with Control+Shift+backquote, sent to the given process", async () => {
  const { input, calls } = setup();
  await input.postZedKey(680, "new-terminal");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/usr/bin/osascript");
  // pid, key code (50) and flags (control 0x40000 + shift 0x20000 = 393216) are the trailing arguments
  assert.deepEqual(calls[0].args.slice(-3), ["680", "50", "393216"]);
});

test("a paste is Command+V, sent to the given process", async () => {
  const { input, calls } = setup();
  await input.postZedKey(680, "paste");
  assert.deepEqual(calls[0].args.slice(-3), ["680", "9", "1048576"]);
});

test("the values reach the script as arguments, never as script text", async () => {
  const { input, calls } = setup();
  await input.postZedKey(68012, "paste");
  const script = calls[0].args[calls[0].args.indexOf("-e") + 1];
  for (const value of ["68012", "1048576"]) {
    assert.ok(!script.includes(value), `${value} must not be spliced into the script`);
  }
});

test("no other key can be sent: not Return, not Enter, not a letter, not a name tricked past the list", async () => {
  const { input, calls } = setup();
  for (const key of ["return", "enter", "tab", "escape", "a", "constructor", "__proto__", "toString", ""]) {
    await assert.rejects(input.postZedKey(680, key as never), /unlisted key/, key);
  }
  assert.deepEqual(calls, []);
});

test("a pid that could be a system process, or is not a pid, is refused before anything runs", async () => {
  const { input, calls } = setup();
  for (const pid of [0, 1, -5, 1.5, Number.NaN]) {
    await assert.rejects(input.postZedKey(pid, "paste"), /Invalid Zed process/, String(pid));
  }
  assert.deepEqual(calls, []);
});

test("the frontmost application's pid is read, and anything unreadable is null", async () => {
  assert.equal(await setup("680\n").input.frontmostPid(), 680);
  assert.equal(await setup("").input.frontmostPid(), null);
  assert.equal(await setup("not a pid").input.frontmostPid(), null);
  assert.equal(await setup("1").input.frontmostPid(), null);
});
