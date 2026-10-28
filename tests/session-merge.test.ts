import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLiveSessions, SessionItem } from "../src/lib/sessions";
import { LiveSession } from "../src/lib/registry";
const id = "12345678-1234-1234-1234-123456789abc";
const live = (pid: number): LiveSession => ({
  pid,
  sessionId: id,
  cwd: "/work/api",
  name: "test",
  status: "idle",
  kind: "interactive",
  entrypoint: "cli",
  version: "",
  startedAt: 123,
  statusUpdatedAt: 456,
  hostKind: "editor",
  hostApp: "Zed",
  hostPid: 1,
  tty: "",
  waitingFor: "",
});
const item = (provider: "claude" | "codex"): SessionItem => ({
  provider,
  key: `${provider}:${id}`,
  sessionId: id,
  resumable: true,
  source: "cli",
  title: "test",
  state: "closed",
  statusLabel: "history",
  live: null,
  agent: null,
  transcript: null,
  lastPrompt: null,
  cwd: "/work/api",
  project: "api",
  gitBranch: "",
  model: "",
  lastActivityMs: 1,
  messageCount: null,
  messageCountExact: false,
});
test("Claude live refresh never removes Codex rows with an identical session ID", () => {
  const codex = item("codex");
  const result = applyLiveSessions([item("claude"), codex], [live(123), live(456)]);
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map((row) => row.key)).size, 3);
  assert.ok(result.includes(codex));
});
test("two Claude processes become one history row after both stop", () => {
  const running = applyLiveSessions([item("claude"), item("codex")], [live(123), live(456)]);
  const stopped = applyLiveSessions(running, []);
  assert.equal(stopped.filter((row) => row.provider === "claude").length, 1);
  assert.equal(stopped.find((row) => row.provider === "claude")?.state, "closed");
});
