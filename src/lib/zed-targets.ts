import { basename, normalize } from "node:path";

export interface ZedWorkspace {
  readonly windowId: number;
  readonly paths: readonly string[];
}

export type ZedSnapshot =
  | { readonly kind: "available"; readonly workspaces: readonly ZedWorkspace[] }
  | { readonly kind: "unavailable"; readonly reason: string };

export type ZedTarget =
  | { readonly kind: "matched"; readonly title: string }
  | { readonly kind: "missing" }
  | {
      readonly kind: "ambiguous";
      readonly titles: readonly string[];
      readonly reason: string;
    }
  | { readonly kind: "unknown"; readonly reason: string };

/** Zed's legacy comma-separated roots cannot represent comma-containing paths unambiguously. */
export function parseWorkspacePaths(value: unknown): string[] | null {
  if (typeof value !== "string" || !value.trim()) return [];
  if (value.startsWith("[")) {
    try {
      const paths: unknown = JSON.parse(value);
      return Array.isArray(paths) &&
        paths.every((path) => typeof path === "string" && path.startsWith("/") && !path.includes("\0"))
        ? paths.map((path: string) => normalize(path))
        : null;
    } catch {
      return null;
    }
  }
  if (!value.startsWith("/") || /[,\n\r\0]/.test(value)) return null;
  return [normalize(value)];
}

export function containsProject(cwd: string, project: string): boolean {
  return cwd === project || cwd.startsWith(project.endsWith("/") ? project : `${project}/`);
}

export function windowRoots(title: string): string[] {
  return title
    .split(" — ")[0]
    .split(", ")
    .map((root) => root.trim())
    .filter(Boolean);
}

/** A title alone is never enough to identify a Zed project; require DB path corroboration. */
export function resolveZedTarget(cwd: string, titles: readonly string[], snapshot: ZedSnapshot): ZedTarget {
  if (!cwd.startsWith("/"))
    return {
      kind: "unknown",
      reason: "Session has no absolute project directory",
    };
  if (snapshot.kind === "unavailable") return { kind: "unknown", reason: snapshot.reason };
  const directory = normalize(cwd);
  const candidates = snapshot.workspaces.filter((workspace) =>
    workspace.paths.some((path) => containsProject(directory, path)),
  );
  if (!candidates.length) {
    // A matching name without a full path is inconclusive, not proof the project is closed.
    return titles.some((title) => windowRoots(title).includes(basename(directory)))
      ? {
          kind: "unknown",
          reason: "A window has this folder name, but its full path could not be confirmed",
        }
      : { kind: "missing" };
  }
  const paths = new Set(
    candidates.flatMap((workspace) => workspace.paths.filter((path) => containsProject(directory, path))),
  );
  const names = new Set([...paths].map((path) => basename(path)));
  const matching = titles.filter((title) => windowRoots(title).some((name) => names.has(name)));
  const conflicting = snapshot.workspaces.some((workspace) =>
    workspace.paths.some((path) => names.has(basename(path)) && !paths.has(path)),
  );
  const windows = new Set(candidates.map((workspace) => workspace.windowId));
  if (conflicting || matching.length > 1 || windows.size > 1) {
    return {
      kind: "ambiguous",
      titles: matching,
      reason: "Several Zed projects or windows match; choose a window explicitly",
    };
  }
  if (matching.length !== 1)
    return {
      kind: "unknown",
      reason: "Project is recorded in Zed, but no unique visible window could be confirmed",
    };
  return { kind: "matched", title: matching[0] };
}
