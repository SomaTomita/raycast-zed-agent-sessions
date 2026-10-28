import assert from "node:assert/strict";
import test from "node:test";

import type * as ActionsModule from "../src/components/session-actions";
import type { GoToResult } from "../src/lib/goto";
import type { SessionItem } from "../src/lib/sessions";
import { loadModule } from "./helpers/load-lib";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realSessionTypes = require("../src/lib/session-types") as typeof import("../src/lib/session-types");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realQuote = require("../src/lib/quote") as typeof import("../src/lib/quote");

interface ToastCall {
  readonly style: string;
  readonly title: string;
  readonly message?: string;
}

interface Harness {
  readonly clipboard: string[];
  readonly toasts: ToastCall[];
  readonly failures: { readonly error: unknown; readonly title: string }[];
  readonly revealed: unknown[][];
  readonly newWindows: unknown[][];
  readonly resumed: unknown[][];
  readonly prefillCalls: unknown[];
  readonly press: (title: string) => Promise<void>;
  readonly titles: () => string[];
}

interface Options {
  /** Result of revealProject: true reused a window, false opened one, an Error is thrown. */
  readonly reveal?: boolean | Error;
  readonly resumeFails?: boolean;
  readonly goTo?: GoToResult;
  /** Session ids the Claude registry reports as running. */
  readonly runningClaude?: readonly string[];
  readonly codexRuntime?: { readonly live: Map<string, unknown>; readonly uncertain: boolean };
  /** The experimental setting, and what the terminal step answers (or throws). */
  readonly zedTerminalPrefill?: boolean;
  readonly prefill?: { kind: "typed" } | { kind: "skipped"; reason: string } | Error;
  readonly editor?: string;
  /** Held by window actions until released, to model a slow Zed. */
  readonly gate?: Promise<void>;
}

type Element = { readonly type: unknown; readonly props: Record<string, unknown> };

/** Raycast components are plain functions here, so the tree is walked without a renderer. */
function collect(node: unknown, type: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, type, found);
  } else if (node !== null && typeof node === "object" && "props" in node) {
    const element = node as Element;
    if (element.type === type) found.push(element.props);
    collect(element.props.children, type, found);
  }
  return found;
}

function item(overrides: Record<string, unknown>): SessionItem {
  return {
    provider: "claude",
    sessionId: "11111111-2222-4333-8444-555555555555",
    cwd: "/work/app",
    resumable: true,
    live: null,
    agent: null,
    transcript: null,
    state: "history",
    ...overrides,
  } as unknown as SessionItem;
}

