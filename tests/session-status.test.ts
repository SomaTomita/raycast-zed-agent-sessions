import { test } from "node:test";
import assert from "node:assert/strict";
import { processState, zedPresence, matchesStatus } from "../src/lib/session-status";
import type { SessionItem } from "../src/lib/sessions";

test("a stopped process and an open Zed project are independent", () => {
  const item = { live: null, state: "closed" } as SessionItem;
  const presence = zedPresence("/work/api", ["api — main.ts"], {
    kind: "available",
    workspaces: [{ windowId: 1, paths: ["/work/api"] }],
  });
  assert.equal(processState(item), "closed");
  assert.equal(presence, "open");
  assert.equal(matchesStatus(item, "closed", presence), true);
  assert.equal(matchesStatus(item, "zed", presence), true);
  assert.equal(matchesStatus(item, "open", presence), false);
});
test("running does not imply working, and unknown is never closed", () => {
  const running = { live: { pid: 123 }, state: "running" } as SessionItem;
  const unknown = { live: null, state: "unknown" } as SessionItem;
  assert.equal(processState(running), "open");
  assert.equal(matchesStatus(running, "working", "unknown"), false);
  assert.equal(matchesStatus(unknown, "closed", "unknown"), false);
  assert.equal(zedPresence("/work/api", [], { kind: "unavailable", reason: "denied" }), "unknown");
});
