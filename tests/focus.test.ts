import assert from "node:assert/strict";
import test from "node:test";

import type * as FocusModule from "../src/lib/focus";
import type { ZedSnapshot } from "../src/lib/zed-targets";
import { appleQuote } from "../src/lib/quote";
import { loadLib } from "./helpers/load-lib";

interface Setup {
  readonly focus: typeof FocusModule;
  readonly scripts: string[];
  readonly newWindows: string[][];
  readonly focusCalls: unknown[][];
}

function setup(options: {
  script?: string;
  snapshot?: ZedSnapshot;
  titles?: string[];
  focusResult?: boolean;
  /** Whether the window list could be read at all; false models missing Accessibility permission. */
  readable?: boolean;
}): Setup {
  const scripts: string[] = [];
  const newWindows: string[][] = [];
  const focusCalls: unknown[][] = [];
  const focus = loadLib<typeof FocusModule>("focus", {
    "@raycast/utils": {
      runAppleScript: async (script: string) => {
        scripts.push(script);
        return options.script ?? "ok";
      },
    },
    "./editor": {
      editorProcessName: (app: string) => (app === "Zed" ? "zed" : app),
      openProjectInNewWindow: async (app: string, cwd: string) => {
        newWindows.push([app, cwd]);
      },
    },
    "./windows": {
      listWindowTitles: async () => options.titles ?? [],
      windowsReadable: async () => options.readable !== false,
      focusProjectWindow: async (...args: unknown[]) => {
        focusCalls.push(args);
        return options.focusResult === true;
      },
    },
    "./zed-workspaces": {
      readZedSnapshot: async () => options.snapshot ?? { kind: "available", workspaces: [] },
    },
  });
  return { focus, scripts, newWindows, focusCalls };
}

test("iTerm2: the tab on the tty is selected, and a miss is reported as false", async () => {
  const hit = setup({ script: "ok" });
  assert.equal(await hit.focus.focusItermTab("/dev/ttys001"), true);
  const miss = setup({ script: "missing" });
  assert.equal(await miss.focus.focusItermTab("/dev/ttys001"), false);
});

test("Terminal.app: the tab on the tty is selected, and a miss is reported as false", async () => {
  assert.equal(await setup({ script: "ok" }).focus.focusTerminalTab("/dev/ttys001"), true);
  assert.equal(await setup({ script: "missing" }).focus.focusTerminalTab("/dev/ttys001"), false);
});

test("a hostile tty string cannot break out of the AppleScript literal", async () => {
  const hostile = '/dev/x" & (do shell script "touch /tmp/pwned") & "';
  for (const run of [
    (focus: typeof FocusModule) => focus.focusItermTab(hostile),
    (focus: typeof FocusModule) => focus.focusTerminalTab(hostile),
  ]) {
    const { focus, scripts } = setup({});
    await run(focus);
    assert.ok(scripts[0].includes(appleQuote(hostile)));
    assert.ok(!scripts[0].includes('is "/dev/x" &'), "the quote must stay escaped");
  }
});

const TWO_APPS: ZedSnapshot = {
  kind: "available",
  workspaces: [
    { windowId: 1, paths: ["/a/app"] },
    { windowId: 2, paths: ["/b/app"] },
  ],
};

test("revealProject refuses an ambiguous Zed target and opens nothing", async () => {
  const { focus, newWindows, focusCalls } = setup({ snapshot: TWO_APPS, titles: ["app", "app"] });
  await assert.rejects(
    focus.revealProject("Zed", "/a/app"),
    /Several Zed projects or windows match.*Choose Zed Window/,
  );
  assert.deepEqual([newWindows, focusCalls], [[], []]);
});

test("revealProject refuses an unknown Zed target and opens nothing", async () => {
  const { focus, newWindows } = setup({
    snapshot: { kind: "unavailable", reason: "Zed workspace database is unavailable" },
  });
  await assert.rejects(focus.revealProject("Zed", "/a/app"), /database is unavailable/);
  assert.deepEqual(newWindows, []);
});

test("revealProject reuses an existing window and does not open another", async () => {
  const { focus, newWindows, focusCalls } = setup({
    snapshot: { kind: "available", workspaces: [{ windowId: 1, paths: ["/a/app"] }] },
    titles: ["app — main.ts"],
    focusResult: true,
  });
  assert.equal(await focus.revealProject("Zed", "/a/app", 680), true);
  assert.deepEqual(focusCalls, [["Zed", "zed", "/a/app", 680]]);
  assert.deepEqual(newWindows, []);
});

test("revealProject opens exactly one new window when the project is not open", async () => {
  const { focus, newWindows } = setup({
    snapshot: { kind: "available", workspaces: [] },
    titles: ["other"],
    focusResult: false,
  });
  assert.equal(await focus.revealProject("Zed", "/a/app", 680), false);
  assert.deepEqual(newWindows, [["Zed", "/a/app"]]);
});

test("raiseProjectWindow never opens a window", async () => {
  const { focus, newWindows, focusCalls } = setup({ focusResult: false });
  assert.equal(await focus.raiseProjectWindow("Zed", "/a/app", 680), false);
  assert.deepEqual(focusCalls, [["Zed", "zed", "/a/app", 680]]);
  assert.deepEqual(newWindows, []);
});

test("a window that exists but cannot be reached is reported, never answered with a second window", async () => {
  const { focus, newWindows } = setup({
    snapshot: { kind: "available", workspaces: [{ windowId: 1, paths: ["/a/app"] }] },
    titles: ["app — main.ts"],
    focusResult: false,
  });
  await assert.rejects(focus.revealProject("Zed", "/a/app", 680), /already open in Zed.*Nothing was opened/);
  assert.deepEqual(newWindows, []);
});

test("an unknown target with an unreadable window list points at Accessibility permission", async () => {
  const { focus, newWindows } = setup({
    snapshot: { kind: "available", workspaces: [{ windowId: 1, paths: ["/a/app"] }] },
    titles: [],
    readable: false,
  });
  await assert.rejects(focus.revealProject("Zed", "/a/app", 680), /Accessibility permission/);
  assert.deepEqual(newWindows, []);
});

test("an unknown target with a readable window list keeps the resolver's own reason", async () => {
  const { focus } = setup({ snapshot: { kind: "unavailable", reason: "schema changed" }, readable: true });
  await assert.rejects(focus.revealProject("Zed", "/a/app", 680), /schema changed/);
});

test("canListWindows asks about the editor's process", async () => {
  assert.equal(await setup({ readable: true }).focus.canListWindows("Zed"), true);
  assert.equal(await setup({ readable: false }).focus.canListWindows("Zed"), false);
});
