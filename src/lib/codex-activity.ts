import { record, text, timestamp } from "./codex-records";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { readTail } from "./tail";

export interface CodexActivity {
  readonly status: "busy" | "idle" | "running";
  readonly at: number | null;
}

/** Lifecycle evidence only: messages and token counts do not imply working or idle. */
export function parseCodexActivity(input: string): CodexActivity {
  let status: CodexActivity["status"] = "running";
  let at: number | null = null;
  let turn: string | null = null;
  const lines = input.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = record(JSON.parse(line));
    } catch {
      // A partially written final event may supersede the last observed state.
      if (index === lines.length - 1) return { status: "running", at: null };
      continue;
    }
    if (entry.type !== "event_msg") continue;
    const payload = record(entry.payload);
    const id = text(payload.turn_id) || null;
    if (payload.type === "task_started") {
      status = "busy";
      turn = id;
      at = timestamp(entry.timestamp) || null;
    } else if (payload.type === "task_complete" || payload.type === "turn_aborted") {
      // A delayed completion for an older turn must not mark a newer turn idle.
      if (turn !== null && id !== turn) continue;
      status = "idle";
      turn = null;
      at = timestamp(entry.timestamp) || null;
    }
  }
  return { status, at };
}

interface ActivityCursor {
  size: number;
  mtime: number;
  carry: string;
  skipping: boolean;
  lost: boolean;
  events: string[];
}

const cursors = new Map<string, ActivityCursor>();
const pending = new Map<string, Promise<CodexActivity>>();
const UNKNOWN: CodexActivity = { status: "running", at: null };

/** Retain lifecycle metadata only, never conversation bodies, in the activity cache. */
function consumeLine(cursor: ActivityCursor, line: string): void {
  if (!line.includes('"task_started"') && !line.includes('"task_complete"') && !line.includes('"turn_aborted"')) return;
  let entry: Record<string, unknown>;
  try {
    entry = record(JSON.parse(line));
  } catch {
    cursor.lost = true;
    return;
  }
  const payload = record(entry.payload);
  if (entry.type !== "event_msg" || !["task_started", "task_complete", "turn_aborted"].includes(text(payload.type)))
    return;
  if (cursor.lost) cursor.events = [];
  cursor.lost = false;
  cursor.events.push(
    JSON.stringify({
      type: "event_msg",
      timestamp: entry.timestamp,
      payload: { type: payload.type, turn_id: payload.turn_id },
    }),
  );
  if (cursor.events.length > 128) cursor.events.shift();
}

async function updateActivity(path: string): Promise<CodexActivity> {
  const info = await stat(path);
  // Bound the initial work on pathological logs. A tail can still establish a recent lifecycle.
  if (info.size > 64 * 1024 * 1024) return parseCodexActivity(await readTail(path, 768 * 1024));
  let cursor = cursors.get(path);
  if (!cursor || info.size < cursor.size || (info.size === cursor.size && info.mtimeMs !== cursor.mtime)) {
    cursor = { size: 0, mtime: 0, carry: "", skipping: false, lost: false, events: [] };
  }
  if (info.size > cursor.size) {
    // Copy before mutation so an interrupted read does not commit a partial cursor.
    cursor = { ...cursor, events: [...cursor.events] };
    const stream = createReadStream(path, {
      start: cursor.size,
      end: info.size - 1,
      encoding: "utf8",
      highWaterMark: 256 * 1024,
    });
    try {
      for await (const chunk of stream) {
        const parts = (chunk as string).split("\n");
        for (let index = 0; index < parts.length; index++) {
          const part = parts[index];
          if (!cursor.skipping) {
            if (cursor.carry.length + part.length <= 2 * 1024 * 1024) cursor.carry += part;
            else {
              cursor.carry = "";
              cursor.skipping = true;
              cursor.lost = true;
            }
          }
          if (index < parts.length - 1) {
            if (!cursor.skipping) consumeLine(cursor, cursor.carry);
            cursor.carry = "";
            cursor.skipping = false;
          }
        }
      }
    } finally {
      stream.destroy();
    }
    cursor.size = info.size;
    cursor.mtime = info.mtimeMs;
  }
  if (cursors.size >= 500 && !cursors.has(path)) cursors.delete(cursors.keys().next().value!);
  cursors.set(path, cursor);
  if (cursor.skipping || cursor.lost) return UNKNOWN;
  // A non-newline-terminated final record may still be a complete JSON object.
  const tail = cursor.carry.trim();
  if (tail) {
    try {
      JSON.parse(tail);
    } catch {
      return UNKNOWN;
    }
  }
  return parseCodexActivity(cursor.events.join("\n") + "\n" + tail);
}

export async function readCodexActivity(path: string): Promise<CodexActivity> {
  const existing = pending.get(path);
  if (existing) return existing;
  const task = updateActivity(path);
  pending.set(path, task);
  try {
    return await task;
  } finally {
    pending.delete(path);
  }
}
