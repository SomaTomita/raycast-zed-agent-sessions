import { readRecentMessages, TranscriptMessage } from "./messages";
import { parseCodexMessages } from "./codex-records";
import { safeRolloutPath } from "./providers/codex";
import { ProviderId } from "./session-types";
import { readTail } from "./tail";

export async function readProviderMessages(
  provider: ProviderId,
  path: string,
  limit: number,
): Promise<TranscriptMessage[]> {
  if (!path) return [];
  if (provider === "claude") return readRecentMessages(path, limit);
  const safe = await safeRolloutPath(path);
  if (!safe) return [];
  try {
    return parseCodexMessages(await readTail(safe, 768 * 1024), limit);
  } catch {
    return [];
  }
}
