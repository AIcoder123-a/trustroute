# AGENTS.md

Operating notes for anyone (human or agent) continuing this project. Read this before changing code.

## 1. What this project is

TrustRoute — an AI Agent Security Gateway built for the Clocked Build Challenge 2026. It screens
untrusted content (support tickets, retrieved pages, tool output, scripts) with three Clocked
endpoints — **Guard** (`/injection`), **Protect** (`/pii`), **Inspect** (`/script`) — masks what must
not travel, and returns a deterministic **PASS / REVIEW / BLOCK** decision with reviewable evidence.

The product is a checkpoint, not an agent. It never executes anything.

## 2. Directory map

```
app/
  layout.tsx            root layout, light theme, translate protection, metadata
  page.tsx              server component: resolves live/mock mode, renders the workbench
  api/analyze/route.ts  POST — the only way content reaches Clocked
  api/review/route.ts   POST — records a human decision (in memory)
  api/status/route.ts   GET  — reports mode + limits, never the key
  api/audit/route.ts    GET  — last 10 content-free audit records (session trail)
components/             UI (client components); Workbench.tsx orchestrates
  Workbench.tsx         two levels: Intake (no result) and Results (result); owns all request state
  CasePicker.tsx        three demo cases on the first screen, the rest behind "More examples"; content-type tabs
  ContentView.tsx       the dark reader: source with highlights, forwarded copy, mask map
  EvidencePanel.tsx     passage-level evidence for Guard + Inspect, click to locate in the source
  DecisionPanel.tsx     ResultSummary (the band), InsightRail (why / next / checkpoint), DecisionPrimer
  stages.tsx            the three detections as expandable rows; a failed row cannot be collapsed
  SessionTrail.tsx      content-free run history
lib/
  clocked/              transport adapters
    live.ts             real SDK calls, error taxonomy
    mock.ts             labelled heuristic simulator (NOT Clocked)
    normalize.ts        defensive response parsing
    index.ts            stage runner, latency, skipping
  policy.ts             deterministic decision engine (pure) + the rule trace it reports
  redact.ts             builds the masked copy from Protect spans (pure)
  evidence.ts           one row per detector finding, with line numbers (pure)
  review.ts             review-note contract shared by the UI and the route (pure)
  highlight.ts          source-view segments (pure)
  pipeline.ts           detect → mask → decide, plus audit
  cases.ts              8 synthetic demo cases + per-type deployment policy
  report.ts             export/report builder (pure)
  audit.ts              in-memory, content-free audit + review events
  config.ts             server-only config, limits, thresholds
  validate.ts           request validation
  ratelimit.ts          per-caller fixed window + caller identity (TRUST_PROXY decides trust)
  admission.ts          window → concurrency → daily quota, in that order
  quota.ts              daily ceiling: memory, or one atomic Redis EVAL when configured; fail-closed
  turnstile.ts          server-side human-check verification + single-use token claims
  redis-rest.ts         minimal REST client for a Redis-compatible endpoint (Upstash shape)
  body.ts               bounded request-body reader: 512 KB ceiling, stream cancelled at the limit
tests/                  vitest unit + integration
tests/fixtures/         verbatim real responses recorded 2026-10-30 (synthetic samples only)
e2e/                    playwright, desktop + mobile
docs/                   rules, API research, architecture, test report, submission drafts
scripts/live-acceptance.mjs  server-side acceptance: three real SDK calls, recorded with status, shape, verdict and source
scripts/live-verify.mjs  the same three calls through Chromium; verification harness, never imported by app/
scripts/collect-diagnostics.mjs  credential-free edge diagnostics for a provider escalation (output in .local/)
scripts/deploy-preflight.mjs     audits the environment a host will run with; exit 1 if it must not ship
.github/workflows/live-check.yml  manual-trigger run of verify:live on a GitHub runner, to test a cloud egress
```

## 3. Hard rules (do not break)

1. **`CLOCKED_API_KEY` never leaves the server.** No `NEXT_PUBLIC_` variable, no client component
   import of `lib/config.ts` (it throws if `window` exists), no key in a payload, a log, an export or a
   screenshot.
2. **Never present mock output as Clocked output.** Every stage carries `mode`. The UI shows a banner
   and per-stage badges. `CLOCKED_MODE=live` throws without a key rather than falling back.
3. **A failed detection can never produce PASS.** `tests/policy.test.ts` enforces this. If you add a
   stage, add the same guarantee.
4. **Never forward the original when masking failed.** `redaction.maskedText === null` with findings
   present forces REVIEW.
5. **Do not execute, eval, or shell out to any inspected script.** Inspect is static analysis only.
6. **Demo data stays synthetic.** `example.com` / `example.net` / 555 phone ranges only. No real
   person's data, ever, in cases, fixtures, tests, screenshots or docs.
7. **No API key, token, account name or private conversation in this repository.** Not in docs, not in
   commit messages. Vendor correspondence and diagnostics live in `.local/` and are git-ignored. `tests/fixtures/` holds real API responses: they must stay synthetic content, and they
   are checked for credential-shaped strings by `tests/live-contract.test.ts`.
8. **Do not push, deploy, publish or submit without the owner's explicit instruction.** This repo is
   local until the owner says otherwise.

## 4. Commands

