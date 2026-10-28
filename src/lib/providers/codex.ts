import { open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";

import { codexRecord, CodexRecord, inside, parseRolloutHead, record, text } from "../codex-records";
import { run } from "../run";
import { mapWithConcurrency } from "../async";
import { SESSION_ID } from "../session-types";

export const CODEX_HOME = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");

export interface CodexCatalog {
  readonly sessions: readonly CodexRecord[];
  readonly warning: string | null;
}

/** A transcript must really live in a session store, including after resolving symlinks. */
export async function safeRolloutPath(path: string, root = CODEX_HOME): Promise<string | null> {
  if (!isAbsolute(path) || !/^rollout-.*\.jsonl$/.test(basename(path))) return null;
  try {
    const [resolved, home] = await Promise.all([realpath(path), realpath(root)]);
    return ["sessions", "archived_sessions"].some((dir) => inside(resolved, join(home, dir))) ? resolved : null;
  } catch {
    return null;
  }
}

async function readHead(path: string): Promise<string> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(192 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

/** Only numeric date directories and rollout files are visited; no home-wide recursion. */
async function fallback(limit: number, root: string): Promise<CodexRecord[]> {
  const candidates: string[] = [];
  let directories = [join(root, "sessions")];
  for (let depth = 0; depth < 3; depth++) {
    const next: string[] = [];
    for (const directory of directories) {
      try {
        const entries = await readdir(directory, { withFileTypes: true });
        next.push(
          ...entries.filter((e) => e.isDirectory() && /^\d{2,4}$/.test(e.name)).map((e) => join(directory, e.name)),
        );
      } catch {
        /* Missing session store is normal on first use. */
      }
    }
    directories = next.sort().reverse().slice(0, 120);
  }
  for (const directory of directories) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      candidates.push(
        ...entries.filter((e) => e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)).map((e) => join(directory, e.name)),
      );
    } catch {
      /* A directory may disappear during refresh. */
    }
  }
  const parsed = await mapWithConcurrency(candidates.sort().reverse().slice(0, limit), 4, async (path) => {
    try {
      const safe = await safeRolloutPath(path, root);
      if (!safe) return null;
      const [head, info] = await Promise.all([readHead(safe), stat(safe)]);
      const value = parseRolloutHead(head, safe);
      return value ? { ...value, updatedAt: info.mtimeMs } : null;
    } catch {
      return null;
    }
  });
  return parsed.filter((entry): entry is CodexRecord => entry !== null);
}

export async function readCodexCatalog(limit: number, root = CODEX_HOME): Promise<CodexCatalog> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: [], warning: null };
    return {
      sessions: [],
      warning: "Codex history is unavailable; check access to its session store",
    };
  }
  const databases = entries
    .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/.test(entry.name))
    .sort((a, b) => Number(b.name.match(/\d+/)?.[0]) - Number(a.name.match(/\d+/)?.[0]));
  for (const candidate of databases) {
    try {
      const database = join(root, candidate.name);
      const columns = JSON.parse(
        await run("/usr/bin/sqlite3", [
          "-readonly",
          "-cmd",
          ".timeout 1000",
          "-json",
          database,
          "PRAGMA table_info(threads);",
        ]),
      ) as unknown[];
      const names = new Set(columns.map((column) => text(record(column).name)));
      if (!["id", "cwd", "rollout_path", "title", "source", "archived"].every((name) => names.has(name))) continue;
      const required = ["id", "cwd", "rollout_path", "source", "archived"];
      const bounded = ["title", "name", "first_user_message", "git_branch", "model", "thread_source"];
      const fields = [
        ...required,
        ...bounded.map((name) => (names.has(name) ? `substr(${name},1,2000) AS ${name}` : `NULL AS ${name}`)),
      ];
      const updated = names.has("updated_at_ms") ? "updated_at_ms" : names.has("updated_at") ? "updated_at" : null;
      if (!updated) continue;
      fields.push(updated);
      const count = Math.max(1, Math.min(500, Math.floor(limit)));
      const query = `SELECT ${fields.join(",")} FROM threads WHERE archived=0 AND source <> 'exec' AND source NOT LIKE '{%'${names.has("thread_source") ? " AND COALESCE(thread_source,'') <> 'subagent'" : ""} ORDER BY ${updated} DESC LIMIT ${count};`;
      const rows = JSON.parse(
        (await run("/usr/bin/sqlite3", ["-readonly", "-cmd", ".timeout 1000", "-json", database, query])) || "[]",
      ) as unknown[];
      return {
        sessions: rows.map(codexRecord).filter((item): item is CodexRecord => item !== null),
        warning: null,
      };
    } catch {
      /* Try an older compatible catalog, then bounded rollout discovery. */
    }
  }
  const sessions = await fallback(limit, root);
  return {
    sessions,
    warning: "Codex catalog unavailable: showing a limited scan of recent rollout files",
  };
}

export function sessionIdFromOpenPath(path: string, root: string): string | null {
  const suffix = path.startsWith(`${join(root, "thread-writer-locks")}/`) ? basename(path, ".lock") : "";
  return SESSION_ID.test(suffix) && path.endsWith(".lock") ? suffix : null;
}
