import assert from "node:assert/strict";
import test from "node:test";

import type { AgentStatus } from "../src/lib/agents";
import type * as RegistryModule from "../src/lib/registry";
import { loadLib } from "./helpers/load-lib";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realProcessAge = require("../src/lib/process-age") as typeof import("../src/lib/process-age");

const NOW = 1_800_000_000_000;
const SESSION_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

interface File {
  readonly name: string;
  readonly body: unknown;
}

interface Options {
  readonly files: readonly File[];
  /** pid -> errno code; a pid not listed is alive. */
  readonly dead?: Readonly<Record<number, string>>;
  /** pid -> seconds alive; `undefined` models a failing ps. */
  readonly ages?: Readonly<Record<number, number>>;
  readonly cli?: Readonly<Record<number, AgentStatus>>;
  readonly missingDirectory?: boolean;
}

async function readSessions(options: Options): Promise<RegistryModule.LiveSession[]> {
  const registry = loadLib<typeof RegistryModule>("registry", {
    "node:fs/promises": {
      readdir: async () => {
        if (options.missingDirectory === true) throw Object.assign(new Error("no dir"), { code: "ENOENT" });
        return options.files.map((file) => file.name);
      },
      readFile: async (path: string) => {
        const file = options.files.find((candidate) => path.endsWith(`/${candidate.name}`));
        if (file === undefined) throw Object.assign(new Error("gone"), { code: "ENOENT" });
        return JSON.stringify(file.body);
      },
    },
    "./paths": { REGISTRY_DIR: "/registry" },
    "./agents": { agentStatusOf: (pid: number) => options.cli?.[pid] ?? null },
    "./host": {
      readProcessTable: async () => new Map([[1, { ppid: 0, tty: "??", command: "/sbin/launchd" }]]),
      detectHost: () => ({ kind: "editor", appName: "Zed", hostPid: 680, tty: "/dev/ttys000" }),
    },
    "./process-age": {
      ...realProcessAge,
      readProcessAges: async () => new Map(Object.entries(options.ages ?? {}).map(([pid, age]) => [Number(pid), age])),
    },
  });

  const realKill = process.kill;
  const realNow = Date.now;
  process.kill = ((pid: number) => {
    const code = options.dead?.[pid];
    if (code !== undefined) throw Object.assign(new Error(code), { code });
    return true;
  }) as typeof process.kill;
  Date.now = () => NOW;
  try {
    return await registry.readLiveSessions();
  } finally {
    process.kill = realKill;
    Date.now = realNow;
  }
}

function file(pid: number, body: Record<string, unknown>): File {
  return { name: `${pid}.json`, body: { pid, sessionId: SESSION_A, cwd: "/work/app", status: "idle", ...body } };
}

const aliveFor = (seconds: number, driftMs = 0) => ({ startedAt: NOW - seconds * 1000 + driftMs });

test("a live session is returned with its host", async () => {
  const [session] = await readSessions({ files: [file(100, aliveFor(600))], ages: { 100: 600 } });
  assert.equal(session.pid, 100);
  assert.equal(session.sessionId, SESSION_A);
  assert.equal(session.hostApp, "Zed");
  assert.equal(session.hostPid, 680);
});

test("a missing registry directory means no sessions", async () => {
  assert.deepEqual(await readSessions({ files: [], missingDirectory: true }), []);
});

test("files that are not <pid>.json are ignored", async () => {
  const sessions = await readSessions({
    files: [file(100, aliveFor(60)), { name: "notes.txt", body: {} }, { name: "100.abc123.key", body: {} }],
    ages: { 100: 60 },
  });
  assert.deepEqual(
    sessions.map((s) => s.pid),
    [100],
  );
});

test("a file whose process is gone is dropped", async () => {
  const sessions = await readSessions({ files: [file(100, aliveFor(60))], dead: { 100: "ESRCH" } });
  assert.deepEqual(sessions, []);
});

