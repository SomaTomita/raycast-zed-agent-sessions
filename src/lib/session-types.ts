export type ProviderId = "claude" | "codex";

export function providerLabel(provider: ProviderId): string {
  return provider === "codex" ? "Codex" : "Claude Code";
}

export function sessionKey(provider: ProviderId, id: string): string {
  return `${provider}:${id}`;
}

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
