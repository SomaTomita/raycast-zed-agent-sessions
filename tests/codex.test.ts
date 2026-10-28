import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { codexRecord, parseCodexMessages, parseRolloutHead } from "../src/lib/codex-records";
import { readCodexCatalog, safeRolloutPath } from "../src/lib/providers/codex";
import { openSessionOwners } from "../src/lib/codex-live";

const id = "12345678-1234-1234-1234-123456789abc";
const line = (type: string, payload: unknown) => JSON.stringify({ type, payload, timestamp: "2026-10-28T10:00:00Z" });
test("parses local CLI metadata and excludes archived or invalid rows", () => {
  const value = codexRecord({
    id,
    cwd: "/work/api",
    source: "cli",
    name: "Named",
    title: "Old",
    updated_at_ms: 1793181600000,
  });
  assert.equal(value?.title, "Named");
  assert.equal(value?.resumable, true);
  assert.equal(codexRecord({ id, source: "exec" }), null);
  assert.equal(codexRecord({ id, source: '{"subagent":{}}' }), null);
  assert.equal(codexRecord({ id, source: "vscode" })?.resumable, false);
  assert.equal(codexRecord({ id, archived: 1 }), null);
  assert.equal(codexRecord({ id: "--bad" }), null);
});
test("rollout parser tolerates unknown events and an incomplete trailing line", () => {
  const value = parseRolloutHead(
    [
      line("session_meta", { id, cwd: "/work/api", source: "cli" }),
      line("event_msg", { type: "user_message", message: "Fix login" }),
      '{"type":',
    ].join("\n"),
    "/rollout.jsonl",
  );
  assert.equal(value?.id, id);
  assert.equal(value?.title, "Fix login");
});
test("conversation preview avoids duplicated events and drops tools", () => {
  const input = [
    line("event_msg", { type: "agent_message", message: "Hello" }),
    line("response_item", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello" }],
    }),
    line("response_item", { type: "function_call", arguments: "hidden" }),
    "{bad",
  ].join("\n");
  assert.deepEqual(
    parseCodexMessages(input, 10).map((message) => message.text),
    ["Hello"],
  );
});
test("runtime ownership requires exact paths, never matching basenames or cwd", () => {
  const session = codexRecord({
    id,
    source: "cli",
    rollout_path: "/store/sessions/rollout-x.jsonl",
  })!;
  assert.equal(openSessionOwners("p123\nn/other/rollout-x.jsonl\n", [session], "/store").size, 0);
  assert.ok(openSessionOwners("p123\nn/store/sessions/rollout-x.jsonl\n", [session], "/store").get(id)?.has(123));
  assert.ok(openSessionOwners(`p456\nn/store/thread-writer-locks/${id}.lock\n`, [session], "/store").get(id)?.has(456));
});
test("read-only catalog supports optional column differences and excludes archived rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-catalog-"));
  try {
    const database = join(root, "state_99.sqlite");
    execFileSync("/usr/bin/sqlite3", [
      database,
      `CREATE TABLE threads(id TEXT,cwd TEXT,rollout_path TEXT,title TEXT,source TEXT,archived INTEGER,updated_at_ms INTEGER); INSERT INTO threads VALUES('${id}','/work/api','','Example','cli',0,1793181600000); INSERT INTO threads VALUES('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','/work/api','','Archived','cli',1,1793181600001);`,
    ]);
    const before = execFileSync("/usr/bin/shasum", [database], {
      encoding: "utf8",
    });
    const catalog = await readCodexCatalog(80, root);
    assert.equal(catalog.warning, null);
    assert.equal(catalog.sessions.length, 1);
    assert.equal(catalog.sessions[0].id, id);
    assert.equal(execFileSync("/usr/bin/shasum", [database], { encoding: "utf8" }), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("missing catalog falls back to bounded rollout heads and rejects outside-store symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-rollout-"));
  try {
    const day = join(root, "sessions", "2026", "10", "28");
    await mkdir(day, { recursive: true });
    const path = join(day, `rollout-2026-10-28-${id}.jsonl`);
    await writeFile(path, `${line("session_meta", { id, cwd: "/work/api", source: "cli" })}\n`);
    const catalog = await readCodexCatalog(80, root);
    assert.ok(catalog.warning?.includes("limited"));
    assert.equal(catalog.sessions[0].id, id);
    const outside = join(root, `rollout-outside.jsonl`);
    await writeFile(outside, "synthetic");
    const link = join(day, "rollout-symlink.jsonl");
    await symlink(outside, link);
    assert.equal(await safeRolloutPath(link, root), null);
    assert.equal(await safeRolloutPath(join(root, "unrelated.json"), root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
