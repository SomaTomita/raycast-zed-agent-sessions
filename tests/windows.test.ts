import assert from "node:assert/strict";
import test from "node:test";

import type * as WindowsModule from "../src/lib/windows";
import type { ZedSnapshot } from "../src/lib/zed-targets";
import { loadLib } from "./helpers/load-lib";

interface Options {
  /** Output of the Window menu listing; `undefined` makes that script throw. */
  readonly menu?: string;
  /** Output of the accessibility window listing; `undefined` makes that script throw. */
  readonly accessibility?: string;
  /** Result of the "click the menu item" script. */
  readonly click?: string;
  readonly snapshot?: ZedSnapshot;
  readonly zedPid?: number | null;
  /** Makes the Zed pid lookup itself fail, as when osascript is unavailable. */
  readonly zedPidFails?: boolean;
  /** Titles reported by the native AX fallback. */
  readonly nativeTitles?: string[];
  readonly reached?: boolean;
  readonly focused?: string;
  /** The focused title only becomes right after this many inspections, as after a Space switch. */
  readonly focusedAfterCalls?: number;
  readonly activateFails?: boolean;
}

interface Setup {
  readonly windows: typeof WindowsModule;
  readonly clicks: string[];
  readonly activated: number[];
  readonly inspected: (string | undefined)[];
}

function setup(options: Options): Setup {
  const clicks: string[] = [];
  const activated: number[] = [];
  const inspected: (string | undefined)[] = [];
  let inspectCalls = 0;
  const windows = loadLib<typeof WindowsModule>("windows", {
    "@raycast/utils": {
      runAppleScript: async (script: string) => {
        if (script.includes("set theItems")) {
          if (options.menu === undefined) throw new Error("no Window menu");
          return options.menu;
        }
        if (script.includes("repeat with w in windows")) {
          if (options.accessibility === undefined) throw new Error("no accessibility");
          return options.accessibility;
        }
        clicks.push(script);
        return options.click ?? "ok";
      },
    },
    "./activate": {
      activateProcess: async (pid: number) => {
        if (options.activateFails === true) throw new Error("no GUI app");
        activated.push(pid);
      },
    },
    "./zed-workspaces": {
      readZedSnapshot: async () => options.snapshot ?? { kind: "available", workspaces: [] },
    },
    "./native-zed": {
      zedPid: async () => {
        if (options.zedPidFails === true) throw new Error("osascript failed");
        return options.zedPid === undefined ? 680 : options.zedPid;
      },
      inspectZedWindows: async (_pid: number, title?: string) => {
        inspected.push(title);
        inspectCalls += 1;
        const settled = inspectCalls > (options.focusedAfterCalls ?? 0);
        return {
          titles: options.nativeTitles ?? [],
          focused: settled ? (options.focused ?? "") : "previous window",
          reached: options.reached === true,
        };
      },
    },
  });
  return { windows, clicks, activated, inspected };
}

const MENU = ["Minimize", "Zoom", "missing value", "app — main.ts", "web", ""].join("\n");

test("window titles come from the Window menu, after its last separator", async () => {
  const { windows } = setup({ menu: MENU });
  assert.deepEqual(await windows.listWindowTitles("zed"), ["app — main.ts", "web"]);
});

test("an empty Window menu falls back to the accessibility window list", async () => {
  const { windows } = setup({ menu: "", accessibility: "one\ntwo\n" });
  assert.deepEqual(await windows.listWindowTitles("zed"), ["one", "two"]);
});

test("Zed falls back to native AX titles when AppleScript is unavailable", async () => {
  const { windows } = setup({ zedPid: 680, nativeTitles: ["native-a", "native-b"] });
  assert.deepEqual(await windows.listWindowTitles("zed"), ["native-a", "native-b"]);
});

test("an unreadable window list is empty, not an exception", async () => {
  const { windows } = setup({ zedPid: null });
  assert.deepEqual(await windows.listWindowTitles("zed"), []);
});

const APP_SNAPSHOT: ZedSnapshot = { kind: "available", workspaces: [{ windowId: 1, paths: ["/work/app"] }] };

