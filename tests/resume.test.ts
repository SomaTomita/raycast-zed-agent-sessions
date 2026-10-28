import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type * as ResumeModule from "../src/lib/resume";
import { appleQuote, shellQuote } from "../src/lib/quote";
import { loadLib } from "./helpers/load-lib";

const ID = "11111111-2222-4333-8444-555555555555";

function setup(): { resume: typeof ResumeModule; scripts: string[] } {
  const scripts: string[] = [];
  const resume = loadLib<typeof ResumeModule>("resume", {
    "@raycast/utils": {
      runAppleScript: async (script: string) => {
        scripts.push(script);
        return "";
      },
    },
  });
  return { resume, scripts };
}

/** A project directory and a fake CLI, both under a fresh temp root. */
async function fixture(directoryName = "project"): Promise<{ root: string; cwd: string; bin: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "resume-test-")));
  const cwd = join(root, directoryName);
  await mkdir(cwd);
  const bin = join(root, "fake-cli");
  await writeFile(bin, "#!/bin/sh\nexit 0\n");
  await chmod(bin, 0o755);
  return { root, cwd, bin };
}

test("the Claude resume command is cd, quoted binary, --resume and the session id", async () => {
  const { resume } = setup();
  const { root, cwd, bin } = await fixture();
  try {
    const command = await resume.resumeCommand({ provider: "claude", sessionId: ID, cwd }, bin);
    assert.equal(command, `cd ${shellQuote(cwd)} && ${shellQuote(bin)} '--resume' '${ID}'`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Codex resume command uses the resume subcommand", async () => {
  const { resume } = setup();
  const { root, cwd, bin } = await fixture();
  try {
    const command = await resume.resumeCommand({ provider: "codex", sessionId: ID, cwd }, bin);
    assert.ok(command.endsWith(`${shellQuote(bin)} 'resume' '${ID}'`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a directory name with a quote cannot escape the shell command", async () => {
  const { resume } = setup();
  const { root, cwd, bin } = await fixture("it's $(touch pwned)");
  try {
    const command = await resume.resumeCommand({ provider: "claude", sessionId: ID, cwd }, bin);
    assert.ok(command.startsWith(`cd ${shellQuote(cwd)} && `));
    assert.ok(command.includes(`'\\''`), "the single quote must be re-escaped");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a vanished project directory is reported, not resumed", async () => {
  const { resume } = setup();
  const { root, cwd, bin } = await fixture();
  try {
    await rm(cwd, { recursive: true });
    await assert.rejects(resume.resumeCommand({ provider: "claude", sessionId: ID, cwd }, bin), /ENOENT/);
    await writeFile(cwd, "a file, not a directory");
    await assert.rejects(
      resume.resumeCommand({ provider: "claude", sessionId: ID, cwd }, bin),
      /Project directory no longer exists/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a session id that is not a UUID is rejected before anything runs", async () => {
  const { resume, scripts } = setup();
  const { root, cwd, bin } = await fixture();
  try {
    await assert.rejects(
      resume.resumeInTerminal({
        terminal: "Terminal",
        target: { provider: "claude", sessionId: "x; rm -rf ~", cwd },
        preferred: bin,
      }),
      /Invalid session ID/,
    );
    assert.deepEqual(scripts, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Terminal.app receives the command as an escaped AppleScript string", async () => {
  const { resume, scripts } = setup();
  const { root, cwd, bin } = await fixture('with "quotes" and \\ slash');
  try {
    await resume.resumeInTerminal({
      terminal: "Terminal",
      target: { provider: "claude", sessionId: ID, cwd },
      preferred: bin,
    });
    const command = await resume.resumeCommand({ provider: "claude", sessionId: ID, cwd }, bin);
    assert.equal(scripts.length, 1);
    assert.ok(scripts[0].includes('tell application "Terminal"'));
    assert.ok(scripts[0].includes(`do script ${appleQuote(command)}`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("iTerm2 opens a new window and writes the command", async () => {
  const { resume, scripts } = setup();
  const { root, cwd, bin } = await fixture();
  try {
    await resume.resumeInTerminal({
      terminal: "iTerm",
      target: { provider: "codex", sessionId: ID, cwd },
      preferred: bin,
    });
    assert.ok(scripts[0].includes('tell application "iTerm"'));
    assert.ok(scripts[0].includes("create window with default profile"));
    assert.ok(scripts[0].includes("write text "));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
