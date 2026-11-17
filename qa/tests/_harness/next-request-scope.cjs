/**
 * QA test harness — NOT application source.
 *
 * Lets a plain `tsx`/Node process call real Next.js server-only APIs (`next/headers`, and by
 * extension anything built on it, like `src/lib/rate-limit.ts:getClientIp()` and NextAuth's
 * `signIn()`) by constructing the same AsyncLocalStorage "request store" / "work store" pair that
 * Next's own server installs per request. This is the piece that let this QA run drive the REAL
 * `signIn("credentials", …)` → `authorize()` path end-to-end against the live QA database, instead
 * of stopping at a reimplementation.
 *
 * Internals used here (`next/dist/server/app-render/work-async-storage.external`,
 * `.../work-unit-async-storage.external`, `next/dist/server/async-storage/request-store`) are
 * undocumented Next.js internals, not a public API. They are read, not modified — nothing here
 * patches Next's source. Pin this file to the installed Next version (16.4.6) and re-verify after
 * any Next upgrade; a breaking internal rename will surface as an import error, not a silent
 * false-pass, since the harness throws if the module shape changes.
 *
 * Must be `require()`d (not imported) after `server-only-stub.cjs`, in a process started with
 * `node --require ./node_modules/tsx/dist/cjs/index.cjs --require ./qa/tests/_harness/server-only-stub.cjs`.
 */

// Next's own AsyncLocalStorage wrapper (src/server/app-render/async-local-storage.js) falls back to
// a `FakeAsyncLocalStorage` that throws on `.run()` unless `globalThis.AsyncLocalStorage` is set.
// Next's real server bootstrap sets this before any request is handled; a bare `tsx` process never
// does, so this harness sets it the same way.
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = require("node:async_hooks").AsyncLocalStorage;
}

const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external");
const { workUnitAsyncStorage } = require("next/dist/server/app-render/work-unit-async-storage.external");
const { createRequestStoreForAPI } = require("next/dist/server/async-storage/request-store");

/** Minimal WorkStore — only the fields `next/headers`' `headers()` and NextAuth's `signIn()` touch in this flow. */
function makeWorkStore(route) {
  return {
    page: route,
    route,
    cacheLifeProfiles: {},
    useCacheTimeout: 0,
    durableUseCacheEntries: false,
    staticPageGenerationTimeout: 0,
    afterContext: { waitUntil: () => {}, after: () => {} },
    previouslyRevalidatedTags: [],
    requestStartTime: Date.now(),
    refreshTagsByCacheKind: new Map(),
    shouldTrackFetchMetrics: false,
    clientComponentLoadTracker: undefined,
    deploymentId: "qa-test-harness",
    buildId: "qa-test-harness",
    cacheComponentsEnabled: false,
    validationLevel: "none",
    runInCleanSnapshot: (fn, ...args) => fn(...args),
    reactServerErrorsByDigest: new Map(),
  };
}

/** Builds a type:'request' work-unit store carrying the given synthetic client IP. */
function makeRequestStore(ip, host) {
  const req = { headers: { host, "x-forwarded-for": ip } };
  const url = new URL(`http://${host}/api/auth/callback/credentials`);
  return createRequestStoreForAPI(req, url, [], undefined, undefined, undefined);
}

/**
 * Runs `fn` inside a synthetic Next.js request scope as if a request arrived from `ip`.
 * This is what makes `headers()` (and therefore `getClientIp()` and NextAuth's internals)
 * resolve instead of throwing "called outside a request scope".
 */
function withRequestScope(ip, fn, { route = "/api/auth/[...nextauth]", host = "127.0.0.1:3100" } = {}) {
  return workAsyncStorage.run(makeWorkStore(route), () =>
    workUnitAsyncStorage.run(makeRequestStore(ip, host), fn),
  );
}

module.exports = { withRequestScope };
