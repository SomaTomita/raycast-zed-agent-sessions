import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCodexActivity } from "../src/lib/codex-activity";
import { applyRuntimeSnapshot, SessionItem } from "../src/lib/sessions";
import { LiveSession } from "../src/lib/registry";

const event = (type: string, id = "turn-a") =>
  JSON.stringify({ type: "event_msg", timestamp: "2026-10-28T12:00:00Z", payload: { type, turn_id: id } }) + "\n";
test("Codex lifecycle starts working and becomes idle only after completion", () => {
  assert.equal(parseCodexActivity(event("task_started")).status, "busy");
  assert.equal(parseCodexActivity(event("task_started") + event("task_complete")).status, "idle");
});
test("an interrupted turn becomes idle", () => {
  assert.equal(parseCodexActivity(event("task_started") + event("turn_aborted")).status, "idle");
});
test("a delayed completion for an earlier turn does not stop a newer turn", () => {
  const sequence = event("task_started", "old") + event("task_started", "new") + event("task_complete", "old");
  assert.equal(parseCodexActivity(sequence).status, "busy");
  assert.equal(parseCodexActivity(sequence + event("task_complete", "new")).status, "idle");
});
test("messages, token counts, and malformed partial events do not imply idle", () => {
  assert.equal(parseCodexActivity(event("token_count")).status, "running");
  assert.equal(parseCodexActivity(event("task_complete") + '{"type":"event_msg"').status, "running");
  assert.equal(parseCodexActivity("{bad}\n" + event("task_started")).status, "busy");
});
test("a completion in a bounded tail is sufficient activity evidence when ownership exists", () => {
  assert.deepEqual(parseCodexActivity(event("task_complete")), {
    status: "idle",
    at: Date.parse("2026-10-28T12:00:00Z"),
  });
});
const id = "12345678-1234-1234-1234-123456789abc";
const item: SessionItem = {
  provider: "codex",
  key: `codex:${id}`,
  sessionId: id,
  resumable: true,
  source: "cli",
  title: "test",
  state: "unknown",
  statusLabel: "unconfirmed",
  live: null,
  agent: null,
  transcript: null,
  lastPrompt: null,
  cwd: "/work/api",
  project: "api",
  gitBranch: "",
  model: "",
  lastActivityMs: 0,
  messageCount: null,
  messageCountExact: false,
};
const instance: LiveSession = {
  pid: 123,
  sessionId: id,
  cwd: "/work/api",
  name: "test",
  status: "busy",
  kind: "codex",
  entrypoint: "",
  version: "",
  startedAt: null,
  statusUpdatedAt: 1,
  hostKind: "editor",
  hostApp: "Zed",
  hostPid: 1,
  tty: "",
  waitingFor: "",
};
test("fast runtime refresh updates Codex Working/Idle without a catalog rescan", () => {
  const base = { claude: null, codexUncertain: true, observedAt: 1 };
  const working = applyRuntimeSnapshot([item], { ...base, codex: [[id, [instance]]] });
  assert.equal(working[0].state, "working");
  const idle = applyRuntimeSnapshot(working, { ...base, codex: [[id, [{ ...instance, status: "idle" }]]] });
  assert.equal(idle[0].state, "waiting");
  const gone = applyRuntimeSnapshot(idle, { ...base, codex: [] });
  assert.equal(gone[0].live, null);
  assert.equal(gone[0].state, "unknown");
});
test("saved completion alone cannot turn a stopped session into an active idle session", () => {
  const stopped = applyRuntimeSnapshot([item], { claude: null, codex: [], codexUncertain: false, observedAt: 1 });
  assert.equal(stopped[0].state, "closed");
  assert.equal(stopped[0].live, null);
});

test("long turns retain their start event beyond the tail and update incrementally", async () => {
  const { mkdtemp, writeFile, appendFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readCodexActivity } = await import("../src/lib/codex-activity");
  const root = await mkdtemp(join(tmpdir(), "codex-activity-"));
  try {
    const path = join(root, "rollout-synthetic.jsonl");
    const noise =
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", padding: "x".repeat(1024) } }) + "\n";
    await writeFile(path, event("task_started") + noise.repeat(900));
    assert.equal((await readCodexActivity(path)).status, "busy");
    await appendFile(path, event("task_complete"));
    assert.equal((await readCodexActivity(path)).status, "idle");
    assert.equal((await readCodexActivity(path)).status, "idle");
    await writeFile(path, event("task_started", "replacement"));
    assert.equal((await readCodexActivity(path)).status, "busy");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("incremental activity reads wait for incomplete lifecycle records to finish", async () => {
  const { mkdtemp, writeFile, appendFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readCodexActivity } = await import("../src/lib/codex-activity");
  const root = await mkdtemp(join(tmpdir(), "codex-partial-"));
  try {
    const path = join(root, "rollout-synthetic.jsonl");
    await writeFile(path, event("task_complete"));
    assert.equal((await readCodexActivity(path)).status, "idle");
    const next = event("task_started", "next");
    await appendFile(path, next.slice(0, 35));
    assert.equal((await readCodexActivity(path)).status, "running");
    await appendFile(path, next.slice(35));
    assert.equal((await readCodexActivity(path)).status, "busy");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
