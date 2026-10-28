import { isAbsolute } from "node:path";
import { shellQuote } from "./quote";
import { ProviderId, SESSION_ID } from "./session-types";

export interface ResumeSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export function buildResumeSpec(provider: ProviderId, executable: string, cwd: string, id: string): ResumeSpec {
  if (!SESSION_ID.test(id)) throw new Error("Invalid session ID; expected a UUID");
  if (!isAbsolute(executable) || executable.includes("\0")) throw new Error("CLI must be an absolute executable path");
  if (!isAbsolute(cwd) || cwd.includes("\0")) throw new Error("Session has no absolute working directory");
  return {
    executable,
    cwd,
    args: [provider === "codex" ? "resume" : "--resume", id],
  };
}

export function formatResumeCommand(spec: ResumeSpec): string {
  return `cd ${shellQuote(spec.cwd)} && ${[spec.executable, ...spec.args].map(shellQuote).join(" ")}`;
}
