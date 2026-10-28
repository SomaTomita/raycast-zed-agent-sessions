import { Agent, BackgroundAgent, readAgents } from "./agents";
import { cleanPrompt, projectName, shortId } from "./format";
import { PromptEntry, readRecentPrompts } from "./prompts";
import { LiveSession, readLiveSessions } from "./registry";
import { indexTranscripts, summarizeAll, TranscriptSummary } from "./transcript";

import { ProviderId, sessionKey } from "./session-types";
import { readCodexCatalog } from "./providers/codex";
import { readCodexRuntime } from "./codex-live";
import { CodexRecord } from "./codex-records";

export type SessionState = "working" | "waiting" | "running" | "unknown" | "background" | "closed";

export interface SessionItem {
  /** Stable list key. One row per live process or background job, so sessionId alone is not unique. */
  readonly key: string;
  readonly provider: ProviderId;
  readonly resumable: boolean;
  readonly source: string;
  readonly sessionId: string;
  readonly title: string;
  readonly state: SessionState;
  /** Raw status: registry/CLI value for a process, job state for a background agent, else "closed". */
  readonly statusLabel: string;
  readonly live: LiveSession | null;
  /** Set for a background agent: no process, managed with `claude attach|stop|rm`. */
  readonly agent: BackgroundAgent | null;
  readonly transcript: TranscriptSummary | null;
  readonly lastPrompt: PromptEntry | null;
  readonly cwd: string;
  readonly project: string;
  readonly gitBranch: string;
  readonly model: string;
  readonly lastActivityMs: number;
  readonly messageCount: number | null;
  /** false when messageCount is a lower bound (sampled from a very large transcript). */
  readonly messageCountExact: boolean;
}

interface SessionContext {
  readonly transcript: TranscriptSummary | null;
  readonly lastPrompt: PromptEntry | null;
  readonly agent: BackgroundAgent | null;
}

function stateOf(live: LiveSession | null, agent: BackgroundAgent | null): SessionState {
  if (live !== null) {
    if (live.status === "idle" || live.status === "waiting") return "waiting";
    return live.status === "busy" || live.status === "shell" ? "working" : "running";
  }
  return agent !== null ? "background" : "closed";
}

function titleOf(context: SessionContext, live: LiveSession | null, sessionId: string): string {
  const aiTitle = context.transcript?.aiTitle.trim() ?? "";
  if (aiTitle.length > 0) {
    return aiTitle;
  }
  const prompt = cleanPrompt(context.transcript?.firstPrompt ?? "", 90);
  if (prompt.length > 0) {
    return prompt;
  }
  const name = live?.name ?? context.agent?.name ?? "";
  return name.length > 0 ? name : shortId(sessionId);
}

function build(sessionId: string, live: LiveSession | null, context: SessionContext): SessionItem {
  const { transcript, lastPrompt, agent } = context;
  const declaredCwd = live?.cwd ?? agent?.cwd ?? "";
  const cwd = declaredCwd.length > 0 ? declaredCwd : (transcript?.cwd ?? lastPrompt?.project ?? "");
  const lastActivityMs = Math.max(
    transcript?.lastTimestampMs ?? 0,
    transcript?.mtimeMs ?? 0,
    live?.statusUpdatedAt ?? 0,
    lastPrompt?.timestampMs ?? 0,
    agent?.startedAt ?? 0,
  );

  const key = live !== null ? `pid-${live.pid}` : agent !== null ? `job-${agent.id}` : `session-${sessionId}`;

  return {
    key: sessionKey("claude", key),
    provider: "claude",
    resumable: true,
    source: "cli",
    sessionId,
    title: titleOf(context, live, sessionId),
    state: stateOf(live, agent),
    statusLabel: live?.status ?? agent?.state ?? "closed",
    live,
    agent,
    transcript,
    lastPrompt,
    cwd,
    project: projectName(cwd, transcript?.projectSlug ?? ""),
    gitBranch: transcript?.gitBranch ?? "",
    model: transcript?.model ?? "",
    lastActivityMs,
    messageCount: transcript?.messageCount ?? null,
    messageCountExact: transcript?.messageCountExact ?? true,
  };
}

/**
 * Every field of a live session that the list renders or sorts by. `statusUpdatedAt` matters most:
 * reusing a row whose status happens to match would otherwise freeze its last-activity stamp, and
 * `byActivityDesc` would sort a continuously busy session below one that merely changed state.
 */
function sameLiveSession(a: LiveSession, b: LiveSession): boolean {
  return (
    a.pid === b.pid &&
    a.sessionId === b.sessionId &&
    a.status === b.status &&
    a.waitingFor === b.waitingFor &&
    a.statusUpdatedAt === b.statusUpdatedAt &&
    a.name === b.name &&
    a.cwd === b.cwd &&
    a.tty === b.tty &&
    a.hostApp === b.hostApp &&
    a.hostPid === b.hostPid
  );
}

function byActivityDesc(a: SessionItem, b: SessionItem): number {
  return b.lastActivityMs - a.lastActivityMs;
}

