import assert from "node:assert/strict";
import test, { mock } from "node:test";

import type * as GotoModule from "../src/lib/goto";
import type { LiveSession } from "../src/lib/registry";
import type { SessionItem } from "../src/lib/sessions";
import { loadLib } from "./helpers/load-lib";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realZedWorkspaces = require("../src/lib/zed-workspaces") as typeof import("../src/lib/zed-workspaces");

function liveSession(overrides: Partial<LiveSession>): LiveSession {
  return {
    pid: 100,
    sessionId: "11111111-2222-4333-8444-555555555555",
    cwd: "/work/app",
    name: "my session",
    status: "idle",
    kind: "claude",
    entrypoint: "",
    version: "",
    startedAt: null,
    statusUpdatedAt: null,
    hostKind: "unknown",
    hostApp: "",
    hostPid: 0,
    tty: "",
    waitingFor: "",
    ...overrides,
  };
}

function item(live: LiveSession | null): SessionItem {
  return { live, cwd: "/work/app" } as unknown as SessionItem;
}

interface Setup {
  readonly goto: typeof GotoModule;
  readonly activated: number[];
  readonly itermTabs: string[];
  readonly terminalTabs: string[];
  readonly raised: unknown[][];
  readonly zedLookups: { count: number };
}

function setup(options: {
  iterm?: boolean;
  terminal?: boolean;
  raised?: boolean;
  openProjects?: string[];
  activateFails?: boolean;
  /** Whether the editor's window list can be read; false models missing Accessibility permission. */
  readable?: boolean;
}): Setup {
  const activated: number[] = [];
  const itermTabs: string[] = [];
  const terminalTabs: string[] = [];
  const raised: unknown[][] = [];
  const zedLookups = { count: 0 };
  const goto = loadLib<typeof GotoModule>("goto", {
    "./activate": {
      activateProcess: mock.fn(async (pid: number) => {
        if (options.activateFails === true) throw new Error("no GUI app");
        activated.push(pid);
      }),
    },
    "./focus": {
      focusItermTab: async (tty: string) => {
        itermTabs.push(tty);
        return options.iterm === true;
      },
      focusTerminalTab: async (tty: string) => {
        terminalTabs.push(tty);
        return options.terminal === true;
      },
      raiseProjectWindow: async (...args: unknown[]) => {
        raised.push(args);
        return options.raised === true;
      },
      canListWindows: async () => options.readable !== false,
    },
    "./zed-workspaces": {
      ...realZedWorkspaces,
      readOpenZedProjects: async () => {
        zedLookups.count += 1;
        return options.openProjects ?? [];
      },
    },
  });
  return { goto, activated, itermTabs, terminalTabs, raised, zedLookups };
}

test("a history row has nothing to go to", async () => {
  const { goto } = setup({});
  assert.deepEqual(await goto.goToSession(item(null)), { kind: "needs-resume" });
});

test("an unreachable live row is treated like a history row", async () => {
  const { goto, itermTabs, activated } = setup({ iterm: true });
  const row = item(liveSession({ hostKind: "iterm", hostApp: "iTerm", hostPid: 9, tty: "/dev/ttys001" }));
  assert.deepEqual(await goto.goToSession(row, { unreachable: true }), { kind: "needs-resume" });
  assert.deepEqual([itermTabs, activated], [[], []]);
});

test("an iTerm2 session selects the tab on its tty", async () => {
  const { goto, itermTabs, activated } = setup({ iterm: true });
  const row = item(liveSession({ hostKind: "iterm", hostApp: "iTerm", hostPid: 9, tty: "/dev/ttys001" }));
  const result = await goto.goToSession(row);
  assert.equal(result.kind, "reached");
  assert.deepEqual(itermTabs, ["/dev/ttys001"]);
  assert.deepEqual(activated, []);
});

test("a Terminal.app session uses the Terminal tab lookup, not iTerm's", async () => {
  const { goto, itermTabs, terminalTabs } = setup({ terminal: true });
  const row = item(liveSession({ hostKind: "terminal", hostApp: "Terminal", hostPid: 9, tty: "/dev/ttys004" }));
  assert.equal((await goto.goToSession(row)).kind, "reached");
  assert.deepEqual([itermTabs, terminalTabs], [[], ["/dev/ttys004"]]);
});

