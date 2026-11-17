# Authentication — login lockout (dual rate limiter)

Module: Authentication. Workflow: `workflow.admin.login` (WF1). Covers the second,
account-keyed login rate limiter added at `src/auth.ts:19-20` (`LOGIN_ACCOUNT_RATE_LIMIT`)
alongside the pre-existing per-(IP,email) limiter, and the atomicity of
`src/lib/rate-limit.ts`'s upsert. Executed directly against the live QA Postgres database and the
REAL `signIn()` → `authorize()` path — see
`qa/tests/security/login-lockout.test.ts` header comment for how a Next.js request scope was
constructed outside a running server, and `qa/reports/test-execution.md` for the full run log.

All ten assertions below ran in a single process invocation; test file: `qa/tests/security/login-lockout.test.ts`.

---

```
ID:           TC-AUTH-LOCKOUT-001
Title:        Per-(IP,email) limiter blocks the 6th attempt from the same IP, even with the correct password
Workflow:     workflow.admin.login
Requirement:  REQ-SEC-030 (sign-in is rate limited) — the dual-limiter design itself is DERIVED-FROM-CODE (no
              requirement document states two independent limiters; see finding QA-TEST-AUTH-101)
Type:         security
Priority:     critical
Role:         anonymous (pre-authentication)
Preconditions: Fresh disposable test user (qa-lockout-a-<suffix>@example.test); RateLimit rows for the
              keys under test reset to empty before the run.
Steps:        1. From IP 198.51.100.10, call signIn("credentials") with the wrong password 5 times for the
                 same email.
              2. Read the RateLimit rows for login:hash(ip:email) and login:account:hash(email) directly.
              3. From the SAME IP, call signIn() a 6th time with the CORRECT password.
Test data:    qa/tests/security/login-lockout.test.ts (userA fixture; synthetic IPs 198.51.100.10/.11)
Expected:     After 5 attempts, both RateLimit rows read count=5. The 6th attempt (correct password, same
              IP) still throws CredentialsSignin — only explicable by the (ip,email) limiter now reading
              6 > limit 5, since the password is correct.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/login-lockout.log
```

```
ID:           TC-AUTH-LOCKOUT-001b
Title:        The per-account limiter keeps counting independently through the IP+email trip, without itself tripping
Workflow:     workflow.admin.login
Requirement:  DERIVED-FROM-CODE (src/auth.ts:19-20, :37-41)
Type:         security
Priority:     high
Role:         anonymous
Preconditions: Same run as TC-AUTH-LOCKOUT-001, immediately after it.
Steps:        1. After the 6 attempts in TC-AUTH-LOCKOUT-001, read the account-keyed RateLimit row.
Test data:    qa/tests/security/login-lockout.test.ts
Expected:     Account row reads count=6 (6 <= limit 20 — not yet tripped), proving the two limiters
              increment independently from the same stream of attempts.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/login-lockout.log
```

```
ID:           TC-AUTH-LOCKOUT-002
Title:        A fresh IP for the same account gets its own (ip,email) budget and the correct-password login succeeds
Workflow:     workflow.admin.login
Requirement:  REQ-SEC-030
Type:         security
Priority:     high
Role:         anonymous
Preconditions: userA's (ip=198.51.100.10,email) pair is tripped from TC-AUTH-LOCKOUT-001; account row at count=6/20.
Steps:        1. From a NEW IP (198.51.100.11), call signIn() with the correct password.
Test data:    qa/tests/security/login-lockout.test.ts
Expected:     signIn() succeeds (no throw) — the (ip,email) limiter is scoped per pair, so the new IP is
              unaffected by the other IP's trip, and the account limiter (6/20) has room.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/login-lockout.log
```

```
ID:           TC-AUTH-LOCKOUT-003
Title:        A successful login clears BOTH rate-limit keys, not just the per-IP one (regression guard)
Workflow:     workflow.admin.login
Requirement:  DERIVED-FROM-CODE (src/auth.ts:47-52) — regression guard for QA-REG-001, which described an
              earlier version that reset only the IP key
Type:         security
Priority:     critical
Role:         anonymous
Preconditions: Successful login just completed in TC-AUTH-LOCKOUT-002.
Steps:        1. Read the RateLimit rows for login:hash(ip:email) and login:account:hash(email) for the IP/
                 email pair that just succeeded.
Test data:    qa/tests/security/login-lockout.test.ts
Expected:     Both rows are null (deleted). If only the IP row were cleared, the account row would still
              read a nonzero count — this is exactly the regression QA-REG-001 raised concern about.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/login-lockout.log
```

