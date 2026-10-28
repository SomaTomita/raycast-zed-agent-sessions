import { basename } from "node:path";
import { detectHost, readProcessTable } from "./host";
import type { LiveSession } from "./registry";
import { CODEX_HOME, sessionIdFromOpenPath, safeRolloutPath } from "./providers/codex";
import type { CodexRecord } from "./codex-records";
import { run } from "./run";
import { readCodexActivity, CodexActivity } from "./codex-activity";

export interface CodexRuntime {
  readonly live: ReadonlyMap<string, readonly LiveSession[]>;
  readonly uncertain: boolean;
}

/** Retain only session paths; never read file contents or process environments. */
export function openSessionOwners(
  output: string,
  sessions: readonly CodexRecord[],
  root: string,
): Map<string, Set<number>> {
  const paths = new Map(sessions.filter((s) => s.path).map((s) => [s.path, s.id]));
  const ids = new Set(sessions.map((s) => s.id));
  const owners = new Map<string, Set<number>>();
  let pid = 0;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (!line.startsWith("n") || !Number.isInteger(pid) || pid <= 1) continue;
    const path = line.slice(1);
    const id = paths.get(path) ?? sessionIdFromOpenPath(path, root);
    if (!id || !ids.has(id)) continue;
    const pids = owners.get(id) ?? new Set<number>();
    pids.add(pid);
    owners.set(id, pids);
  }
  return owners;
}

export async function readCodexRuntime(sessions: readonly CodexRecord[]): Promise<CodexRuntime> {
  const live = new Map<string, LiveSession[]>();
  const table = await readProcessTable();
  if (!table.size) return { live, uncertain: true };
  const pids = [...table].filter(([, row]) => /^codex(?:-[\w-]+)?$/.test(basename(row.command))).map(([pid]) => pid);
  if (!pids.length) return { live, uncertain: false };
  try {
    const owners = openSessionOwners(
      await run("/usr/sbin/lsof", ["-a", "-p", pids.join(","), "-Fn"]),
      sessions,
      CODEX_HOME,
    );
    for (const [id, ownersPids] of owners) {
      const session = sessions.find((s) => s.id === id);
      if (!session) continue;
      let activity: CodexActivity = { status: "running", at: null };
      try {
        const path = await safeRolloutPath(session.path);
        if (path) activity = await readCodexActivity(path);
      } catch {
        /* Keep activity unconfirmed if a transcript cannot be read. */
      }
      const instances = [...ownersPids].map((pid): LiveSession => {
        const host = detectHost(pid, table);
        return {
          pid,
          sessionId: id,
          cwd: session.cwd,
          name: session.title,
          status: activity.status,
          kind: "codex",
          entrypoint: "",
          version: "",
          startedAt: null,
          statusUpdatedAt: activity.at,
          hostKind: host?.kind ?? "unknown",
          hostApp: host?.appName ?? "",
          hostPid: host?.hostPid ?? 0,
          tty: host?.tty ?? "",
          waitingFor: "",
        };
      });
      live.set(id, instances);
    }
  } catch {
    /* Ownership is unknown; no automatic terminal resume is allowed. */
  }
  // A Codex process can own threads without a visible file handle. Unmatched sessions remain unknown.
  return { live, uncertain: true };
}
