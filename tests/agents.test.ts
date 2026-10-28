import assert from "node:assert/strict";
import test from "node:test";

import type * as AgentsModule from "../src/lib/agents";
import { loadLib } from "./helpers/load-lib";

const SESSION = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

const interactive = {
  kind: "interactive",
  sessionId: SESSION,
  cwd: "/work/app",
  pid: 100,
  status: "waiting",
  waitingFor: "permission prompt",
};
const background = {
  kind: "background",
  sessionId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  cwd: "/work/web",
  id: "job-1",
  state: "done",
};

function setup(outputs: string[]): { agents: typeof AgentsModule; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const queue = [...outputs];
  const agents = loadLib<typeof AgentsModule>("agents", {
    "./claude-cli": {
      execClaude: async (args: readonly string[]) => {
        calls.push(args);
        const next = queue.length > 1 ? queue.shift() : queue[0];
        return next ?? "[]";
      },
    },
  });
  return { agents, calls };
}

test("interactive sessions and background jobs are both parsed", async () => {
  const { agents } = setup([JSON.stringify([interactive, background])]);
  const list = await agents.readAgents();
  assert.deepEqual(
    list.map((agent) => agent.kind),
    ["interactive", "background"],
  );
});

test("one malformed row does not discard the rest", async () => {
  const bad = [
    { kind: "interactive", sessionId: SESSION },
    { kind: "mystery" },
    "text",
    null,
    { ...background, id: "" },
  ];
  const { agents } = setup([JSON.stringify([...bad, interactive])]);
  const list = await agents.readAgents();
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, "interactive");
});

test("output that is not a JSON array is an error, not an empty list", async () => {
  await assert.rejects(setup(["not json"]).agents.readAgents(), /did not return JSON/);
  await assert.rejects(setup(['{"a":1}']).agents.readAgents(), /did not return an array/);
});

test("the CLI answer for a pid carries its session id and the time it was read", async () => {
  const { agents } = setup([JSON.stringify([interactive])]);
  const before = Date.now();
  await agents.readAgents();
  const status = agents.agentStatusOf(100);
  assert.equal(status?.status, "waiting");
  assert.equal(status?.waitingFor, "permission prompt");
  assert.equal(status?.sessionId, SESSION);
  assert.ok((status?.readAt ?? 0) >= before && (status?.readAt ?? 0) <= Date.now());
  assert.equal(agents.agentStatusOf(999), null);
});

test("background jobs have no pid status", async () => {
  const { agents } = setup([JSON.stringify([background])]);
  await agents.readAgents();
  assert.equal(agents.agentStatusOf(100), null);
});

test("a second read within the cache window does not call the CLI again", async () => {
  const { agents, calls } = setup([JSON.stringify([interactive])]);
  await agents.readAgents();
  await agents.readAgents();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["agents", "--all", "--json"]);
});

test("an explicit refresh invalidates the cache", async () => {
  const { agents, calls } = setup([JSON.stringify([interactive]), JSON.stringify([])]);
  await agents.readAgents();
  agents.invalidateAgents();
  const second = await agents.readAgents();
  assert.equal(calls.length, 2);
  assert.deepEqual(second, []);
  assert.equal(agents.agentStatusOf(100), null, "the pid cache follows the new answer");
});
