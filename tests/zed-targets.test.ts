import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkspacePaths, resolveZedTarget, ZedSnapshot } from "../src/lib/zed-targets";

const snapshot = (...paths: string[]): ZedSnapshot => ({
  kind: "available",
  workspaces: paths.map((path, index) => ({
    windowId: index + 1,
    paths: [path],
  })),
});
test("requires path corroboration, and accepts a subdirectory of a unique root", () => {
  assert.deepEqual(resolveZedTarget("/work/api/src", ["api — main.ts"], snapshot("/work/api")), {
    kind: "matched",
    title: "api — main.ts",
  });
  assert.equal(resolveZedTarget("/work/api", ["api — main.ts"], snapshot("/oss/api")).kind, "unknown");
});
test("same-name clones and same-project duplicate windows are ambiguous", () => {
  assert.equal(resolveZedTarget("/work/api", ["api — a.ts"], snapshot("/work/api", "/oss/api")).kind, "ambiguous");
  assert.equal(resolveZedTarget("/work/api", ["api — a.ts", "api — b.ts"], snapshot("/work/api")).kind, "ambiguous");
  assert.equal(resolveZedTarget("/work/api", ["api — a.ts"], snapshot("/work/api", "/work/api")).kind, "ambiguous");
});
test("unreadable DB and hidden workspaces are unknown, not closed", () => {
  assert.equal(resolveZedTarget("/work/api", [], { kind: "unavailable", reason: "denied" }).kind, "unknown");
  assert.equal(resolveZedTarget("/work/api", ["web — a.ts"], snapshot("/work/api")).kind, "unknown");
  assert.equal(resolveZedTarget("/work/api", [], snapshot()).kind, "missing");
});
test("does not confuse path prefixes or lowercase case-sensitive roots", () => {
  assert.equal(resolveZedTarget("/work/api-other", [], snapshot("/work/api")).kind, "missing");
  assert.equal(resolveZedTarget("/work/API", ["API — a"], snapshot("/work/api")).kind, "unknown");
});
test("preserves JSON path arrays and refuses ambiguous legacy separators", () => {
  assert.deepEqual(parseWorkspacePaths('["/work/a,b","/work/web"]'), ["/work/a,b", "/work/web"]);
  assert.deepEqual(parseWorkspacePaths("/work/api"), ["/work/api"]);
  assert.equal(parseWorkspacePaths("/work/a,/work/b"), null);
  assert.equal(parseWorkspacePaths("relative"), null);
  assert.equal(parseWorkspacePaths('["/work/api",2]'), null);
});
