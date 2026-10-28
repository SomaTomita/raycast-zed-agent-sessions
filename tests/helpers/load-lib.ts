import { resolve } from "node:path";

type Loader = (this: unknown, request: string, parent: NodeModule | null, isMain: boolean) => unknown;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const moduleInternals = require("node:module") as { _load: Loader };

/** Replacements keyed by the exact specifier the module under test passes to `require`. */
export type Mocks = Readonly<Record<string, unknown>>;

/**
 * Loads `src/<path>` (for example `lib/goto`) fresh with some of its direct imports replaced.
 *
 * `@raycast/api` and `@raycast/utils` cannot load outside Raycast, so modules that touch them
 * are tested by handing them fakes. Only requests made by the module itself are replaced;
 * everything else, including its other imports, loads for real. The module is not left in the
 * require cache, so the next call starts clean.
 */
export function loadModule<T>(path: string, mocks: Mocks): T {
  const file = resolve(__dirname, "../../src", `${path}.js`);
  const original = moduleInternals._load;
  moduleInternals._load = function (this: unknown, request, parent, isMain) {
    if (parent?.filename === file && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return original.call(this, request, parent, isMain);
  };
  delete require.cache[file];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(file) as T;
  } finally {
    moduleInternals._load = original;
    delete require.cache[file];
  }
}

/** Shorthand for a module under `src/lib`. */
export function loadLib<T>(name: string, mocks: Mocks): T {
  return loadModule<T>(`lib/${name}`, mocks);
}
