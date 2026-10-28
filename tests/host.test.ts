import assert from "node:assert/strict";
import test from "node:test";

import type * as HostModule from "../src/lib/host";
import { detectHost } from "../src/lib/host";
import { loadLib } from "./helpers/load-lib";

type Table = Parameters<typeof detectHost>[1];

const PYTHON_APP =
  "/opt/homebrew/Cellar/python@3.15/3.15.0/Frameworks/Python.framework/Versions/3.15/Resources/Python.app/Contents/MacOS/Python";

function table(rows: ReadonlyArray<readonly [number, number, string, string]>): Table {
  return new Map(rows.map(([pid, ppid, tty, command]) => [pid, { ppid, tty, command }]));
}

test("a session launched from a Zed terminal resolves to Zed", () => {
  const host = detectHost(
    10,
    table([
      [10, 9, "ttys001", "claude"],
      [9, 8, "ttys001", "-zsh"],
      [8, 7, "ttys001", "/usr/bin/login"],
      [7, 1, "??", "/Applications/Zed.app/Contents/MacOS/zed"],
    ]),
  );
  assert.deepEqual(host, { kind: "editor", appName: "Zed", hostPid: 7, tty: "/dev/ttys001" });
});

test("a Python.app wrapper between the CLI and the terminal is not the host", () => {
  const host = detectHost(
    10,
    table([
      [10, 9, "ttys007", "/Users/me/.local/bin/codex"],
      [9, 8, "ttys007", PYTHON_APP],
      [8, 7, "ttys007", "-zsh"],
      [7, 6, "ttys007", "/usr/bin/login"],
      [6, 1, "??", "/Applications/Zed.app/Contents/MacOS/zed"],
    ]),
  );
  assert.equal(host?.appName, "Zed");
  assert.equal(host?.hostPid, 6);
  assert.equal(host?.kind, "editor");
});

test("an unrecognised GUI app is still an activate-only host", () => {
  const host = detectHost(
    3,
    table([
      [3, 2, "ttys002", "claude"],
      [2, 1, "??", "/Applications/Some Terminal.app/Contents/MacOS/Some Terminal"],
    ]),
  );
  assert.deepEqual(host, { kind: "app", appName: "Some Terminal", hostPid: 2, tty: "/dev/ttys002" });
});

function tableFrom(output: string | Error): Promise<Map<number, unknown>> {
  const host = loadLib<typeof HostModule>("host", {
    "./run": {
      run: async () => {
        if (output instanceof Error) throw output;
        return output;
      },
    },
  });
  return host.readProcessTable() as Promise<Map<number, unknown>>;
}

test("the process table keeps spaces in an application path and skips malformed lines", async () => {
  const table = await tableFrom(
    [
      "  10     1 ??       /Applications/Visual Studio Code.app/Contents/MacOS/Electron",
      "  11    10 ttys002  claude",
      "  oops",
      "  x  y z w",
      "",
    ].join("\n"),
  );
  assert.deepEqual([...table.keys()], [10, 11]);
  assert.deepEqual(table.get(10), {
    ppid: 1,
    tty: "??",
    command: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
  });
  assert.deepEqual(table.get(11), { ppid: 10, tty: "ttys002", command: "claude" });
});

test("a failing ps gives an empty table", async () => {
  assert.equal((await tableFrom(new Error("ps failed"))).size, 0);
});

test("a session with no process-table entry has no host", () => {
  assert.equal(detectHost(99, table([[10, 1, "??", "claude"]])), null);
});

test("a chain that ends before reaching a GUI app is an unknown host that still keeps the tty", () => {
  const host = detectHost(
    10,
    table([
      [10, 9, "ttys003", "claude"],
      [9, 8, "ttys003", "-zsh"],
      [8, 1, "??", "/opt/homebrew/bin/tmux"],
    ]),
  );
  assert.deepEqual(host, { kind: "unknown", appName: "", hostPid: 0, tty: "/dev/ttys003" });
});

test("a bare terminal binary is recognised without an app bundle", () => {
  const host = detectHost(
    10,
    table([
      [10, 9, "ttys001", "claude"],
      [9, 1, "??", "/usr/local/bin/wezterm-gui"],
    ]),
  );
  assert.equal(host?.kind, "app");
  assert.equal(host?.appName, "wezterm-gui");
  assert.equal(host?.hostPid, 9);
});