```
ID:           TC-AUTH-LOCKOUT-004a
Title:        After 20 failed attempts from 20 distinct IPs, the account counter reads 20 and has not yet tripped
Workflow:     workflow.admin.login
Requirement:  DERIVED-FROM-CODE (src/auth.ts:20, 37-41)
Type:         security
Priority:     high
Role:         anonymous
Preconditions: Fresh disposable test user (qa-lockout-b-<suffix>@example.test); account/ip keys reset.
Steps:        1. From 20 distinct synthetic IPs (198.51.100.30-.49), call signIn() once each with a wrong
                 password for the same email.
Test data:    qa/tests/security/login-lockout.test.ts
Expected:     Account RateLimit row reads count=20 (20 <= limit 20 — rateLimit() returns success=true at
              exactly the limit; the limiter trips on attempt 21, not 20).
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/login-lockout.log
```

```
ID:           TC-AUTH-LOCKOUT-004b
Title:        The 21st attempt, from a never-used IP, with the CORRECT password, is still refused
Workflow:     workflow.admin.login
Requirement:  REQ-SEC-030; this specific "21st attempt from a fresh IP" scenario is DERIVED-FROM-CODE
Type:         security
Priority:     critical
Role:         anonymous
Preconditions: Account counter at 20 from TC-AUTH-LOCKOUT-004a.
Steps:        1. From a brand-new IP (198.51.100.201, never used by this account before), call signIn()
                 with the CORRECT password.
Test data:    qa/tests/security/login-lockout.test.ts
Expected:     signIn() throws CredentialsSignin despite the correct password and a fresh (ip,email) pair —
              the only explanation is the account limiter (21 > 20).
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/login-lockout.log
```

```
ID:           TC-AUTH-LOCKOUT-004c
Title:        The fresh IP's own (ip,email) counter is nowhere near its own limit — isolates the cause to the account limiter
Workflow:     workflow.admin.login
Requirement:  DERIVED-FROM-CODE
Type:         security
Priority:     medium
Role:         anonymous
Preconditions: Same run as TC-AUTH-LOCKOUT-004b.
Steps:        1. Read the RateLimit row for login:hash(freshIp:email).
Test data:    qa/tests/security/login-lockout.test.ts
Expected:     Row reads count=1 (1 <= limit 5) — confirms the block in 004b cannot be attributed to the
              (ip,email) limiter.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/login-lockout.log
```

```
ID:           TC-AUTH-LOCKOUT-005
Title:        rateLimit()'s single-statement upsert is atomic under concurrent calls
Workflow:     workflow.admin.login
Requirement:  DERIVED-FROM-CODE (src/lib/rate-limit.ts:12-15 doc comment claims atomicity)
Type:         security
Priority:     high
Role:         n/a (infrastructure)
Preconditions: Fresh RateLimit key, limit=10.
Steps:        1. Fire 30 concurrent rateLimit() calls on the same fresh key.
              2. Count how many report success=true.
              3. Read the row's final count.
Test data:    qa/tests/security/login-lockout.test.ts (key qa:concurrency:<suffix>)
Expected:     Exactly 10 calls report success=true (the limit), and the row's final count is exactly 30 —
              no lost updates from a read-then-write race, confirming the single `INSERT ... ON CONFLICT
              DO UPDATE` statement serializes correctly under Postgres's own row-level locking.
Status:       EXECUTED-PASS
Evidence:     qa/reports/evidence/run-qa-20261116/login-lockout.log
```

## Scope note — what this module does NOT cover

The Credentials provider's `authorize()` closure is not exported by `src/auth.ts`, so it cannot be
called directly; it is only reachable through NextAuth's own `signIn()`. `signIn()` calls
`next/headers` internally, which throws outside a real Next.js request. Every test above drives the
REAL `signIn()` → `authorize()` path by constructing the same AsyncLocalStorage request-scope
Next's own server installs per request (see `qa/tests/_harness/next-request-scope.cjs`), so no
business logic here is reimplemented — the only thing not exercised is the browser-facing login
form and the `safeCallback()` open-redirect guard in `src/server/actions/auth.ts`, which is UI-level
and out of scope for this pass.
