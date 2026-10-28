import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type * as BinaryModule from "../src/lib/binary";
import { loadLib } from "./helpers/load-lib";

const binary = loadLib<typeof BinaryModule>("binary", {});

async function workspace(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "binary-test-")));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function executable(path: string): Promise<void> {
  await writeFile(path, "#!/bin/sh\nexit 0\n");
  await chmod(path, 0o755);
}

test("a symlinked CLI is returned as the link, so an upgrade that removes the target does not break the command", async () => {
  const { root, cleanup } = await workspace();
  try {
    const versions = join(root, "versions");
    await mkdir(versions);
    const target = join(versions, "2.1.312");
    await executable(target);
    const link = join(root, "claude");
    await symlink(target, link);

    assert.equal(await binary.resolveBinary("claude", link), link);
  } finally {
    await cleanup();
  }
});

test("a plain executable path is returned unchanged", async () => {
  const { root, cleanup } = await workspace();
  try {
    const path = join(root, "codex");
    await executable(path);
    assert.equal(await binary.resolveBinary("codex", path), path);
  } finally {
    await cleanup();
  }
});

test("a link to something missing is refused rather than guessed around", async () => {
  const { root, cleanup } = await workspace();
  try {
    const link = join(root, "claude");
    await symlink(join(root, "gone"), link);
    await assert.rejects(binary.resolveBinary("claude", link), /claude CLI not found/);
  } finally {
    await cleanup();
  }
});

test("a file that is not executable is refused", async () => {
  const { root, cleanup } = await workspace();
  try {
    const path = join(root, "claude");
    await writeFile(path, "not a program");
    await chmod(path, 0o644);
    await assert.rejects(binary.resolveBinary("claude", path), /CLI not found/);
  } finally {
    await cleanup();
  }
});

test("a directory is refused", async () => {
  const { root, cleanup } = await workspace();
  try {
    await assert.rejects(binary.resolveBinary("claude", root), /CLI not found/);
  } finally {
    await cleanup();
  }
});

test("a shell command or function name is not accepted as a path", async () => {
  for (const value of ["claude --dangerously-skip-permissions", "my-wrapper", "./claude", "~claude"]) {
    await assert.rejects(binary.resolveBinary("claude", value), /absolute executable path/, value);
  }
});