test("a missing tab falls back to activating the host, never launching it", async () => {
  const { goto, activated } = setup({ iterm: false });
  const row = item(liveSession({ hostKind: "iterm", hostApp: "iTerm", hostPid: 9, tty: "/dev/ttys001" }));
  const result = await goto.goToSession(row);
  assert.equal(result.kind, "activated");
  assert.deepEqual(activated, [9]);
  assert.match(result.kind === "activated" ? result.message : "", /No tab on \/dev\/ttys001/);
});

test("a terminal host without a tty is activated rather than searched", async () => {
  const { goto, itermTabs, activated } = setup({ iterm: true });
  const row = item(liveSession({ hostKind: "iterm", hostApp: "iTerm", hostPid: 9, tty: "" }));
  assert.equal((await goto.goToSession(row)).kind, "activated");
  assert.deepEqual([itermTabs, activated], [[], [9]]);
});

test("a Zed session raises the window for its directory", async () => {
  const { goto, raised, activated } = setup({ raised: true });
  const row = item(liveSession({ hostKind: "editor", hostApp: "Zed", hostPid: 680, tty: "/dev/ttys000" }));
  const result = await goto.goToSession(row);
  assert.equal(result.kind, "reached");
  assert.deepEqual(raised, [["Zed", "/work/app", 680]]);
  assert.deepEqual(activated, []);
});

test("when no Zed window matches, the host is only activated and the reason is reported", async () => {
  const { goto, activated } = setup({ raised: false, openProjects: [] });
  const row = item(liveSession({ hostKind: "editor", hostApp: "Zed", hostPid: 680 }));
  const result = await goto.goToSession(row);
  assert.equal(result.kind, "activated");
  assert.deepEqual(activated, [680]);
  assert.match(result.kind === "activated" ? result.message : "", /No window shows this directory; nothing was opened/);
});

test("a project open as a workspace inside another Zed window is explained", async () => {
  const { goto } = setup({ raised: false, openProjects: ["/work"] });
  const row = item(liveSession({ hostKind: "editor", hostApp: "Zed", hostPid: 680 }));
  const result = await goto.goToSession(row);
  assert.match(result.kind === "activated" ? result.message : "", /workspace inside another window/);
});

test("an unrecognised GUI host is activated by name", async () => {
  const { goto, activated } = setup({});
  const row = item(liveSession({ hostKind: "app", hostApp: "WezTerm", hostPid: 77, name: "chat" }));
  const result = await goto.goToSession(row);
  assert.equal(result.kind, "activated");
  assert.equal(result.kind === "activated" ? result.title : "", "Activated WezTerm");
  assert.deepEqual(activated, [77]);
});

test("a host with no application name is still activated", async () => {
  const { goto } = setup({});
  const row = item(liveSession({ hostKind: "app", hostApp: "", hostPid: 77 }));
  const result = await goto.goToSession(row);
  assert.equal(result.kind === "activated" ? result.title : "", "Activated the host application");
});

test("a session with no GUI host (tmux, ssh) needs a resume instead of a jump", async () => {
  const { goto, activated, itermTabs, raised } = setup({ iterm: true, raised: true });
  const row = item(liveSession({ hostKind: "unknown", hostApp: "", hostPid: 0, tty: "/dev/ttys009" }));
  assert.deepEqual(await goto.goToSession(row), { kind: "needs-resume" });
  assert.deepEqual([activated, itermTabs, raised], [[], [], []]);
});

test("activation failure is reported and nothing is resumed", async () => {
  const { goto } = setup({ activateFails: true });
  const row = item(liveSession({ hostKind: "app", hostApp: "WezTerm", hostPid: 77 }));
  await assert.rejects(goto.goToSession(row), /WezTerm is no longer available; no session was resumed/);
});

test("an unreadable window list is reported as a permission problem, not as a missing window", async () => {
  const { goto, activated, zedLookups } = setup({ raised: false, readable: false });
  const row = item(liveSession({ hostKind: "editor", hostApp: "Zed", hostPid: 680 }));
  const result = await goto.goToSession(row);
  assert.equal(result.kind, "activated");
  assert.match(result.kind === "activated" ? result.message : "", /Accessibility permission/);
  assert.doesNotMatch(result.kind === "activated" ? result.message : "", /No window shows/);
  assert.deepEqual(activated, [680]);
  assert.equal(zedLookups.count, 0);
});
