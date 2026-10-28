import assert from "node:assert/strict";
import test from "node:test";

import type { CodexRecord } from "../src/lib/codex-records";
import type * as CodexLiveModule from "../src/lib/codex-live";
import { loadLib } from "./helpers/load-lib";

const ID = "12345678-1234-1234-1234-123456789abc";
const OTHER = "99999999-9999-4999-8999-999999999999";
const ROLLOUT = `/store/sessions/2026/10/28/rollout-${ID}.jsonl`;

const session = (id: string, path: string): CodexRecord =>
  ({
    id,
    cwd: "/work/app",
    path,
    title: "chat",
    firstPrompt: "",
    updatedAt: 1,
    branch: "",
    model: "",
    source: "cli",
    resumable: true,
  }) as CodexRecord;

interface Options {
  readonly processes?: readonly { pid: number; command: string }[];
  readonly lsof?: string | Error;
  readonly emptyTable?: boolean;
}

async function runtime(options: Options, sessions: readonly CodexRecord[]) {
  const table = new Map(
    options.emptyTable === true
      ? []
      : (options.processes ?? []).map(({ pid, command }) => [pid, { ppid: 1, tty: "ttys001", command }] as const),
  );
  const lsofCalls: (readonly string[])[] = [];
  const codexLive = loadLib<typeof CodexLiveModule>("codex-live", {
    "./host": {
      readProcessTable: async () => table,
      detectHost: () => ({ kind: "editor", appName: "Zed", hostPid: 680, tty: "/dev/ttys001" }),
    },
    "./run": {
      run: async (_command: string, args: readonly string[]) => {
        lsofCalls.push(args);
        if (options.lsof instanceof Error) throw options.lsof;
        return options.lsof ?? "";
      },
    },
    "./providers/codex": {
      CODEX_HOME: "/store",
      sessionIdFromOpenPath: () => null,
      safeRolloutPath: async (path: string) => path,
    },
    "./codex-activity": { readCodexActivity: async () => ({ status: "busy", at: 123 }) },
  });
  return { result: await codexLive.readCodexRuntime(sessions), lsofCalls };
}

test("with no Codex process at all, every session is confirmed not running", async () => {
  const { result, lsofCalls } = await runtime({ processes: [{ pid: 7, command: "/bin/zsh" }] }, [session(ID, ROLLOUT)]);
  assert.equal(result.live.size, 0);
  assert.equal(result.uncertain, false);
  assert.deepEqual(lsofCalls, [], "nothing to inspect, so lsof is not run");
});

test("a Codex process holding a session's rollout file makes that session live, with its host", async () => {
  const { result } = await runtime(
    { processes: [{ pid: 50, command: "/Users/me/.local/bin/codex" }], lsof: `p50\nn${ROLLOUT}\n` },
    [session(ID, ROLLOUT)],
  );
  const instances = result.live.get(ID);
  assert.equal(instances?.length, 1);
  assert.equal(instances?.[0].pid, 50);
  assert.equal(instances?.[0].kind, "codex");
  assert.equal(instances?.[0].status, "busy");
  assert.equal(instances?.[0].hostApp, "Zed");
  assert.equal(instances?.[0].hostPid, 680);
});

test("while any Codex process runs, a session it does not visibly hold is unknown, not stopped", async () => {
  // This is the conservative rule: a process can own a thread without a visible file handle.
  const { result } = await runtime(
    { processes: [{ pid: 50, command: "/Users/me/.local/bin/codex" }], lsof: `p50\nn${ROLLOUT}\n` },
    [session(ID, ROLLOUT), session(OTHER, `/store/sessions/2026/10/28/rollout-${OTHER}.jsonl`)],
  );
  assert.ok(result.live.has(ID));
  assert.ok(!result.live.has(OTHER));
  assert.equal(result.uncertain, true, "so automatic resume of OTHER is refused");
});

test("a descriptor on a different file does not make the session live", async () => {
  const { result } = await runtime(
    { processes: [{ pid: 50, command: "/Users/me/.local/bin/codex" }], lsof: "p50\nn/tmp/unrelated.log\n" },
    [session(ID, ROLLOUT)],
  );
  assert.equal(result.live.size, 0);
  assert.equal(result.uncertain, true);
});

test("if lsof fails, nothing is claimed live and the answer is uncertain", async () => {
  const { result } = await runtime(
    { processes: [{ pid: 50, command: "/Users/me/.local/bin/codex" }], lsof: new Error("lsof failed") },
    [session(ID, ROLLOUT)],
  );
  assert.equal(result.live.size, 0);
  assert.equal(result.uncertain, true);
});

test("an unreadable process table is uncertain, never 'nothing running'", async () => {
  const { result } = await runtime({ emptyTable: true }, [session(ID, ROLLOUT)]);
  assert.equal(result.live.size, 0);
  assert.equal(result.uncertain, true);
});

test("only processes named codex are inspected", async () => {
  const { lsofCalls } = await runtime(
    {
      processes: [
        { pid: 50, command: "/Users/me/.local/bin/codex" },
        { pid: 51, command: "/usr/bin/vim" },
        { pid: 52, command: "/opt/bin/codex-code-mode-host" },
      ],
      lsof: "",
    },
    [session(ID, ROLLOUT)],
  );
  assert.deepEqual(lsofCalls[0].slice(0, 3), ["-a", "-p", "50,52"]);
});
