import { run } from "./run";

/** `ps -o etime=` prints `[[dd-]hh:]mm:ss`, and unlike `lstart` it is free of locale and timezone. */
const ELAPSED = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/;

/**
 * How far a process may start from the `startedAt` its session file records.
 * Claude Code writes `startedAt` a few seconds into its boot and `etime` has one second of
 * granularity, so the window only has to be tight enough to catch a reused pid.
 */
const START_TOLERANCE_MS = 180_000;

export function parseElapsedSeconds(etime: string): number | null {
  const match = ELAPSED.exec(etime.trim());
  if (match === null) {
    return null;
  }
  const [, days, hours, minutes, seconds] = match;
  return Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

/** Seconds each running process has been alive, or an empty map when `ps` fails. */
export async function readProcessAges(): Promise<Map<number, number>> {
  const ages = new Map<number, number>();
  let stdout: string;
  try {
    stdout = await run("/bin/ps", ["-axo", "pid=,etime="]);
  } catch {
    return ages;
  }
  for (const line of stdout.split("\n")) {
    const [pidText, etime] = line.trim().split(/\s+/);
    const pid = Number.parseInt(pidText ?? "", 10);
    const seconds = parseElapsedSeconds(etime ?? "");
    if (Number.isInteger(pid) && seconds !== null) {
      ages.set(pid, seconds);
    }
  }
  return ages;
}

/**
 * Whether the process now holding a pid is the one that wrote the session file. A crashed session
 * leaves its file behind, and the pid may later belong to an unrelated process. When either side is
 * unknown the session is kept: hiding a real session is worse than showing a stale one.
 */
export function isSameProcess(startedAt: number | null, ageSeconds: number | undefined, now: number): boolean {
  if (startedAt === null || ageSeconds === undefined) {
    return true;
  }
  return Math.abs(now - ageSeconds * 1000 - startedAt) <= START_TOLERANCE_MS;
}