```
npm run dev          # dev server on :3100 (owner starts and stops services manually)
npm run build        # production build; also runs type + lint checks
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (next/core-web-vitals + typescript)
npm test             # vitest: policy, redaction, highlight, report, validation, rate limit, pipeline
npm run test:e2e     # playwright desktop + mobile (starts its own server on :3100)
npm run verify       # typecheck + lint + test + build
npm run accept:check # credential preflight: source file, fingerprint, nothing sent
npm run deploy:preflight  # audits a deployment environment (secrets, public vars, ceiling); exit 1 = do not ship
npm run accept:live  # server-side acceptance: three real Clocked calls through the SDK (key from .env.local)
npm run verify:live  # alias of accept:live
npm run verify:live:browser  # the same calls through Chromium (see §6 on the edge challenge)
node scripts/collect-diagnostics.mjs  # no credential; writes .local/support/ (git-ignored)
```

Playwright downloads browsers once: `npx playwright install chromium`.

## 5. Conventions

- TypeScript strict, plus `noUncheckedIndexedAccess`. Indexed access yields `T | undefined` — handle it.
- Server-only modules are marked and guarded; do not import them from a `'use client'` file.
- Pure functions in `lib/*.ts` (policy, redact, highlight, report, validate) must stay free of I/O so
  they remain unit-testable.
- UI text is English. Reports, commit messages and code comments are English. Conversations with the
  owner are Chinese.
- Colours live in `app/globals.css` under `@theme`; do not hardcode hex values in components except for
  the few semantic tints already established (the reader's highlight marks, the legend swatches).
- Visual language: light neutral surfaces, one teal brand colour, red/amber reserved for risk, hairline
  borders, no shadows except the sticky header and the report dialog. The source/evidence reader is the
  only dark surface. `components/ui.tsx` holds the shared decision colours and the probability meter.
- A failed detection renders its consequence inline and cannot be collapsed; a skipped one reads
  "not requested" rather than borrowing the failure language.
- The first screen stays thin on purpose: one headline, one input, one primary action, three examples.
  Reference material (the outcome primer, the session trail) is collapsed or absent until it has
  something to say. `CasePicker` keeps the other five cases behind "More examples".
- Type scale lives in `app/globals.css` §`.label` (11 / 11.5 / 12.5 / 13.5 / 14.5 / 30–38). Nothing in
  prose is set below 11px; `btn-sm` grows to 36px and `btn-lg` to 44px under 640px for tap targets.
- Every Redis failure throws a `RedisCallError` with a code from the closed set in `lib/redis-rest.ts`, and
  writes exactly one `[trustroute] redis failure code=… op=… status=… ms=…` line. Nothing else goes in that
  line: no endpoint, token, command, script or caller text. Add a code rather than a free-form message.

## 6. Current state (2026-11-04)

| Area | State |
| --- | --- |
| Build, typecheck, lint | clean, 0 warnings |
| Unit/integration tests | 180 passing (23 files, incl. contract tests against recorded real responses, a policy-trace suite, a credential-hygiene suite, guards for origin/admission/HTTP limits/body bounds, and the quota, shared-window, Turnstile, caller-identity and deployment-audit suites) |
| Browser tests | 44 passing, 2 deliberate skips (23 scenarios × desktop + mobile) |
| Live Clocked detections | **verified through a browser 2026-10-30**: `/injection` 0.9957 critical, `/pii` 6 entities incl. both custom kinds, `/script` 0.9948 malicious |
| Live path from the server | **verified 2026-11-01 from a GitHub-hosted runner**: three calls through `clocked-sdk`, all `200`, no challenge, 12 credits / $0.0024 (`docs/TEST_REPORT.md` §4.4). From this machine the same client is still challenged or times out (`docs/API_INTEGRATION.md` §6.3) — the refusal is about *this path*, not about non-browser clients |
| Rate limiting | window + daily ceiling **shared in Redis when `UPSTASH_REDIS_REST_*` is set**, in process memory otherwise; concurrency stays per instance on purpose. The daily counter fails closed, the window degrades to memory (`docs/SECURITY_NOTES.md` §14). Turnstile verification implemented but **off**, because the browser widget is not shipped (`docs/RENDER.md` §5). On a serverless host the memory path counts for one invocation — shared counters are the precondition for going live |
| Deployment | **deployed on Netlify Free, phase 1 only**: simulated, no credential on the host, three browser screenings accepted by the owner on 2026-11-01 (`docs/NETLIFY.md` §9.1). Live is not enabled — it needs the Upstash pair plus the key, one redeploy, and the run sheet in §12. Render is blocked because its Blueprint flow asks for a card; `render.yaml` is kept unmodified |
| Git remote | **private GitHub** `AIcoder123-a/trustroute`, branch `master`. Actions workflow `live-check` is manual-only (`workflow_dispatch`) and has run once |

Open items and blockers are tracked in `docs/IMPLEMENTATION_PLAN.md` §6–7.

## 7. If you pick this up next

1. The field structure is recorded (`docs/API_INTEGRATION.md` §6.2, `tests/fixtures/`) and the server-side
   path is proven from a cloud egress (`docs/TEST_REPORT.md` §4.4). What remains is the deployment, and it
   is two phases, not one: create the Netlify project simulated with **no key on the host**
   (`docs/NETLIFY.md` §8), verify `/api/status` (§9), then make the counters shared before going live (§6).
   Replace nothing else — the mock stays a mock.
2. Re-run `npm run verify` and `npm run test:e2e`.
3. Only then touch `docs/SUBMISSION_DRAFT.md` with real URLs.