function setup(row: SessionItem, options: Options = {}): Harness {
  const clipboard: string[] = [];
  const toasts: ToastCall[] = [];
  const failures: { error: unknown; title: string }[] = [];
  const revealed: unknown[][] = [];
  const newWindows: unknown[][] = [];
  const resumed: unknown[][] = [];
  const prefillCalls: unknown[] = [];

  function Action() {
    return null;
  }
  Action.Push = function Push() {
    return null;
  };
  Action.CopyToClipboard = function CopyToClipboard() {
    return null;
  };
  Action.ShowInFinder = function ShowInFinder() {
    return null;
  };
  function ActionPanel() {
    return null;
  }
  ActionPanel.Section = function Section() {
    return null;
  };
  const shortcut = (key: string) => ({ modifiers: ["cmd"], key });

  const module = loadModule<typeof ActionsModule>("components/session-actions", {
    "@raycast/api": {
      Action,
      ActionPanel,
      Icon: new Proxy({}, { get: (_target, name) => String(name) }),
      Toast: { Style: { Success: "success", Failure: "failure" } },
      Keyboard: {
        Shortcut: {
          Common: {
            Edit: shortcut("e"),
            Copy: shortcut("c"),
            Pin: shortcut("."),
            Refresh: shortcut("r"),
          },
        },
      },
      Clipboard: {
        copy: async (text: string) => {
          clipboard.push(text);
        },
      },
      showToast: async (toast: ToastCall) => {
        toasts.push(toast);
      },
    },
    "@raycast/utils": {
      showFailureToast: async (error: unknown, options: { title: string }) => {
        failures.push({ error, title: options.title });
      },
    },
    "../lib/editor": {
      editorLabel: (app: string) => app,
      openProjectInNewWindow: async (...args: unknown[]) => {
        newWindows.push(args);
        await options.gate;
      },
    },
    "../lib/focus": {
      revealProject: async (...args: unknown[]) => {
        revealed.push(args);
        await options.gate;
        if (options.reveal instanceof Error) throw options.reveal;
        return options.reveal ?? true;
      },
    },
    "../lib/goto": {
      goToSession: async () => options.goTo ?? { kind: "needs-resume" },
    },
    "../lib/registry": {
      readLiveSessions: async () => (options.runningClaude ?? []).map((sessionId) => ({ sessionId })),
    },
    "../lib/codex-live": {
      readCodexRuntime: async () => options.codexRuntime ?? { live: new Map(), uncertain: false },
    },
    "../lib/resume": {
      resumeCommand: async () => {
        if (options.resumeFails === true) throw new Error("Project directory no longer exists");
        return "cd '/work/app' && '/bin/claude' '--resume' 'ID'";
      },
      resumeInTerminal: async (...args: unknown[]) => {
        resumed.push(args);
      },
    },
    "../lib/zed-terminal": {
      prefillZedTerminal: async (args: unknown) => {
        prefillCalls.push(args);
        if (options.prefill instanceof Error) throw options.prefill;
        return options.prefill ?? { kind: "typed" };
      },
    },
    "../lib/binary": { resolveBinary: async () => "/bin/claude" },
    "../lib/session-types": realSessionTypes,
    "../lib/quote": realQuote,
    "./transcript-view": { TranscriptView: () => null },
    "./zed-window-picker": { ZedWindowPicker: () => null },
    "./session-filters": { SessionFilters: () => null },
  });

  const tree = module.SessionActions({
    item: row,
    terminal: "Terminal",
    editor: options.editor ?? "Zed",
    zedTerminalPrefill: options.zedTerminalPrefill,
    claudeBin: "claude",
    codexBin: "codex",
    onRefresh: () => undefined,
    onToggleDetail: () => undefined,
    filters: {} as never,
  });
  const actions = collect(tree, Action);

  return {
    clipboard,
    toasts,
    failures,
    revealed,
    newWindows,
    resumed,
    prefillCalls,
    titles: () => actions.map((props) => String(props.title)),
    press: async (title) => {
      const props = actions.find((candidate) => candidate.title === title);
      assert.ok(props, `no action titled "${title}"; have: ${actions.map((a) => a.title).join(" | ")}`);
      await (props.onAction as () => Promise<void>)();
    },
  };
}

const COMMAND = "cd '/work/app' && '/bin/claude' '--resume' 'ID'";
const PRIMARY = "Open in Zed and Copy Resume Command";

test("history row: Enter copies the command, moves to the existing window, and says both", async () => {
  const h = setup(item({}), { reveal: true });
  await h.press(PRIMARY);
  assert.deepEqual(h.clipboard, [COMMAND]);
  assert.deepEqual(h.toasts, [
    {
      style: "success",
      title: "Moved to Zed project",
      message: "Resume command copied; paste it in the project's terminal",
    },
  ]);
  assert.deepEqual(h.failures, []);
});

test("history row: Enter opens a new window when none exists, and still says the command is copied", async () => {
  const h = setup(item({}), { reveal: false });
  await h.press(PRIMARY);
  assert.deepEqual(h.clipboard, [COMMAND]);
  assert.equal(h.toasts[0].title, "Opened new Zed window");
  assert.equal(h.toasts[0].message, "Resume command copied; paste it in the project's terminal");
});

test("history row: an ambiguous window keeps the command and the failure says it was copied", async () => {
  const reason = new Error("Several Zed projects or windows match; choose a window explicitly");
  const h = setup(item({}), { reveal: reason });
  await h.press(PRIMARY);
  assert.deepEqual(h.clipboard, [COMMAND]);
  assert.deepEqual(h.toasts, []);
  assert.deepEqual(h.failures, [
    { error: reason, title: "Resume command copied, but no unique project window was found" },
  ]);
});

test("history row that cannot be resumed copies nothing and never claims it did", async () => {
  const h = setup(item({ resumable: false }), { reveal: true });
  assert.ok(h.titles().includes("Open Project in Zed"));
  await h.press("Open Project in Zed");
  assert.deepEqual(h.clipboard, []);
  assert.equal(h.toasts[0].message, "Project window only; no terminal command was sent");
});

test("a failed copy is reported, the clipboard stays untouched, and the toast does not say copied", async () => {
  const h = setup(item({}), { reveal: true, resumeFails: true });
  await h.press(PRIMARY);
  assert.deepEqual(h.clipboard, []);
  assert.equal(h.failures[0].title, "Could not copy resume command");
  assert.equal(h.toasts[0].message, "Project window only; no terminal command was sent");
});

test("Move to Project never touches the clipboard", async () => {
  const h = setup(item({}), { reveal: true });
  await h.press("Move to Zed Project");
  assert.deepEqual(h.clipboard, []);
  assert.equal(h.toasts[0].message, "Project window only; no terminal command was sent");
});

