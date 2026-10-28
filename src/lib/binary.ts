import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { ProviderId } from "./session-types";

/** Resolve executables without running a login shell, aliases, or user startup files. */
export async function resolveBinary(provider: ProviderId, preferred: string = provider): Promise<string> {
  const value = preferred.trim() || provider;
  const expanded = value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  if (value !== provider && !isAbsolute(expanded)) {
    throw new Error(`Set ${provider} CLI to an absolute executable path, not a shell command or function`);
  }
  const candidates = isAbsolute(expanded)
    ? [expanded]
    : [
        join(homedir(), ".local/bin", provider),
        `/opt/homebrew/bin/${provider}`,
        `/usr/local/bin/${provider}`,
        join(homedir(), ".bun/bin", provider),
        ...(provider === "claude" ? [join(homedir(), ".claude/local/claude")] : []),
        ...(process.env.PATH ?? "")
          .split(":")
          .filter(isAbsolute)
          .map((dir) => join(dir, provider)),
      ];
  for (const candidate of candidates) {
    try {
      // The link is checked through to its target but returned as found. Installers point
      // `~/.local/bin/claude` at a versioned file and delete old versions on update, so a command
      // that pinned the target would stop working after the next upgrade.
      const path = await realpath(candidate);
      if (!(await stat(path)).isFile()) continue;
      await access(path, constants.X_OK);
      return candidate;
    } catch {
      // Explicit paths never silently select another binary.
    }
  }
  throw new Error(`${provider} CLI not found. Set its absolute executable path in extension preferences`);
}
