import assert from "node:assert/strict";
import test from "node:test";

import type * as ZedWorkspacesModule from "../src/lib/zed-workspaces";
import { loadLib } from "./helpers/load-lib";

interface Call {
  readonly command: string;
  readonly args: readonly string[];
}

function setup(options: { exists?: boolean; output?: string; fails?: boolean }): {
  zed: typeof ZedWorkspacesModule;
  calls: Call[];
} {
  const calls: Call[] = [];
  const zed = loadLib<typeof ZedWorkspacesModule>("zed-workspaces", {
    "node:fs": { existsSync: () => options.exists !== false },
    "./run": {
      run: async (command: string, args: readonly string[]) => {
        calls.push({ command, args });
        if (options.fails === true) throw new Error("database is locked");
        return options.output ?? "[]";
      },
    },
  });
  return { zed, calls };
}

const row = (overrides: Record<string, unknown>) => ({
  paths: '["/work/app"]',
  window_id: 1,
  remote_connection_id: null,
  ...overrides,
});

test("a missing Stable database is reported as unavailable, not as zero windows", async () => {
  const { zed, calls } = setup({ exists: false });
  assert.deepEqual(await zed.readZedSnapshot(), {
    kind: "unavailable",
    reason: "Zed workspace database is unavailable",
  });
  assert.deepEqual(calls, []);
});

test("the database is opened read-only through the system sqlite3 and queried with SELECT", async () => {
  const { zed, calls } = setup({ output: "[]" });
  await zed.readZedSnapshot();
  assert.equal(calls[0].command, "/usr/bin/sqlite3");
  assert.equal(calls[0].args[0], "-readonly");
  const sql = calls[0].args.at(-1) ?? "";
  assert.match(sql, /^\s*SELECT\b/);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|PRAGMA|ATTACH)\b/i);
  assert.ok(
    calls[0].args.some((arg) => arg.includes("db/0-stable/db.sqlite")),
    "only the Stable database is read",
  );
});

test("local workspaces are returned with their window ids and paths", async () => {
  const output = JSON.stringify([
    row({ paths: '["/work/app","/work/lib"]', window_id: 4 }),
    row({ paths: "/work/web", window_id: 5 }),
  ]);
  assert.deepEqual(await setup({ output }).zed.readZedSnapshot(), {
    kind: "available",
    workspaces: [
      { windowId: 4, paths: ["/work/app", "/work/lib"] },
      { windowId: 5, paths: ["/work/web"] },
    ],
  });
});

test("remote workspaces are skipped instead of being matched against local paths", async () => {
  const output = JSON.stringify([row({ remote_connection_id: 7 }), row({ window_id: 2 })]);
  const snapshot = await setup({ output }).zed.readZedSnapshot();
  assert.deepEqual(snapshot, { kind: "available", workspaces: [{ windowId: 2, paths: ["/work/app"] }] });
});

test("an empty result is an empty list of windows", async () => {
  assert.deepEqual(await setup({ output: "" }).zed.readZedSnapshot(), { kind: "available", workspaces: [] });
});

test("an ambiguous path encoding makes the whole snapshot unavailable", async () => {
  const output = JSON.stringify([row({ paths: "/work/a,b" })]);
  const snapshot = await setup({ output }).zed.readZedSnapshot();
  assert.equal(snapshot.kind, "unavailable");
});

test("a row without a numeric window id makes the snapshot unavailable", async () => {
  const output = JSON.stringify([row({ window_id: "3" })]);
  assert.equal((await setup({ output }).zed.readZedSnapshot()).kind, "unavailable");
});

test("a read failure or a changed schema is unavailable, with a reason", async () => {
  const failed = await setup({ fails: true }).zed.readZedSnapshot();
  assert.deepEqual(failed, {
    kind: "unavailable",
    reason: "Could not read Zed workspaces; its schema or access may have changed",
  });
  assert.equal((await setup({ output: "not json" }).zed.readZedSnapshot()).kind, "unavailable");
});

test("readOpenZedProjects flattens every workspace path, and is empty when unavailable", async () => {
  const output = JSON.stringify([
    row({ paths: '["/work/app","/work/lib"]' }),
    row({ paths: '["/work/web"]', window_id: 2 }),
  ]);
  assert.deepEqual(await setup({ output }).zed.readOpenZedProjects(), ["/work/app", "/work/lib", "/work/web"]);
  assert.deepEqual(await setup({ exists: false }).zed.readOpenZedProjects(), []);
});

test("isInsideOpenProject matches the project root and its subdirectories, not prefixes", () => {
  const { zed } = setup({});
  assert.equal(zed.isInsideOpenProject("/work/app", ["/work/app"]), true);
  assert.equal(zed.isInsideOpenProject("/work/app/src/lib", ["/work/app"]), true);
  assert.equal(zed.isInsideOpenProject("/work/app-two", ["/work/app"]), false);
  assert.equal(zed.isInsideOpenProject("/work/app", []), false);
});