test("Copy Resume Command copies and says so", async () => {
  const h = setup(item({}));
  await h.press("Copy Resume Command");
  assert.deepEqual(h.clipboard, [COMMAND]);
  assert.equal(h.toasts[0].title, "Copied resume command");
  assert.deepEqual(h.revealed, []);
});

test("live session: a successful jump reports where it went and copies nothing", async () => {
  const live = { hostKind: "editor", hostApp: "Zed", hostPid: 680, tty: "/dev/ttys000" };
  const h = setup(item({ live }), {
    goTo: { kind: "reached", title: "Moved to the Zed window", message: "chat · /dev/ttys000" },
  });
  await h.press("Go to Session Window");
  assert.deepEqual(h.clipboard, []);
  assert.deepEqual(h.toasts, [{ style: "success", title: "Moved to the Zed window", message: "chat · /dev/ttys000" }]);
});

test("live session with no GUI host (tmux) reveals the project without copying", async () => {
  const live = { hostKind: "unknown", hostApp: "", hostPid: 0, tty: "/dev/ttys009" };
  const h = setup(item({ live }), { goTo: { kind: "needs-resume" }, reveal: true });
  await h.press("Go to Session Window");
  assert.deepEqual(h.clipboard, []);
  assert.equal(h.toasts[0].message, "Project window only; no terminal command was sent");
});

test("background agent row offers an attach command, not a resume", async () => {
  const h = setup(item({ agent: { id: "job-1" } }));
  assert.ok(h.titles().includes("Copy Attach Command"));
  assert.ok(!h.titles().includes(PRIMARY));
  await h.press("Copy Attach Command");
  assert.deepEqual(h.clipboard, ["'/bin/claude' attach 'job-1'"]);
});

test("a hostile background job id is refused before anything is copied", async () => {
  const h = setup(item({ agent: { id: "x; rm -rf ~" } }));
  await h.press("Copy Attach Command");
  assert.deepEqual(h.clipboard, []);
  assert.equal(h.failures[0].title, "Could not copy attach command");
});

const RESUME = "Resume in Terminal";
const ID = "11111111-2222-4333-8444-555555555555";

test("a background job is never offered Resume in Terminal", async () => {
  const h = setup(item({ agent: { id: "job-1" }, state: "background" }));
  assert.ok(!h.titles().includes(RESUME));
});

test("a stopped Claude session is resumed in the terminal, after rechecking the registry", async () => {
  const h = setup(item({ state: "closed" }), { runningClaude: [] });
  await h.press(RESUME);
  assert.equal(h.resumed.length, 1);
  assert.equal(h.toasts[0].title, "Sent resume command to Terminal");
  assert.deepEqual(h.failures, []);
});

test("a Claude session that started running since the list was built is not resumed", async () => {
  const h = setup(item({ state: "closed" }), { runningClaude: [ID] });
  await h.press(RESUME);
  assert.deepEqual(h.resumed, []);
  assert.equal(h.failures[0].title, "Could not resume session");
  assert.match(String((h.failures[0].error as Error).message), /already running/);
});

test("Resume in Terminal is not offered for a session with unknown ownership or a live process", async () => {
  assert.ok(
    !setup(item({ state: "unknown" }))
      .titles()
      .includes(RESUME),
  );
  assert.ok(
    !setup(item({ live: { hostKind: "unknown" }, state: "working" }))
      .titles()
      .includes(RESUME),
  );
});

test("a Codex session is resumed only when its runtime is confirmed stopped", async () => {
  const stopped = setup(item({ provider: "codex", state: "closed", lastActivityMs: 1 }), {
    codexRuntime: { live: new Map(), uncertain: false },
  });
  await stopped.press(RESUME);
  assert.equal(stopped.resumed.length, 1);

  const uncertain = setup(item({ provider: "codex", state: "closed", lastActivityMs: 1 }), {
    codexRuntime: { live: new Map(), uncertain: true },
  });
  await uncertain.press(RESUME);
  assert.deepEqual(uncertain.resumed, []);
  assert.match(
    String((uncertain.failures[0].error as Error).message),
    /Could not confirm this Codex session is stopped/,
  );

  const running = setup(item({ provider: "codex", state: "closed", lastActivityMs: 1 }), {
    codexRuntime: { live: new Map([[ID, []]]), uncertain: false },
  });
  await running.press(RESUME);
  assert.deepEqual(running.resumed, []);
});

test("pressing Enter twice while Zed is slow opens one window, not two", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = setup(item({}), { reveal: false, gate });
  const first = h.press(PRIMARY);
  const second = h.press(PRIMARY);
  release();
  await Promise.all([first, second]);
  assert.equal(h.revealed.length, 1);
  assert.equal(h.toasts.length, 1);
});

