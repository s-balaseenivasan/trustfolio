/**
 * QA test harness — NOT application source.
 *
 * `src/lib/rate-limit.ts`, `src/auth.ts`, `src/lib/storage.ts` and the server-layer modules under
 * `src/server/**` all start with `import "server-only"`, which throws unconditionally unless the
 * importer resolved it under React's "react-server" condition (the condition Next's own bundler
 * sets when it compiles a Server Component — something that only exists inside Next's build/dev
 * pipeline, not in a plain `tsx` process).
 *
 * This harness neutralizes that guard for QA test runs only, the same way a test double replaces a
 * real dependency: it does not touch `node_modules/server-only` on disk, and it never ships with
 * or alters application source. It must be loaded with `--require` (so it patches
 * `Module._load` before anything else runs) alongside `tsx`'s CJS register:
 *
 *   node --require ./node_modules/tsx/dist/cjs/index.cjs \
 *        --require ./qa/tests/_harness/server-only-stub.cjs \
 *        ./qa/tests/<suite>.test.ts
 *
 * Tried and rejected before landing on this approach (kept here so the next run does not repeat
 * the dead ends):
 *   - `--conditions=react-server`: bypasses the guard too, but then `next`/`react` resolve to their
 *     real react-server builds, which assume Next's own RSC bundler runtime and crash elsewhere
 *     (`react.createContext` missing) when loaded directly by Node.
 *   - `next dev -p 3100`: blocked in this environment — Next's dev server keys its "another dev
 *     server is already running" lock off the project directory, not the port, and the developer's
 *     own `next dev` on :3000 already holds it for this repo.
 *   - Dynamic `import()` of a local `.ts` file: tsx's ESM loader for local TypeScript does not route
 *     through `Module._load`, so this stub (and `--conditions`) has no effect on it. Only
 *     `require()` of local `.ts` files (via tsx's CJS register) is interceptable this way — which is
 *     why every QA harness file in this directory uses `require`, not `import`.
 */
const Module = require("module");
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.apply(this, arguments);
};