test("a process we may not signal still counts as alive", async () => {
  const sessions = await readSessions({ files: [file(100, aliveFor(60))], dead: { 100: "EPERM" }, ages: { 100: 60 } });
  assert.equal(sessions.length, 1);
});

test("a stale file whose pid now belongs to an unrelated process is not shown as a live session", async () => {
  // Written three hours ago; the pid's current owner started two minutes ago.
  const stale = file(100, { startedAt: NOW - 3 * 3_600_000 });
  assert.deepEqual(await readSessions({ files: [stale], ages: { 100: 120 } }), []);
});

test("a reused pid is dropped while a genuine session in the same registry is kept", async () => {
  const sessions = await readSessions({
    files: [file(100, { startedAt: NOW - 3 * 3_600_000 }), file(200, { ...aliveFor(900), sessionId: SESSION_B })],
    ages: { 100: 120, 200: 900 },
  });
  assert.deepEqual(
    sessions.map((s) => s.pid),
    [200],
  );
});

test("when ps fails every session is kept, because hiding a real one is worse", async () => {
  const sessions = await readSessions({ files: [file(100, { startedAt: NOW - 3 * 3_600_000 })], ages: {} });
  assert.equal(sessions.length, 1);
});

test("a session file without startedAt cannot be checked and is kept", async () => {
  const sessions = await readSessions({ files: [file(100, {})], ages: { 100: 5 } });
  assert.equal(sessions.length, 1);
});

test("a file whose pid field disagrees with its filename is ignored", async () => {
  const sessions = await readSessions({
    files: [{ name: "100.json", body: { pid: 999, sessionId: SESSION_A, cwd: "/work/app" } }],
  });
  assert.deepEqual(sessions, []);
});

const cli = (overrides: Partial<AgentStatus>): AgentStatus => ({
  status: "waiting",
  waitingFor: "permission prompt",
  sessionId: SESSION_A,
  readAt: NOW,
  ...overrides,
});

test("the CLI's waiting state is shown when it is at least as new as the registry", async () => {
  const [session] = await readSessions({
    files: [file(100, { ...aliveFor(600), statusUpdatedAt: NOW - 10_000 })],
    ages: { 100: 600 },
    cli: { 100: cli({ readAt: NOW - 5_000 }) },
  });
  assert.equal(session.status, "waiting");
  assert.equal(session.waitingFor, "permission prompt");
});

test("a status the registry wrote after the CLI was read wins over the cached CLI answer", async () => {
  const [session] = await readSessions({
    files: [file(100, { ...aliveFor(600), status: "idle", statusUpdatedAt: NOW - 1_000 })],
    ages: { 100: 600 },
    cli: { 100: cli({ status: "busy", waitingFor: "", readAt: NOW - 40_000 }) },
  });
  assert.equal(session.status, "idle");
  assert.equal(session.waitingFor, "");
});

test("a CLI answer for a different session on a reused pid is ignored", async () => {
  const [session] = await readSessions({
    files: [file(100, { ...aliveFor(600), statusUpdatedAt: NOW - 10_000 })],
    ages: { 100: 600 },
    cli: { 100: cli({ sessionId: SESSION_B }) },
  });
  assert.equal(session.status, "idle");
  assert.equal(session.waitingFor, "");
});

test("without a CLI answer the registry status is used", async () => {
  const [session] = await readSessions({
    files: [file(100, { ...aliveFor(600), status: "busy" })],
    ages: { 100: 600 },
  });
  assert.equal(session.status, "busy");
});

test("sessions are sorted by their latest status change, newest first", async () => {
  const sessions = await readSessions({
    files: [
      file(100, { ...aliveFor(600), statusUpdatedAt: NOW - 50_000 }),
      file(200, { ...aliveFor(600), sessionId: SESSION_B, statusUpdatedAt: NOW - 5_000 }),
    ],
    ages: { 100: 600, 200: 600 },
  });
  assert.deepEqual(
    sessions.map((s) => s.pid),
    [200, 100],
  );
});