test("the guard is released afterwards, so a later press works again", async () => {
  const h = setup(item({}), { reveal: true });
  await h.press(PRIMARY);
  await h.press(PRIMARY);
  assert.equal(h.revealed.length, 2);
});

test("a second window action while one is running is ignored, whichever button started it", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = setup(item({}), { reveal: true, gate });
  const move = h.press("Move to Zed Project");
  const fresh = h.press("Open Project in New Zed Window");
  release();
  await Promise.all([move, fresh]);
  assert.equal(h.revealed.length, 1);
  assert.deepEqual(h.newWindows, []);
});

const TYPED_MESSAGE = "Typed into a new Zed terminal; press Enter there to run it";

test("with the setting on, a history row also types the command into a new Zed terminal", async () => {
  const h = setup(item({}), { reveal: true, zedTerminalPrefill: true });
  await h.press(PRIMARY);
  assert.deepEqual(h.clipboard, [COMMAND]);
  assert.deepEqual(h.prefillCalls, [{ cwd: "/work/app", command: COMMAND }]);
  assert.equal(h.toasts[0].title, "Moved to Zed project");
  assert.equal(h.toasts[0].message, TYPED_MESSAGE);
});

test("a window that had to be opened gets the terminal too", async () => {
  const h = setup(item({}), { reveal: false, zedTerminalPrefill: true });
  await h.press(PRIMARY);
  assert.equal(h.toasts[0].title, "Opened new Zed window");
  assert.equal(h.toasts[0].message, TYPED_MESSAGE);
});

test("when the terminal step declines, the command is still copied and the reason is shown", async () => {
  const h = setup(item({}), {
    reveal: true,
    zedTerminalPrefill: true,
    prefill: { kind: "skipped", reason: "the clipboard changed" },
  });
  await h.press(PRIMARY);
  assert.deepEqual(h.clipboard, [COMMAND]);
  assert.equal(
    h.toasts[0].message,
    "Resume command copied; paste it in the project's terminal (not typed: the clipboard changed)",
  );
  assert.deepEqual(h.failures, []);
});

test("an unexpected error in the terminal step never becomes a failure", async () => {
  const h = setup(item({}), { reveal: true, zedTerminalPrefill: true, prefill: new Error("boom") });
  await h.press(PRIMARY);
  assert.match(h.toasts[0].message ?? "", /not typed: boom/);
  assert.deepEqual(h.failures, []);
});

test("with the setting off, no terminal step is attempted", async () => {
  const h = setup(item({}), { reveal: true, zedTerminalPrefill: false });
  await h.press(PRIMARY);
  assert.deepEqual(h.prefillCalls, []);
  assert.equal(h.toasts[0].message, "Resume command copied; paste it in the project's terminal");
});

test("the setting defaults to off", async () => {
  const h = setup(item({}), { reveal: true });
  await h.press(PRIMARY);
  assert.deepEqual(h.prefillCalls, []);
});

test("another editor never gets the terminal step", async () => {
  const h = setup(item({}), { reveal: true, zedTerminalPrefill: true, editor: "Visual Studio Code" });
  await h.press("Open in Visual Studio Code and Copy Resume Command");
  assert.deepEqual(h.prefillCalls, []);
});

test("a row that cannot be resumed has nothing to type", async () => {
  const h = setup(item({ resumable: false }), { reveal: true, zedTerminalPrefill: true });
  await h.press("Open Project in Zed");
  assert.deepEqual(h.prefillCalls, []);
});

test("if the copy failed, nothing is typed", async () => {
  const h = setup(item({}), { reveal: true, zedTerminalPrefill: true, resumeFails: true });
  await h.press(PRIMARY);
  assert.deepEqual(h.prefillCalls, []);
});

test("if no window can be found, the terminal step is not attempted", async () => {
  const h = setup(item({}), { reveal: new Error("Several Zed projects match"), zedTerminalPrefill: true });
  await h.press(PRIMARY);
  assert.deepEqual(h.prefillCalls, []);
  assert.equal(h.failures[0].title, "Resume command copied, but no unique project window was found");
});

test("a live session never types anything, whatever the setting", async () => {
  const live = { hostKind: "unknown", hostApp: "", hostPid: 0, tty: "/dev/ttys009" };
  const h = setup(item({ live }), { goTo: { kind: "needs-resume" }, reveal: true, zedTerminalPrefill: true });
  await h.press("Go to Session Window");
  assert.deepEqual(h.prefillCalls, []);
  assert.deepEqual(h.clipboard, []);
});
