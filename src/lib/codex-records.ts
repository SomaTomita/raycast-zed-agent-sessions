import { isAbsolute, relative } from "node:path";
import { SESSION_ID } from "./session-types";
import type { TranscriptMessage } from "./messages";

export interface CodexRecord {
  readonly id: string;
  readonly cwd: string;
  readonly title: string;
  readonly firstPrompt: string;
  readonly path: string;
  readonly updatedAt: number;
  readonly branch: string;
  readonly model: string;
  readonly source: string;
  readonly resumable: boolean;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function inside(path: string, root: string): boolean {
  if (!isAbsolute(path) || !isAbsolute(root)) return false;
  const suffix = relative(root, path);
  return suffix === "" || (!suffix.startsWith("../") && suffix !== ".." && !isAbsolute(suffix));
}

export function timestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function codexRecord(value: unknown): CodexRecord | null {
  const row = record(value);
  const id = text(row.id);
  if (!SESSION_ID.test(id) || row.archived === 1 || row.archived === true) return null;
  const source = text(row.source);
  if (source === "exec" || source.startsWith("{") || row.thread_source === "subagent") return null;
  const prompt = text(row.first_user_message);
  return {
    id,
    cwd: text(row.cwd),
    path: text(row.rollout_path),
    firstPrompt: prompt,
    title: (text(row.name) || text(row.title) || prompt || id.slice(0, 8)).slice(0, 300),
    updatedAt: timestamp(row.updated_at_ms ?? row.updated_at),
    branch: text(row.git_branch),
    model: text(row.model),
    source,
    // CLI resumes are enabled only for known local interactive origins.
    resumable: (source === "cli" || source === "tui") && row.thread_source !== "subagent",
  };
}

export function parseRolloutHead(input: string, path: string): CodexRecord | null {
  let metadata: Record<string, unknown> = {};
  let firstPrompt = "";
  for (const line of input.split("\n")) {
    let entry: Record<string, unknown>;
    try {
      entry = record(JSON.parse(line));
    } catch {
      continue;
    }
    const payload = record(entry.payload);
    if (entry.type === "session_meta") metadata = payload;
    if (!firstPrompt && entry.type === "event_msg" && payload.type === "user_message")
      firstPrompt = text(payload.message);
    if (!firstPrompt && entry.type === "response_item" && payload.role === "user")
      firstPrompt = content(payload.content);
  }
  const git = record(metadata.git);
  return codexRecord({
    id: metadata.id,
    cwd: metadata.cwd,
    title: firstPrompt,
    first_user_message: firstPrompt,
    rollout_path: path,
    updated_at: metadata.timestamp,
    git_branch: git.branch,
    source: metadata.source,
  });
}

function content(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map(record)
    .filter((block) => block.type === "input_text" || block.type === "output_text" || block.type === "text")
    .map((block) => text(block.text))
    .join("\n");
}

export function parseCodexMessages(input: string, limit: number): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  const events: TranscriptMessage[] = [];
  for (const line of input.split("\n")) {
    let entry: Record<string, unknown>;
    try {
      entry = record(JSON.parse(line));
    } catch {
      continue;
    }
    const payload = record(entry.payload);
    const stamp = timestamp(entry.timestamp) || null;
    if (
      entry.type === "response_item" &&
      payload.type === "message" &&
      (payload.role === "user" || payload.role === "assistant")
    ) {
      const body = content(payload.content).trim();
      if (body)
        messages.push({
          role: payload.role === "user" ? "user" : "codex",
          text: body,
          timestampMs: stamp,
        });
    } else if (entry.type === "event_msg" && (payload.type === "user_message" || payload.type === "agent_message")) {
      const body = text(payload.message).trim();
      if (body)
        events.push({
          role: payload.type === "user_message" ? "user" : "codex",
          text: body,
          timestampMs: stamp,
        });
    }
  }
  // Modern rollouts duplicate messages as events and response items. Prefer one representation.
  return (messages.length ? messages : events).slice(-limit);
}
