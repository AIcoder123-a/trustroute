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
  layout.tsx            root layout, dark theme, metadata
  page.tsx              server component: resolves live/mock mode, renders the workbench
  api/analyze/route.ts  POST — the only way content reaches Clocked
  api/review/route.ts   POST — records a human decision (in memory)
  api/status/route.ts   GET  — reports mode + limits, never the key
  api/audit/route.ts    GET  — last 10 content-free audit records (session trail)
components/             UI (client components); Workbench.tsx orchestrates
  SessionTrail.tsx      content-free run history shown in the left rail
lib/
  clocked/              transport adapters
    live.ts             real SDK calls, error taxonomy
    mock.ts             labelled heuristic simulator (NOT Clocked)
    normalize.ts        defensive response parsing
    index.ts            stage runner, latency, skipping
  policy.ts             deterministic decision engine (pure)
  redact.ts             builds the masked copy from Protect spans (pure)
  highlight.ts          source-view segments (pure)
  pipeline.ts           detect → mask → decide, plus audit
  cases.ts              8 synthetic demo cases + per-type deployment policy
  report.ts             export/report builder (pure)
  audit.ts              in-memory, content-free audit + review events
  config.ts             server-only config, limits, thresholds
  validate.ts           request validation
  ratelimit.ts          per-IP fixed window
tests/                  vitest unit + integration
e2e/                    playwright, desktop + mobile
docs/                   rules, API research, architecture, test report, submission drafts
scripts/live-smoke.mjs  one real call per endpoint; use with a key
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
   commit messages.
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
npm run verify:live  # three real Clocked calls; needs CLOCKED_API_KEY
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
  the few semantic tints already established.

## 6. Current state (2026-10-30)

| Area | State |
| --- | --- |
| Build, typecheck, lint | clean |
| Unit/integration tests | 55 passing |
| Browser tests | 16 passing (8 tests × desktop + mobile) |
| Live Clocked calls | **none yet** — no `CLOCKED_API_KEY` in the environment |
| Deployment | not deployed |
| Git remote | none; local commits only |

Open items and blockers are tracked in `docs/IMPLEMENTATION_PLAN.md` §6–7.

## 7. If you pick this up next

1. Get `CLOCKED_API_KEY`, run `npm run verify:live`, and record the real field structure in
   `docs/API_INTEGRATION.md`. Replace nothing else — the mock stays a mock.
2. Re-run `npm run verify` and `npm run test:e2e`.
3. Only then touch `docs/SUBMISSION_DRAFT.md` with real URLs.