function contextOf(item: SessionItem): SessionContext {
  return {
    transcript: item.transcript,
    lastPrompt: item.lastPrompt,
    agent: item.agent,
  };
}

/** The CLI is optional: a missing or failing binary must not break the session list. */
async function loadAgents(claudeBin?: string): Promise<Agent[]> {
  try {
    return await readAgents(claudeBin);
  } catch {
    return [];
  }
}

/**
 * Live processes (registry), background agents (CLI), and the newest `historyLimit` transcripts,
 * sorted newest activity first. A session opened in two terminals yields two rows.
 */
async function loadClaudeSessions(historyLimit: number, claudeBin?: string): Promise<SessionItem[]> {
  // Agents first: reading them fills the pid status cache that readLiveSessions merges in.
  const agents = await loadAgents(claudeBin);
  const [live, index, prompts] = await Promise.all([readLiveSessions(), indexTranscripts(), readRecentPrompts()]);

  const filesById = new Map(index.map((file) => [file.sessionId, file]));

  // Always summarise live and background sessions, even when their transcript is outside the window.
  const targets = new Map(index.slice(0, Math.max(1, historyLimit)).map((file) => [file.path, file]));
  for (const sessionId of [...live.map((session) => session.sessionId), ...agents.map((agent) => agent.sessionId)]) {
    const file = filesById.get(sessionId);
    if (file !== undefined) {
      targets.set(file.path, file);
    }
  }

  const summaries = await summarizeAll([...targets.values()]);
  const summaryById = new Map(summaries.map((summary) => [summary.sessionId, summary]));

  const contextFor = (sessionId: string, agent: BackgroundAgent | null = null): SessionContext => ({
    transcript: summaryById.get(sessionId) ?? null,
    lastPrompt: prompts.get(sessionId) ?? null,
    agent,
  });

  const liveIds = new Set(live.map((session) => session.sessionId));
  const liveItems = live.map((session) => build(session.sessionId, session, contextFor(session.sessionId)));

  const backgroundAgents = agents.filter(
    (agent): agent is BackgroundAgent => agent.kind === "background" && !liveIds.has(agent.sessionId),
  );
  const backgroundIds = new Set(backgroundAgents.map((agent) => agent.sessionId));
  const backgroundItems = backgroundAgents.map((agent) =>
    build(agent.sessionId, null, contextFor(agent.sessionId, agent)),
  );

  const closedItems = summaries
    .filter((summary) => !liveIds.has(summary.sessionId) && !backgroundIds.has(summary.sessionId))
    .map((summary) => build(summary.sessionId, null, contextFor(summary.sessionId)));

  return [...liveItems, ...backgroundItems, ...closedItems].sort(byActivityDesc);
}

/**
 * Re-stamps cached items with a fresh registry read so live status can be polled
 * without rescanning transcripts. Unchanged rows keep their object identity.
 */
export function applyLiveSessions(items: readonly SessionItem[], live: readonly LiveSession[]): SessionItem[] {
  const codex = items.filter((item) => item.provider === "codex");
  items = items.filter((item) => item.provider === "claude");
  // One pass: the previous row per session (for transcript context) and per pid (for identity reuse).
  // Contexts are derived lazily below, so a 500 row history does not allocate 500 throwaway objects.
  const previousBySession = new Map<string, SessionItem>();
  const previousByPid = new Map<number, SessionItem>();
  for (const item of items) {
    if (!previousBySession.has(item.sessionId)) {
      previousBySession.set(item.sessionId, item);
    }
    if (item.live !== null) {
      previousByPid.set(item.live.pid, item);
    }
  }

  const liveIds = new Set(live.map((session) => session.sessionId));

  const liveItems = live.map((session) => {
    const previous = previousByPid.get(session.pid);
    if (previous !== undefined && previous.live !== null && sameLiveSession(previous.live, session)) {
      return previous;
    }
    const source = previousBySession.get(session.sessionId);
    const context: SessionContext =
      source === undefined
        ? { transcript: null, lastPrompt: null, agent: null }
        : {
            transcript: source.transcript,
            lastPrompt: source.lastPrompt,
            agent: null,
          };
    return build(session.sessionId, session, context);
  });

  // Sessions whose process disappeared fall back to a single history row; background rows pass through.
  const restById = new Map<string, SessionItem>();
  for (const item of items) {
    if (liveIds.has(item.sessionId) || restById.has(item.sessionId)) {
      continue;
    }
    restById.set(item.sessionId, item.live === null ? item : build(item.sessionId, null, contextOf(item)));
  }

  return [...liveItems, ...restById.values(), ...codex].sort(byActivityDesc);
}

