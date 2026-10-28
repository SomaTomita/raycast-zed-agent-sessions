import { execFile } from "node:child_process";
import { resolve } from "node:path";

type Loader = (this: unknown, request: string, parent: NodeModule | null, isMain: boolean) => unknown;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const moduleInternals = require("node:module") as { _load: Loader };

/** Runs AppleScript the way `runAppleScript` from `@raycast/utils` does. */
export function osascript(script: string): Promise<string> {
  return new Promise((done, fail) => {
    const child = execFile("/usr/bin/osascript", ["-"], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) =>
      error ? fail(new Error(stderr || error.message)) : done(stdout.trim()),
    );
    child.stdin?.end(script);
  });
}

/**
 * Production modules import `runAppleScript` from `@raycast/utils`, which only loads inside Raycast.
 * Outside it, that one import is answered with the same `osascript` call; everything else is real.
 */
export function installRaycastShim(): void {
  const original = moduleInternals._load;
  moduleInternals._load = function (this: unknown, request, parent, isMain) {
    if (request === "@raycast/utils") return { runAppleScript: osascript };
    return original.call(this, request, parent, isMain);
  };
}

/** Loads a compiled production module from `src/lib`. Call after `installRaycastShim`. */
export function lib<T>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(resolve(__dirname, "../../src/lib", `${name}.js`)) as T;
}

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Polls until `check` returns something truthy, or gives up after `ms`. */
export async function until<T>(check: () => Promise<T | null | false>, ms = 20_000, step = 500): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(step);
  }
  return null;
}

export interface Report {
  readonly check: (name: string, ok: boolean, detail?: string) => void;
  readonly note: (message: string) => void;
  readonly summary: () => { readonly passed: number; readonly failed: number };
}

export function report(): Report {
  const results: boolean[] = [];
  return {
    check(name, ok, detail = "") {
      results.push(ok);
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -> ${detail}` : ""}`);
    },
    note: (message) => console.log(message),
    summary: () => ({ passed: results.filter(Boolean).length, failed: results.filter((ok) => !ok).length }),
  };
}
