import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "./run";
import { parseWorkspacePaths, ZedSnapshot, ZedWorkspace, containsProject } from "./zed-targets";

// Stable only: a Preview database must never corroborate a Stable window.
const DATABASE = join(homedir(), "Library/Application Support/Zed/db/0-stable/db.sqlite");

export async function readZedSnapshot(): Promise<ZedSnapshot> {
  if (!existsSync(DATABASE))
    return {
      kind: "unavailable",
      reason: "Zed workspace database is unavailable",
    };
  try {
    const rows = JSON.parse(
      (await run("/usr/bin/sqlite3", [
        "-readonly",
        "-cmd",
        ".timeout 1000",
        "-json",
        DATABASE,
        `SELECT paths, window_id, remote_connection_id FROM workspaces
       WHERE window_id IS NOT NULL AND paths IS NOT NULL AND paths <> ''
       AND session_id = (SELECT session_id FROM workspaces WHERE session_id IS NOT NULL AND session_id <> '' ORDER BY timestamp DESC LIMIT 1);`,
      ])) || "[]",
    ) as {
      paths: unknown;
      window_id: unknown;
      remote_connection_id: unknown;
    }[];
    const workspaces: ZedWorkspace[] = [];
    for (const row of rows) {
      if (row.remote_connection_id !== null) continue;
      const paths = parseWorkspacePaths(row.paths);
      if (paths === null || typeof row.window_id !== "number") {
        return {
          kind: "unavailable",
          reason: "Zed workspace path format is ambiguous or unsupported",
        };
      }
      workspaces.push({ windowId: row.window_id, paths });
    }
    return { kind: "available", workspaces };
  } catch {
    return {
      kind: "unavailable",
      reason: "Could not read Zed workspaces; its schema or access may have changed",
    };
  }
}

/** Compatibility helper; navigation uses the explicit snapshot result instead. */
export async function readOpenZedProjects(): Promise<string[]> {
  const snapshot = await readZedSnapshot();
  return snapshot.kind === "available" ? snapshot.workspaces.flatMap((workspace) => [...workspace.paths]) : [];
}

export function isInsideOpenProject(cwd: string, openProjects: readonly string[]): boolean {
  return openProjects.some((project) => containsProject(cwd, project));
}
