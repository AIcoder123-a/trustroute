# Architecture

TrustRoute is a Next.js application with one server-side pipeline and a browser workbench. Everything
that touches a secret, a third-party API or a decision lives on the server.

```
┌──────────────────────────────── browser ────────────────────────────────┐
│  Workbench (client components)                                          │
│  ├── CaseRail / CaseStrip        eight synthetic cases, one click        │
│  ├── Input panel                 content type, textarea, limits          │
│  ├── ContentView                 as-received highlights · forwarded copy │
│  ├── Guard / Protect / Inspect   per-stage evidence, badges LIVE / MOCK  │
│  ├── DecisionPanel               decision, reasons, actions, review      │
│  └── ReportDialog                printable sheet + JSON export           │
└───────────────▲──────────────────────────────────┬──────────────────────┘
                │ AnalyzeResponse (JSON)           │ POST /api/analyze
                │                                  │ POST /api/review
┌───────────────┴──────────────────────────────────▼──────────────────────┐
│  Server (Node runtime)                                                  │
│                                                                         │
│  app/api/analyze/route.ts                                               │
│    rate limit → validate → pipeline → audit                             │
│                                                                         │
│  lib/pipeline.ts                                                        │
│    ┌──────────────┬──────────────┬──────────────┐                       │
│    │ runGuard     │ runProtect   │ runInspect   │  ← parallel           │
│    └──────┬───────┴──────┬───────┴──────┬───────┘                       │
│           │              │              │                               │
│       lib/clocked/index.ts  (mode: live | mock)                         │
│           │              │              │                               │
│     ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐                         │
│     │ live.ts   │  │ mock.ts   │  │ normalize │                         │
│     │ clocked-  │  │ heuristic │  │  .ts      │                         │
│     │ sdk       │  │ simulator │  │           │                         │
│     └─────┬─────┘  └───────────┘  └───────────┘                         │
│           │                                                            │
│           ▼   https://clocked.rezolve.ai/clocked/{injection,pii,script} │
│                                                                         │
│    buildRedaction(protect.entities, text)      → masked copy            │
│    evaluatePolicy(stages, redaction, thresholds) → PASS / REVIEW / BLOCK│
│    pushAudit(content-free record)                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

## 1. Request lifecycle

1. **Validate** (`lib/validate.ts`): body is JSON, `text` non-empty, no null bytes, length under the
   content-type limit (16k prose / 32k script — both well under the 60k/200k API caps), `instructions`
   under 2k, unknown fields dropped.
2. **Rate limit** (`lib/ratelimit.ts`): fixed window per caller, 20 screens per 5 minutes by default.
3. **Detect** (`lib/pipeline.ts`): Guard and Protect always run in parallel; Inspect runs only for
   `contentType === 'script'` and is otherwise reported as `skipped` with a reason.
4. **Mask** (`lib/redact.ts`): a masked copy is rebuilt from the Protect spans, independently of
   whatever text the API returned.
5. **Decide** (`lib/policy.ts`): a pure function over the three stage results plus the redaction
   report. No I/O, no randomness, no model.
6. **Audit** (`lib/audit.ts`): a content-free record — SHA-256 prefix, length, decision, stage statuses,
   entity count, duration.
7. **Respond** with an `AnalyzeResponse` that carries, for every stage, its `mode`, `status`,
   `latencyMs`, `attempts`, `credits` and endpoint path.

## 2. Why the decision is separate from the detection

Clocked returns probabilities and verdicts. Turning a probability into "the agent may read this" is a
policy decision with consequences, so it lives in code a reviewer can read in one screen and that a unit
test can pin down.

`evaluatePolicy` collects reasons first, then resolves them in a fixed order:

```
BLOCK  if guard.injection ≥ 0.85
       or (guard.verdict = injection and severity = critical and probability ≥ 0.70)
       or inspect.malicious ≥ 0.80
       or (inspect.verdict = malicious and severity = critical and probability ≥ 0.65)

REVIEW if any required stage is not 'ok'            (degradation, never PASS)
       or guard says injection below the block line
       or inspect says suspicious / malicious below the block line
       or a high-sensitivity entity kind was found
       or ≥ 6 findings were returned
       or findings exist but no masked copy could be built

PASS   otherwise
```

Thresholds are configurable through `POLICY_BLOCK_INJECTION`, `POLICY_BLOCK_SCRIPT` and
`POLICY_REVIEW_ENTITY_COUNT`; the resolved values are echoed in the response and printed in the report,
so an export always states the policy it was judged under.

## 3. Redaction, in detail

`buildRedaction(text, entities, apiAnonymizedText)`:

1. rejects non-integer, negative, out-of-range or empty spans (`rejected[]`, with a reason);
2. if `text.slice(start, end) !== entity.value`, re-anchors the span on an unclaimed occurrence of the
   value and flags it `realigned: true`;
3. expands any span that would split a UTF-16 surrogate pair so the masked text can never contain a
   lone surrogate;
4. sorts longest-first, then by position, and drops any span that overlaps an accepted one
   (`dropped[]`, naming the span it collided with);
5. emits `<TYPE>` placeholders and compares the result to the API's `anonymized_text`
   (`match` / `differs` / `absent`).

If no span survives, `maskedText` is `null`. The policy engine then refuses to treat the content as
forwardable and the UI says so explicitly.

## 4. Source-view highlighting

`buildSegments` (`lib/highlight.ts`) produces contiguous, non-overlapping segments over the original
text with a fixed priority: **injection evidence > script evidence > high-sensitivity PII > PII**. The
concatenation of segments always equals the input (asserted in tests), so the view can never silently
drop or duplicate characters.

## 5. Export

`buildReport` is pure and returns a `ReviewReport`:

- subject: run id, content type, length, word count, SHA-256 prefix, case title, timestamp;
- screening: one row per endpoint with status, verdict, probability, threshold, category, latency, error;
- decision: outcome, headline, degraded flag, resolved thresholds, reasons, actions;
- protection: counts, kinds, the masked copy, applied spans with offsets, dropped/rejected counts;
- review: action, time, before/after decision, note, actor;
- data sources and disclaimers that name the transport (`LIVE` / `MOCK`).

Evidence quotes that overlap a personal-data span are replaced with
`[withheld: overlaps a personal-data finding]`. Entity values are never included. `scripts` verify both
properties.

## 6. Runtime and dependencies

| Concern | Choice |
| --- | --- |
| Runtime | Node 22 (route handlers use `runtime = 'nodejs'` for `node:crypto`) |
| Framework | Next.js 15.5 App Router, React 19 |
| Styling | Tailwind CSS 4 with a small custom design system |
| Clocked | `clocked-sdk@0.7.0` (server only, `serverExternalPackages`) |
| Tests | vitest (pure logic), Playwright (browser) |
| Icons | hand-written inline SVG — no icon dependency |

No database, no auth, no external font fetch, no telemetry. The deployment is stateless except for the
in-memory rate-limit and audit maps.
