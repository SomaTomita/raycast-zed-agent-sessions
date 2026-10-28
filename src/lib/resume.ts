import { stat } from "node:fs/promises";
import { runAppleScript } from "@raycast/utils";
import { appleQuote } from "./quote";
import { resolveBinary } from "./binary";
import { buildResumeSpec, formatResumeCommand } from "./resume-spec";
import { ProviderId } from "./session-types";

export type TerminalApp = "Terminal" | "iTerm";
export interface ResumeTarget {
  readonly provider: ProviderId;
  readonly sessionId: string;
  readonly cwd: string;
}

export async function resumeCommand(target: ResumeTarget, preferred?: string): Promise<string> {
  if (!(await stat(target.cwd)).isDirectory()) throw new Error("Project directory no longer exists");
  const executable = await resolveBinary(target.provider, preferred);
  return formatResumeCommand(buildResumeSpec(target.provider, executable, target.cwd, target.sessionId));
}

export async function resumeInTerminal(options: {
  readonly terminal: TerminalApp;
  readonly target: ResumeTarget;
  readonly preferred?: string;
}): Promise<void> {
  const command = await resumeCommand(options.target, options.preferred);
  if (options.terminal === "iTerm") {
    await runAppleScript(`tell application "iTerm"
      activate
      set w to (create window with default profile)
      tell current session of w to write text ${appleQuote(command)}
    end tell`);
  } else {
    await runAppleScript(`tell application "Terminal"
      activate
      do script ${appleQuote(command)}
    end tell`);
  }
}
