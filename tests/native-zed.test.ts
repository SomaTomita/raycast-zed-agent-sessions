import assert from "node:assert/strict";
import test from "node:test";

import type * as NativeZedModule from "../src/lib/native-zed";
import { loadLib } from "./helpers/load-lib";

interface Call {
  readonly command: string;
  readonly args: readonly string[];
}

function setup(output: string): { nativeZed: typeof NativeZedModule; calls: Call[] } {
  const calls: Call[] = [];
  const nativeZed = loadLib<typeof NativeZedModule>("native-zed", {
    "./run": {
      run: async (command: string, args: readonly string[]) => {
        calls.push({ command, args });
        return output;
      },
    },
  });
  return { nativeZed, calls };
}

test("zedPid returns the pid when exactly one Zed GUI process exists", async () => {
  const { nativeZed, calls } = setup("[680]");
  assert.equal(await nativeZed.zedPid(), 680);
  assert.equal(calls[0].command, "/usr/bin/osascript");
  assert.deepEqual(calls[0].args.slice(0, 2), ["-l", "JavaScript"]);
});

test("zedPid is null when Zed is not running", async () => {
  assert.equal(await setup("[]").nativeZed.zedPid(), null);
});

test("zedPid is null when several instances make the target ambiguous", async () => {
  assert.equal(await setup("[680,901]").nativeZed.zedPid(), null);
});

test("zedPid never returns a pid that could be a system process", async () => {
  assert.equal(await setup("[1]").nativeZed.zedPid(), null);
  assert.equal(await setup("[0]").nativeZed.zedPid(), null);
});

test("inspectZedWindows rejects an unsafe pid before running anything", async () => {
  for (const pid of [0, 1, -5, 1.5, Number.NaN]) {
    const { nativeZed, calls } = setup("{}");
    await assert.rejects(nativeZed.inspectZedWindows(pid), /Invalid Zed process/);
    assert.deepEqual(calls, []);
  }
});

test("inspectZedWindows passes the pid and focus title as arguments, not script text", async () => {
  const reply = { titles: ["app", "web"], focused: "app", reached: true };
  const { nativeZed, calls } = setup(JSON.stringify(reply));
  const hostile = 'x"; $.NSApplication.terminate(); "';
  assert.deepEqual(await nativeZed.inspectZedWindows(680, hostile), reply);
  const args = calls[0].args;
  assert.deepEqual(args.slice(-2), ["680", hostile]);
  assert.ok(!args[args.indexOf("-e") + 1].includes(hostile), "the title must not be spliced into the script");
});

test("inspectZedWindows without a focus title sends an empty one", async () => {
  const { nativeZed, calls } = setup('{"titles":[],"focused":"","reached":false}');
  await nativeZed.inspectZedWindows(680);
  assert.equal(calls[0].args.at(-1), "");
});
