import { resolveBinary } from "./binary";
import { run } from "./run";

async function resolveClaudeBinary(preferred?: string): Promise<string> {
  return resolveBinary("claude", preferred);
}

export async function execClaude(args: readonly string[], preferredBinary?: string): Promise<string> {
  return run(await resolveClaudeBinary(preferredBinary), args);
}