test("a uniquely matched Zed window is focused through native AX, without touching menus", async () => {
  const { windows, clicks, inspected } = setup({ menu: MENU, snapshot: APP_SNAPSHOT, reached: true });
  assert.equal(await windows.focusProjectWindow("Zed", "zed", "/work/app", 680), true);
  assert.deepEqual(inspected, ["app — main.ts"]);
  assert.deepEqual(clicks, []);
});

test("no matching Zed window means false and nothing is focused", async () => {
  const { windows, inspected, clicks } = setup({ menu: "Zoom\nmissing value\nother", snapshot: APP_SNAPSHOT });
  assert.equal(await windows.focusProjectWindow("Zed", "zed", "/work/app", 680), false);
  assert.deepEqual([inspected, clicks], [[], []]);
});

test("an ambiguous Zed project is never focused automatically", async () => {
  const snapshot: ZedSnapshot = {
    kind: "available",
    workspaces: [
      { windowId: 1, paths: ["/a/app"] },
      { windowId: 2, paths: ["/b/app"] },
    ],
  };
  const { windows, inspected } = setup({ menu: "Zoom\nmissing value\napp\napp", snapshot });
  assert.equal(await windows.focusProjectWindow("Zed", "zed", "/a/app", 680), false);
  assert.deepEqual(inspected, []);
});

test("a path with no folder name is refused", async () => {
  const { windows } = setup({ menu: MENU, snapshot: APP_SNAPSHOT });
  assert.equal(await windows.focusProjectWindow("Zed", "zed", "/", 680), false);
});

test("focusWindowTitle refuses a title shown by more than one window", async () => {
  const { windows, inspected } = setup({ menu: "Zoom\nmissing value\ndup\ndup" });
  assert.equal(await windows.focusWindowTitle("zed", "dup", 680), false);
  assert.deepEqual(inspected, []);
});

test("when AX cannot reach the window, the Window menu is clicked after activating the host", async () => {
  const { windows, activated, clicks } = setup({
    menu: MENU,
    reached: false,
    click: "ok",
    focused: "web",
  });
  assert.equal(await windows.focusWindowTitle("zed", "web", 680), true);
  assert.deepEqual(activated, [680]);
  assert.equal(clicks.length, 1);
});

test("a menu click is not success until the focused title is confirmed", async () => {
  const { windows } = setup({ menu: MENU, reached: false, click: "ok", focused: "somewhere else" });
  assert.equal(await windows.focusWindowTitle("zed", "web", 680), false);
});

test("a missing menu item is reported as false", async () => {
  const { windows } = setup({ menu: MENU, reached: false, click: "missing" });
  assert.equal(await windows.focusWindowTitle("zed", "web", 680), false);
});

test("if the host cannot be activated, nothing is clicked", async () => {
  const { windows, clicks } = setup({ menu: MENU, reached: false, activateFails: true });
  assert.equal(await windows.focusWindowTitle("zed", "web", 680), false);
  assert.deepEqual(clicks, []);
});

test("a failing Zed pid lookup is a failed focus, not an exception", async () => {
  const { windows } = setup({ menu: MENU, zedPidFails: true, click: "ok" });
  assert.equal(await windows.focusWindowTitle("zed", "web", 680), false);
});

test("a readable window list is reported as readable, even when it is empty", async () => {
  assert.equal(await setup({ menu: MENU }).windows.windowsReadable("zed"), true);
  assert.equal(await setup({ menu: "", accessibility: "" }).windows.windowsReadable("zed"), true);
});

test("a window list that cannot be read at all is reported as unreadable, not as empty", async () => {
  const { windows } = setup({ zedPid: null });
  assert.equal(await windows.windowsReadable("zed"), false);
  assert.deepEqual(await windows.listWindowTitles("zed"), []);
});

test("focus that only arrives after a Space switch animates is still confirmed", async () => {
  const { windows } = setup({ menu: MENU, reached: false, click: "ok", focused: "web", focusedAfterCalls: 4 });
  assert.equal(await windows.focusWindowTitle("zed", "web", 680), true);
});

test("a window that never takes focus is reported as not reached, after a bounded wait", async () => {
  const started = Date.now();
  const { windows } = setup({ menu: MENU, reached: false, click: "ok", focused: "somewhere else" });
  assert.equal(await windows.focusWindowTitle("zed", "web", 680), false);
  assert.ok(Date.now() - started < 4_000, "the wait is bounded");
});
