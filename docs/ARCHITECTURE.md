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
│    origin → body cap → admission → validate → pipeline → audit          │
│    guards: lib/origin.ts (same-origin) · lib/admission.ts (3-layer)     │
│  app/api/audit/route.ts   GET — last 10 content-free records            │
│  app/api/review/route.ts  POST — human decision, internal state only    │
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

1. **Origin** (`lib/origin.ts`): the handler's first statement. A request with no `Origin` header is
   accepted (same-origin `fetch` from some clients omits it); `Origin: null` is refused; otherwise the
   origin must match the app or the host the request arrived on (`x-forwarded-host`), or appear in
   `ALLOWED_ORIGINS` for a proxy setup. Refusal is `403 cross_origin_blocked` with **no** CORS header —
   the endpoint is not a public API.
2. **Body cap** (`LIMITS.maxBodyBytes`, 512 KB): checked against `content-length` before reading, and again
   against the bytes actually read, because a chunked body declares nothing. `413` before parsing.
3. **Human check** (`lib/turnstile.ts`, off by default): when enabled, the `x-turnstile-token` header is
   claimed once (SHA-256, `SET NX` on Redis or a bounded map) and verified at Cloudflare's `siteverify`
   **before any counter moves**. A missing, replayed or rejected token is `403 challenge_required`; an
   unreachable verifier is `503`, because "we could not check" must not become "we assume it was fine".
   Without a configured site key the step is a pass-through and `/api/status` says `turnstile: "off"`.
4. **Admission** (`lib/admission.ts`): three layers, in this order — a per-caller fixed window (20 per
   5 minutes), a per-caller concurrency slot (2 in flight), and a whole-deployment daily ceiling
   (60 live / 240 simulated, `lib/quota.ts`: memory, or one atomic Redis `EVAL` when configured, and
   **fail-closed** when Redis cannot answer). The quota is consumed last, so a request refused earlier does
   not spend the allowance for everyone else. Each refusal is `429` with a different message and
   `Retry-After`, because "slow down", "you already have one running", "the demo is out of budget for today"
   and "the budget cannot be checked" are different instructions to a user.
5. **Validate** (`lib/validate.ts`): body is JSON, `text` non-empty, no null bytes, length under the
   content-type limit (16k prose / 32k script — both well under the 60k/200k API caps), `instructions`
   under 2k, unknown fields dropped.
6. **Detect** (`lib/pipeline.ts`): Guard and Protect always run in parallel; Inspect runs only for
   `contentType === 'script'` and is otherwise reported as `skipped` with a reason.
7. **Mask** (`lib/redact.ts`): a masked copy is rebuilt from the Protect spans, independently of
   whatever text the API returned.
8. **Decide** (`lib/policy.ts`): a pure function over the three stage results plus the redaction
   report. No I/O, no randomness, no model.
9. **Audit** (`lib/audit.ts`): a content-free record — SHA-256 prefix, length, decision, stage statuses,
   entity count, duration.
10. **Respond** with an `AnalyzeResponse` that carries, for every stage, its `mode`, `status`,
    `latencyMs`, `attempts`, `credits` and endpoint path, plus `X-RateLimit-*` and `X-Daily-Remaining`
    so the client can say how much budget is left without asking a second endpoint.

The caller bucket comes from `callerIdentity()`: `x-forwarded-for` is believed only when `TRUST_PROXY=1`
(and then only its **last** hop, the one a proxy appended); otherwise a claimed address is folded into 64
buckets. That is a fairness partition, not proof of identity — the ceilings that bound spending are the
daily quota and the Turnstile gate.

The concurrency slot is released in a `finally` block, so a failed detection cannot leak the slot and lock
a caller out of the demo until the process restarts.

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

A REVIEW has two meanings and the response must not blur them, so the outcome carries `screening` as well
as `decision`:

| `screening` | Meaning | Headline | What the UI does |
| --- | --- | --- | --- |
| `complete` | every required detection answered; a human is needed because of what the content *is* | `Hold at the human checkpoint before the agent reads it.` | amber `REVIEW` badge, reasons and actions |
| `unavailable` | a required detection returned nothing, so part of the content was never assessed | `Screening unavailable — manual review required.` | `Unavailable` badge, "no risk verdict / held for a human", and the failed stage explains what it did not return |

`unavailable` is never PASS, and it is never MOCK-filled: there is no code path that substitutes a simulated
result for a failed live one. When the API is unreachable the run says so, the exported sheet says so, and
the forwarded copy is withheld.

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
- decision: outcome, headline, `screening` (`complete` / `unavailable`), degraded flag, resolved thresholds,
  reasons, actions;
- protection: counts, kinds, the masked copy, applied spans with offsets, dropped/rejected counts;
- review: action, time, before/after decision, note, actor;
- data sources and disclaimers that name the transport (`LIVE` / `MOCK`).

Evidence quotes that overlap a personal-data span are replaced with
`[withheld: overlaps a personal-data finding]`. Entity values are never included. `scripts` verify both
properties.

## 6. What the browser is allowed to know

| Question | Answer in code |
| --- | --- |
| Where is the key? | Only in the server process. `lib/config.ts` throws if it is ever evaluated with a `window` object, `tests/harness-hygiene.test.ts` asserts that no client component imports it and that the key is read in exactly two files. |
| What can the client learn about it? | `GET /api/status` returns `mode`, a `configuredKey` boolean and the limits. Never the value, never a prefix, never a length. |
| What does a failure say? | `400` for input, `403` for origin, `413` for size, `429` for admission, `503` for a misconfigured deployment (with the variable name, which is operator information and not secret), `500 pipeline_failure` with a generic message. An internal message can name a host, a header or a stack frame, so it is not included. |
| Can another page call the endpoint? | Not usefully: no `Access-Control-Allow-Origin` is ever emitted, and a foreign `Origin` is refused outright. |
| What happens to a slow run? | Each `screen()` takes a monotonic sequence number; a response whose number is no longer current is discarded, so an earlier run that finishes late cannot overwrite a newer decision. Cancelling aborts the fetch and releases the slot server-side. |
| Does the content persist? | No. It lives in React state for the session; there is no `localStorage`, no `sessionStorage`, no cookie, and the audit record is content-free by construction. |

## 7. Runtime and dependencies

| Concern | Choice |
| --- | --- |
| Runtime | Node 22 (route handlers use `runtime = 'nodejs'` for `node:crypto`) |
| Framework | Next.js 16.4 App Router, React 19.3 |
| Styling | Tailwind CSS 4 with a small custom design system |
| Clocked | `clocked-sdk@0.7.0` (server only, `serverExternalPackages`) |
| Tests | vitest 5 (pure logic), Playwright 1.64 (browser) |
| Abuse control | in-memory maps in `lib/admission.ts` and `lib/ratelimit.ts` — correct for one process, not for a fleet |
| Icons | hand-written inline SVG — no icon dependency |

No database, no auth, no external font fetch, no telemetry. The deployment is stateless except for the
in-memory admission window, the audit ring buffer and the review notes, all of which reset when the process
restarts. A multi-instance deployment needs a shared limiter in front — the per-IP window and the
per-caller concurrency slot would otherwise be multiplied by the instance count.

