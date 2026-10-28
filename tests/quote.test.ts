import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { appleQuote, shellQuote } from "../src/lib/quote";

const HOSTILE = [
  "plain",
  "with space",
  "it's",
  `both ' and "`,
  "$(touch /tmp/should-not-exist)",
  "`id`",
  "a; b && c | d",
  "back\\slash",
  "new\nline",
  "tab\there",
  "*glob* ?",
  "~/not-expanded",
  "--flag-looking",
  "日本語 と emoji 🙂",
  "",
];

// These round-trip through the real interpreter. Comparing a quoter with itself proves nothing.
test("shellQuote survives a real /bin/sh unchanged", () => {
  for (const value of HOSTILE) {
    const out = execFileSync("/bin/sh", ["-c", `printf %s ${shellQuote(value)}`], { encoding: "utf8" });
    assert.equal(out, value, JSON.stringify(value));
  }
});

test("shellQuote keeps one argument as one argument", () => {
  const value = "a b; echo injected";
  const out = execFileSync("/bin/sh", ["-c", `set -- ${shellQuote(value)}; echo $#`], { encoding: "utf8" });
  assert.equal(out.trim(), "1");
});

test("appleQuote survives a real osascript unchanged", { skip: process.platform !== "darwin" }, () => {
  for (const value of HOSTILE.filter((v) => !v.includes("\n") && v !== "")) {
    // `return` of a literal runs no application and touches nothing.
    const out = execFileSync("/usr/bin/osascript", ["-e", `return ${appleQuote(value)}`], { encoding: "utf8" });
    assert.equal(out.replace(/\n$/, ""), value, JSON.stringify(value));
  }
});

test(
  "appleQuote keeps a quote and a backslash from ending the literal",
  { skip: process.platform !== "darwin" },
  () => {
    const value = 'x" & (do shell script "echo pwned") & "';
    const out = execFileSync("/usr/bin/osascript", ["-e", `return ${appleQuote(value)}`], { encoding: "utf8" });
    assert.equal(out.trim(), value);
    assert.ok(!out.includes("pwned\n"), "the injected command must not have run");
  },
);
