import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildResumeSpec, formatResumeCommand } from "../src/lib/resume-spec";
import { resolveBinary } from "../src/lib/binary";
import { shellQuote, appleQuote } from "../src/lib/quote";

const id = "12345678-1234-1234-1234-123456789abc";
test("provider-specific arguments remain separate from the executable", () => {
  assert.deepEqual(buildResumeSpec("claude", "/tmp/cli", "/tmp/project", id).args, ["--resume", id]);
  assert.deepEqual(buildResumeSpec("codex", "/tmp/cli", "/tmp/project", id).args, ["resume", id]);
});
test("rejects option-like and malformed IDs, missing directories, and shell fragments", () => {
  for (const invalid of ["--------", "--help", "$(touch /tmp/no)", "", `${id};exit`]) {
    assert.throws(() => buildResumeSpec("codex", "/tmp/cli", "/tmp", invalid));
  }
  assert.throws(() => buildResumeSpec("claude", "claude; exit", "/tmp", id));
  assert.throws(() => buildResumeSpec("claude", "/bin/echo", "", id));
});
test("shell quoting preserves literal metacharacters without evaluating them", () => {
  for (const value of ["", "a b", "a'b", 'a"b', "line\nbreak", "$(printf injected)", "`printf injected`", "a\\b"]) {
    const actual = execFileSync("/bin/sh", ["-c", `printf '%s' ${shellQuote(value)}`], { encoding: "utf8" });
    assert.equal(actual, value);
  }
  const command = formatResumeCommand(buildResumeSpec("claude", "/tmp/cli 'quoted'", "/tmp/$(literal)", id));
  assert.ok(command.includes("cd '/tmp/$(literal)'"));
});
test("AppleScript quoting escapes quotes, backslashes and line breaks", () => {
  assert.equal(appleQuote('a"b\\c\nd\re'), '"a\\"b\\\\c\\nd\\re"');
});
test("binary resolver refuses a shell function or compound command", async () => {
  await assert.rejects(resolveBinary("codex", "codex --full-auto"));
  await assert.rejects(resolveBinary("codex", "/nonexistent/explicit-codex"));
  assert.equal(await resolveBinary("claude", "/bin/echo"), "/bin/echo");
});
