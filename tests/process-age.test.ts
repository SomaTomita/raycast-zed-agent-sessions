import assert from "node:assert/strict";
import test from "node:test";

import type * as ProcessAgeModule from "../src/lib/process-age";
import { loadLib } from "./helpers/load-lib";

function setup(output: string | Error): { processAge: typeof ProcessAgeModule; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const processAge = loadLib<typeof ProcessAgeModule>("process-age", {
    "./run": {
      run: async (_command: string, args: readonly string[]) => {
        calls.push(args);
        if (output instanceof Error) throw output;
        return output;
      },
    },
  });
  return { processAge, calls };
}

test("elapsed time parses every ps format", () => {
  const { processAge } = setup("");
  assert.equal(processAge.parseElapsedSeconds("00:07"), 7);
  assert.equal(processAge.parseElapsedSeconds("12:34"), 12 * 60 + 34);
  assert.equal(processAge.parseElapsedSeconds("03:40:30"), 3 * 3600 + 40 * 60 + 30);
  assert.equal(processAge.parseElapsedSeconds("2-01:00:00"), 2 * 86400 + 3600);
  assert.equal(processAge.parseElapsedSeconds(" 05:00 "), 300);
});

test("anything that is not an elapsed time is rejected", () => {
  const { processAge } = setup("");
  for (const bad of ["", "abc", "12", "1:2:3:4", "-5:00", "05:00x"]) {
    assert.equal(processAge.parseElapsedSeconds(bad), null, bad);
  }
});

test("process ages are read with one ps call, and unparseable lines are skipped", async () => {
  const { processAge, calls } = setup("    1  10-02:03:04\n  500     00:42\n  junk line\n  501  notatime\n");
  const ages = await processAge.readProcessAges();
  assert.deepEqual(
    [...ages],
    [
      [1, 10 * 86400 + 2 * 3600 + 3 * 60 + 4],
      [500, 42],
    ],
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["-axo", "pid=,etime="]);
});

test("a failing ps gives an empty map instead of an exception", async () => {
  const { processAge } = setup(new Error("ps failed"));
  assert.equal((await processAge.readProcessAges()).size, 0);
});

test("a process that started when the session file says is the same process", () => {
  const { processAge } = setup("");
  const now = 1_000_000_000_000;
  const age = 3_600;
  assert.equal(processAge.isSameProcess(now - age * 1000 + 2_000, age, now), true);
});

test("a process that started hours away from the session file is a reused pid", () => {
  const { processAge } = setup("");
  const now = 1_000_000_000_000;
  // The file was written 3 hours ago, but the pid's current owner started 5 minutes ago.
  assert.equal(processAge.isSameProcess(now - 3 * 3_600_000, 300, now), false);
});

test("the tolerance is a few minutes either way, and no more", () => {
  const { processAge } = setup("");
  const now = 1_000_000_000_000;
  const age = 1_000;
  const started = now - age * 1000;
  assert.equal(processAge.isSameProcess(started + 179_000, age, now), true);
  assert.equal(processAge.isSameProcess(started - 179_000, age, now), true);
  assert.equal(processAge.isSameProcess(started + 181_000, age, now), false);
  assert.equal(processAge.isSameProcess(started - 181_000, age, now), false);
});

test("when either side is unknown the session is kept rather than hidden", () => {
  const { processAge } = setup("");
  assert.equal(processAge.isSameProcess(null, 300, 1_000_000_000_000), true);
  assert.equal(processAge.isSameProcess(123, undefined, 1_000_000_000_000), true);
});
