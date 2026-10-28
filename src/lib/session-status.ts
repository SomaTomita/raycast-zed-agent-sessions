import type { SessionItem } from "./sessions";
import { resolveZedTarget, ZedSnapshot } from "./zed-targets";

export type ProcessState = "open" | "closed" | "unknown";
export type Presence = "open" | "closed" | "unknown";
export type StatusFilter = "all" | "open" | "closed" | "working" | "idle" | "zed" | "unknown";
export const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All Statuses",
  open: "Running Sessions",
  closed: "Confirmed Stopped",
  working: "Working",
  idle: "Idle",
  zed: "Project Open in Zed",
  unknown: "Runtime Unverified",
};

export function processState(item: Pick<SessionItem, "live" | "state">): ProcessState {
  if (item.live !== null) return "open";
  return item.state === "closed" ? "closed" : "unknown";
}

export function zedPresence(cwd: string, titles: readonly string[], snapshot: ZedSnapshot): Presence {
  const target = resolveZedTarget(cwd, titles, snapshot);
  return target.kind === "matched" ? "open" : target.kind === "missing" ? "closed" : "unknown";
}

export function matchesStatus(item: SessionItem, filter: StatusFilter, zed: Presence): boolean {
  if (filter === "all") return true;
  if (filter === "working") return item.live !== null && item.state === "working";
  if (filter === "idle") return item.live !== null && item.state === "waiting";
  if (filter === "zed") return zed === "open";
  return processState(item) === filter;
}