function codexItem(session: CodexRecord, live: LiveSession | null, uncertain: boolean): SessionItem {
  const state = live
    ? live.status === "busy"
      ? "working"
      : live.status === "idle"
        ? "waiting"
        : "running"
    : uncertain
      ? "unknown"
      : "closed";
  return {
    key: sessionKey("codex", live ? `${session.id}:pid-${live.pid}` : session.id),
    provider: "codex",
    resumable: session.resumable,
    source: session.source,
    sessionId: session.id,
    title: cleanPrompt(session.title, 120),
    state,
    statusLabel: live
      ? live.status === "busy"
        ? "working · turn started"
        : live.status === "idle"
          ? "idle · turn completed or interrupted"
          : "running · activity unconfirmed"
      : uncertain
        ? "runtime unknown"
        : "history",
    live,
    agent: null,
    lastPrompt: null,
    cwd: session.cwd,
    project: projectName(session.cwd, ""),
    gitBranch: session.branch,
    model: session.model,
    lastActivityMs: Math.max(session.updatedAt, live?.statusUpdatedAt ?? 0),
    messageCount: null,
    messageCountExact: false,
    transcript: session.path
      ? {
          sessionId: session.id,
          path: session.path,
          projectSlug: "",
          mtimeMs: session.updatedAt,
          sizeBytes: 0,
          cwd: session.cwd,
          gitBranch: session.branch,
          version: "",
          aiTitle: session.title,
          firstPrompt: session.firstPrompt,
          model: session.model,
          messageCount: 0,
          messageCountExact: false,
          lastTimestampMs: session.updatedAt,
        }
      : null,
  };
}

function codexRecordOf(item: SessionItem): CodexRecord {
  return {
    id: item.sessionId,
    cwd: item.cwd,
    title: item.title,
    firstPrompt: item.transcript?.firstPrompt ?? "",
    path: item.transcript?.path ?? "",
    updatedAt: item.lastActivityMs,
    branch: item.gitBranch,
    model: item.model,
    source: item.source,
    resumable: item.resumable,
  };
}

export interface LiveSnapshot {
  readonly claude: LiveSession[] | null;
  readonly codex: [string, readonly LiveSession[]][] | null;
  readonly codexUncertain: boolean;
  readonly observedAt: number;
}

/** Refresh runtime and lifecycle tails without rescanning Claude transcripts or the Codex catalog. */
export async function readLiveSnapshot(items: readonly SessionItem[]): Promise<LiveSnapshot> {
  const records = new Map(
    items.filter((item) => item.provider === "codex").map((item) => [item.sessionId, codexRecordOf(item)]),
  );
  const [claude, codex] = await Promise.allSettled([readLiveSessions(), readCodexRuntime([...records.values()])]);
  return {
    claude: claude.status === "fulfilled" ? claude.value : null,
    codex: codex.status === "fulfilled" ? [...codex.value.live] : null,
    codexUncertain: codex.status === "fulfilled" ? codex.value.uncertain : true,
    observedAt: Date.now(),
  };
}

export function applyRuntimeSnapshot(items: readonly SessionItem[], snapshot: LiveSnapshot): SessionItem[] {
  const merged = snapshot.claude === null ? [...items] : applyLiveSessions(items, snapshot.claude);
  if (snapshot.codex === null) return merged;
  const live = new Map(snapshot.codex);
  const result = merged.filter((item) => item.provider === "claude");
  const seen = new Set<string>();
  for (const item of merged) {
    if (item.provider !== "codex" || seen.has(item.sessionId)) continue;
    seen.add(item.sessionId);
    const record = codexRecordOf(item);
    const instances = live.get(item.sessionId);
    if (instances?.length)
      result.push(...instances.map((instance) => codexItem(record, instance, snapshot.codexUncertain)));
    else result.push(codexItem(record, null, snapshot.codexUncertain));
  }
  return result.sort(byActivityDesc);
}

export interface SessionSnapshot {
  readonly items: SessionItem[];
  readonly warnings: string[];
  readonly observedAt: number;
}

let previousClaude: SessionItem[] = [];
let previousCodex: SessionItem[] = [];

export async function loadSessionSnapshot(historyLimit: number, claudeBin?: string): Promise<SessionSnapshot> {
  const [claude, codex] = await Promise.allSettled([
    loadClaudeSessions(historyLimit, claudeBin),
    readCodexCatalog(historyLimit),
  ]);
  if (claude.status === "fulfilled") previousClaude = claude.value;
  const items = [...previousClaude];
  const warnings = claude.status === "rejected" ? ["Claude history is unavailable"] : [];
  if (codex.status === "fulfilled") {
    if (codex.value.warning) warnings.push(codex.value.warning);
    if (codex.value.warning && !codex.value.sessions.length && previousCodex.length) {
      return {
        items: [...items, ...previousCodex].sort(byActivityDesc),
        warnings: [...warnings, "Showing cached Codex sessions"],
        observedAt: Date.now(),
      };
    }
    const runtime = await readCodexRuntime(codex.value.sessions);
    const codexItems: SessionItem[] = [];
    for (const session of codex.value.sessions) {
      const instances = runtime.live.get(session.id);
      if (instances?.length) codexItems.push(...instances.map((live) => codexItem(session, live, runtime.uncertain)));
      else codexItems.push(codexItem(session, null, runtime.uncertain));
    }
    previousCodex = codexItems;
    items.push(...codexItems);
  } else {
    warnings.push("Codex history is unavailable; showing cached sessions");
    items.push(...previousCodex);
  }
  return {
    items: items.sort(byActivityDesc),
    warnings,
    observedAt: Date.now(),
  };
}
