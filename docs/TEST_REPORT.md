# Test report

**Run date:** 2026-10-31
**Environment:** Windows 11, Node 22.22.2, npm 10.9.7, Chromium (Playwright 1.64.1)
**Clocked key:** present and verified on 2026-10-30 (server-side `.env.local`, never in the tree, never in
this report). Detection behaviour below is the labelled mock, the live path, or a recorded live response.

---

## 1. Code quality gates

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | clean (`strict` + `noUncheckedIndexedAccess`) |
| ESLint | `npm run lint` | 0 errors, 0 warnings |
| Production build | `npm run build` | clean, 6 routes, 123 kB shared first load |
| Production dependency audit | `npm audit --omit=dev` | **0 vulnerabilities** |
| Full audit | `npm audit` | **0 vulnerabilities** (after upgrading Next 15.5.28 → 16.4.3 and vitest 3 → 5) |
| Secrets in tree | `git grep -nE "clk_[A-Za-z0-9]{8,}"` | no matches |
| Secrets in history | every tracked file and `git log --all -p` scanned for the live key value | no match in the working tree or in any commit |
| Key exposure surface | `grep -rn NEXT_PUBLIC_` | no `NEXT_PUBLIC_` variable exists; the key is read only in `lib/clocked/live.ts` and `lib/config.ts`, both server-only |

The initial dependency scan found a high-severity advisory in Next 15's bundled PostCSS and two critical
advisories in vitest's worker pool. Both were fixed by upgrading rather than ignored: Next 16.4.3 and
vitest 5.0.5, re-verified with the full suite.

## 2. Automated tests

### 2.1 Unit and integration (vitest)

```
Test Files  17 passed (17)
     Tests  132 passed (132)
```

| File | Assertions | Covers |
| --- | --- | --- |
| `tests/policy.test.ts` | 19 | block/review/pass rules, threshold overrides, degradation on every failure class, BLOCK precedence over REVIEW, and the explicit `screening: unavailable` state (headline, trace entry, reviewer instruction) |
| `tests/redact.test.ts` | 7 | placeholder output, out-of-bounds and inverted spans, value re-anchoring, overlap resolution, surrogate-pair safety, comparison with `anonymized_text` |
| `tests/pipeline.test.ts` | 11 | all 8 demo cases end to end through the mock adapter, content-type routing (Inspect skipped for prose), audit record contains no raw content, mock labelling |
| `tests/report.test.ts` | 5 | no raw PII or entity values in the export, provenance fields, review inclusion, evidence withholding, no key-like strings |
| `tests/highlight.test.ts` | 5 | segments reconstruct the input exactly, priority on overlap, out-of-range spans ignored |
| `tests/validate.test.ts` | 10 | empty/whitespace, null bytes, unknown content type, prose vs script limits, policy length cap, non-object body |
| `tests/ratelimit.test.ts` | 3 | limit enforcement, per-caller buckets, window refill |
| `tests/error-classification.test.ts` | 6 | an HTML interstitial is never reported as a rejected key; genuine 401/403, timeout, connection failure and unknown errors each map to the right stage status; HTML never reaches the UI |
| `tests/policy-trace.test.ts` | 7 | every threshold comparison is listed with the value it used; the critical-severity override is reported separately from the block line; a failed stage is `failed`, not `pass`; a missing masked copy is a failure |
| `tests/evidence.test.ts` | 7 | one row per finding in document order, excerpts taken from the text, 1-based line numbers, unplaceable spans kept and flagged instead of dropped |
| `tests/review-note.test.ts` | 5 | rejection requires a reasoned note, approval does not, notes are trimmed and capped at 280 |
| `tests/harness-hygiene.test.ts` | 7 | the verification harness attaches the credential out of band and never inside page JavaScript; no `NEXT_PUBLIC_*` anywhere; the key is read in exactly two server-only modules |
| `tests/copy-consistency.test.ts` | 8 | no mock label claims Clocked as its source; every mock source label reads as simulated; the policy engine attributes a detection to the API only in live mode; a mock report is not "compared with Clocked"; the claim cannot be reintroduced as a literal in `components/` |
| `tests/origin.test.ts` | 6 | no `Origin` accepted, same host accepted, `x-forwarded-host` accepted, another site refused, `Origin: null` refused, an unparsable origin refused rather than trusted |
| `tests/admission.test.ts` | 6 | per-caller window, concurrency slot and release, one caller cannot consume another's slot, whole-deployment daily ceiling, reset at UTC midnight |
| `tests/http-guards.test.ts` | 6 | cross-origin POST → 403 on both routes, oversized body → 413 before parsing, malformed JSON → 400 not 500, missing text → 400, exhausted window → 429 with `Retry-After` |
| `tests/live-contract.test.ts` | 11 | recorded **real** 200 responses (`tests/fixtures/clocked-*.json`) normalise into the domain types; every span slices to its value; the rebuilt masked copy equals Clocked's own `anonymized_text`; Inspect offsets are document offsets and produce lines 1–4; the fixtures contain no credential |

The two invariants that matter most, both enforced by tests:

1. **No incomplete detection can produce PASS** — asserted separately for `error`, `timeout`,
   `unauthorized`, `quota` and `skipped`.
2. **Findings never travel unmasked** — for every demo case with entities, the masked copy exists, differs
   from the original, and contains none of the entity values.

### 2.2 Browser (Playwright)

```
44 passed, 2 skipped (1.9m)   # 23 scenarios × desktop 1440×900 and mobile 390×844
```

Both skips are deliberate: the compact decision bar and the narrow-screen unavailable bar only exist below
the `xl` breakpoint, so each is asserted on the mobile project and skipped on desktop.

| Scenario | Assertions |
| --- | --- |
| First load | H1 problem statement, mock banner, case list, analyse button disabled, decision explainer |
| Routine ticket | decision badge `PASS`, Guard and Protect cards present, "No injection signal" |
| Prompt injection | decision badge `BLOCK`, "Prompt injection detected", "Do not forward this content" |
| Personal data | `PASS` + "Personal data masked"; forwarded-copy tab shows `<EMAIL>`/`<PERSON>` and no raw email |
| Risky script | `REVIEW`, Inspect card, Approve → "reviewer override", badge becomes `PASS` |
| Export | download event, filename `trustroute-*.json`, parsed JSON has schema + transport `mock`, and no raw email or name |
| Review sheet | dialog opens, contains disclaimers, Escape closes |
| Empty input | analyse button stays disabled for whitespace-only input |
| Evidence | a Guard passage is listed with its line number; clicking it selects it (`aria-pressed`) and switches to the source view, where the corresponding `mark` is rendered |
| Rule trace | expanding the trace shows the actual comparisons ("Injection probability vs block line", "Guard returned a usable result") |
| Rejection needs a reason | Reject is disabled on an empty note; after typing one the rejection is recorded and the badge becomes `BLOCK` |
| Mask map | the forwarded view lists each kind, its replacement token and its count; clicking one returns to the source with that span selected |
| Mock honesty | after a simulated run the page contains no "Matches Clocked anonymized_text", "returned by Clocked", "endpoint threshold" or "Clocked … returned", and does say "nothing compared with Clocked" |
| One-click start | the landing CTA screens the blocked example and lands on `BLOCK` without a second click |
| Reasons up front | the blocking reason is readable without expanding the rule trace |
| Narrow-screen decision bar | below `xl` the decision and its headline sit above the results, and "Why" jumps to the full panel |
| Failed request | an aborted `/api/analyze` produces an alert and no decision badge — never a pass |
| Screening unavailable | with Protect failing, the badge reads *Unavailable* (not `REVIEW`), the band carries `Screening unavailable — manual review required` and "no risk verdict", the stage says it contributed nothing, and the forwarded copy is withheld |
| Incomplete export | the downloaded report has `decision.screening = "unavailable"`, `degraded: true`, and a disclaimer that it is not a risk assessment |
| Service refused | a `503` from `/api/analyze` shows "Screening unavailable" and no decision badge |
| Cancel | a slow screen is cancelled; the page says nothing was screened, no decision appears, and exactly one request was made |
| Narrow-screen unavailable | on mobile the compact bar carries the unavailable state and still links to the full panel |

## 3. Behavioural matrix

Required coverage from the brief, with the actual evidence for each row.

| # | Scenario | Expected | Observed | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Safe text | PASS | PASS | `pipeline.test.ts` → `safe-support`; browser scenario 2 |
| 2 | Prompt injection | BLOCK | BLOCK (mock: 95.8% injection) | `pipeline.test.ts` → `injection-classic`; browser scenario 3 |
| 3 | PII sample | PASS with masked copy | PASS, 4 entities masked, forwarded copy shows `<PERSON> <PHONE> <EMAIL> <ADDRESS>` | `pipeline.test.ts` → `pii-ticket`; browser scenario 4 |
| 4 | High-sensitivity PII | REVIEW | REVIEW (`ssn`, `date_of_birth`) | `pipeline.test.ts` → `tool-output-pii` |
| 5 | Normal script | PASS | PASS (Inspect ran, benign) | `pipeline.test.ts` → `safe-script` |
| 6 | Suspicious script | REVIEW | REVIEW (malicious 70.8%, suspicious 82.8%, verdict `suspicious`) | `pipeline.test.ts` → `review-script`; screenshots |
| 7 | Empty input | 400 + client-side block | 400 `invalid_input`; button disabled in the UI | curl below; browser scenario 8 |
| 8 | Over-length input | 400 with the limit named | 400 `Content is 17,000 characters; the limit for support_ticket is 16,000.` | curl below |
| 9 | API unreachable / blocked | REVIEW, never PASS | real 403 with an HTML interstitial from the edge → stage `error` (`edge_interstitial`), `policy.degraded = true`, decision REVIEW | §4 |
| 10 | Rate limit | 429 + `Retry-After` | 17th request in the window returned 429 | §5 |
| 11 | Timeout | REVIEW | REVIEW — asserted at the policy layer with `status: 'timeout'`; **not** reproduced against a live timeout | `policy.test.ts` |
| 12 | Credits exhausted (402) | REVIEW | REVIEW — policy layer only; not reproduced live | `policy.test.ts` |
| 13 | Malformed response | REVIEW | REVIEW — `normalize*` returns `null`, stage becomes `invalid` | `policy.test.ts` (`invalid` path) |

## 4. Real network exchange with the Clocked API

Two transports were exercised on 2026-10-30 with the real key.

### 4.1 Server-side SDK path (what the product uses)

```bash
node --env-file=.env.local scripts/live-acceptance.mjs
```

| Endpoint | SDK error class | HTTP | Attempts | Body |
| --- | --- | --- | --- | --- |
| `POST /injection` | `ConnectionError` | — | 2 | `fetch failed` |
| `POST /pii` | `PermissionDeniedError` | 403 | 1 | `<html>…Just a moment…</html>` |
| `POST /script` | `PermissionDeniedError` | 403 | 1 | `<html>…Just a moment…</html>` |

Narrowing, one variable at a time, all within the same minute and IP:

| Probe | Result |
| --- | --- |
| Node-like `User-Agent` | 403 `cf-mitigated: challenge` |
| Chrome `User-Agent` | 403 |
| Full browser header set | 403 |
| `--noproxy '*'` (bypass the local proxy) | 403 |
| `/`, `/account`, `/apis`, `GET /clocked/pii` | 403 — whole host |
| Headless Chromium, same machine | **200**, content renders |

The credential is ruled out (an unauthenticated request is refused identically). Which client property
decides the outcome — TLS/HTTP profile, egress path or POP-level policy — is **not** established; see
`docs/API_INTEGRATION.md` §6.1 for the observations and the three live hypotheses.
The app reacts exactly as designed (measured through `POST /api/analyze`, not inferred):

```jsonc
{
  "mode": "live",
  "stages": {
    "guard":   { "status": "error",   "error": { "code": "edge_interstitial", "httpStatus": 403, "retryable": false } },
    "protect": { "status": "error",   "error": { "code": "edge_interstitial", "httpStatus": 403, "retryable": false } },
    "inspect": { "status": "skipped", "error": { "code": "not_requested" } }
  },
  "policy": { "decision": "REVIEW", "degraded": true },
  "warnings": ["At least one detection did not complete. The decision was degraded to REVIEW by policy, not by a model."]
}
```

So: the request leaves the server over HTTPS and reaches the edge; the SDK's error classes map onto stage
statuses; an unusable channel degrades to REVIEW with `detection_incomplete`; the retry budget holds at
≤ 2 attempts. What it does not prove is anything about the key — a challenge before authentication is
silent about the credential.

### 4.2 Browser path (verification only)

```bash
npm run verify:live:browser      # node scripts/live-verify.mjs
```

| Endpoint | HTTP | Credits | Cost | Latency | Result |
| --- | --- | --- | --- | --- | --- |
| `POST /injection` | 200 | 3 | $0.000598 | 564 ms | `verdict: injection`, 0.9957, `critical`, 1 evidence span |
| `POST /pii` | 200 | 6 | $0.001195 | 510 ms | 6 entities: person, phone, email, credit_card, employee_id, api_key |
| `POST /script` | 200 | 3 | $0.000598 | 429 ms | `verdict: malicious`, 0.9956, `critical`, 3 evidence spans |

One full screen: **12 credits, $0.002391**. A malformed `/pii` request (unknown entity kind) answered
`422` and charged nothing. The verbatim responses are committed under `tests/fixtures/` and asserted by
`tests/live-contract.test.ts`.

### 4.3 Defects and corrections caused by these runs

1. `classifyError` reported an HTML interstitial as "the account is not permitted to use this endpoint",
   which points an operator at the wrong thing. Now `edge_interstitial`, HTML stripped, 6 tests.
2. The research note said Inspect offsets were "character offsets, not line numbers" without pinning the
   scope. Measured: they are offsets into the **whole script** (a hit on line 2 came back as 50..85 while
   `line` is 35 characters). `lib/highlight.ts` now states the measured rule, drops spans that do not fit
   instead of clamping them, and `tests/highlight.test.ts` + `tests/live-contract.test.ts` pin it.
3. `normalizeProtect` and the request catalogue were checked against real bytes: all 15 catalog kinds plus
   `employee_id`/`api_key` are accepted, an unknown kind without a description is a `422`, and Protect
   returns no `verdict` field.

## 5. Validation and abuse-control responses (curl, real server)

Run on 2026-10-31 against `npm start` (`CLOCKED_MODE=mock RATE_LIMIT_REQUESTS=50`), one request per line,
status and body quoted from the response:

```
POST /api/analyze  {text, contentType:"support_ticket"}   → 200  policy REVIEW · screening complete
                                                            x-ratelimit-limit: 50 · x-ratelimit-remaining: 46
                                                            x-daily-remaining: 236 · no access-control-*
POST /api/analyze  Origin: https://evil.example            → 403  {"error":"cross_origin_blocked", …}
POST /api/analyze  Origin: null                            → 403  {"error":"cross_origin_blocked", …}
POST /api/analyze  body 600 KB                             → 413  {"error":"payload_too_large", …}
POST /api/analyze  {"text":"   "}                          → 400  {"error":"invalid_input","message":"Nothing to screen…"}
POST /api/analyze  {"text":"a"*17000, …}                   → 400  {"error":"invalid_input","message":"Content is 17,000 characters; the limit…"}
POST /api/analyze  contentType:"prose"                     → 400  {"error":"invalid_input","message":"Field "contentType" must be one of…"}
POST /api/analyze  ×22 from one IP                         → 200 ×17 then 429 ×5 (limit 20 − 3 earlier requests)
```

The three refusals arrive before any detection runs: the origin check is the first statement in the handler,
the body cap is applied to `content-length` before reading and again to the bytes actually read, and the
admission check runs before `request.text()`. A cross-origin response carries no `Access-Control-Allow-Origin`
header at all — the endpoint is not a public API that a third-party page may call with a visitor's browser.

The 429 carries `Retry-After`; the workbench reads that header and prints the wait in seconds instead of a
generic "try later", and surfaces the server's `hint` on a 503 so a misconfigured deployment tells the
operator which variable is missing. Both paths state that nothing was screened and nothing was released.

## 6. Manual review pass

- Desktop 1440×900 and mobile 390×844 screenshotted at every state (idle, block, masked copy, report
  dialog). No horizontal overflow, no clipped controls, no overlapping text. Before/after pairs from the
  2026-10-31 refinement are in `docs/screenshots/before/` and `docs/screenshots/after/`.
- Keyboard: `Tab` reaches every control in reading order; `⌘/Ctrl+Enter` screens the current input;
  `Escape` closes the review sheet and returns focus to the sheet's close button.
- Colour contrast, measured rather than eyeballed: body text `#f1f3f5` on `#0a0b0d` is 17.7:1, secondary
  `#b7bec8` on `#101216` is 10.0:1, and the meta text `#8a929d` — previously `#6f7781`, which measured
  only ~3.6:1 — is now 6.0:1. PASS/REVIEW/BLOCK colours are 8.6/8.9/5.6:1 on the panel, and each is
  always paired with a text label, never colour alone.
- Empty, loading, error and success states all render distinct, actionable UI.

## 7. Credential-handling review of the verification harness

Requested explicitly, so it is answered explicitly rather than implied by "the scripts print no secrets".

| Question | Answer |
| --- | --- |
| Where does the request originate when the browser harness succeeds? | A headless Chromium launched by `scripts/live-verify.mjs`. Page JavaScript builds the body and calls `fetch` on `https://clocked.rezolve.ai/clocked/*` (same origin as the page it navigated to); the `Authorization` header is added in Node through `page.route`, on the CDP side, as the request leaves the browser. |
| Did the API key ever appear in browser JavaScript, page source or a browser network log? | **It did, in the first version of the harness**: the key was passed as an argument to `page.evaluate`, so it lived in the JS heap of the page on `clocked.rezolve.ai` and in the request header. Fixed on 2026-10-31 by moving the header to `page.route`; the page now issues the request with no credential and cannot read one. The key still appears on the wire, as it must for any authenticated call. |
| Was there ever a HAR, trace, screenshot or log containing credentials? | No. The harness writes nothing to disk except fixtures when asked, and those fixtures are API responses, not requests. `test-results/` and `.next/` were scanned for the key value: no hits. `playwright.config.ts` keeps traces only for e2e failures against `localhost`. |
| Is there any path where the product calls Clocked directly from the browser, bypassing the server? | No. `scripts/` is not imported by `app/` or `components/`; `lib/config.ts` throws if it is ever evaluated with a `window`; `tests/harness-hygiene.test.ts` asserts both, and that the key is read in exactly `lib/config.ts` and `lib/clocked/live.ts`. |
| Impact and rotation advice | Scope was one local headless browser on the owner's machine, a page served by the key's own provider, no retained artifacts. Rotate the key if an older copy of the harness was ever run with DevTools open, with tracing on, or on a machine the owner does not control. |

The harness is also constrained in what it will *not* do: it does not spoof a browser TLS fingerprint for a
non-browser client, does not solve or automate the challenge, and does not proxy product traffic through
the browser. It launches a real Chromium, which the provider's own site is meant to serve.

## 8. Known gaps in this report

| Gap | Why | Consequence |
| --- | --- | --- |
| The live path the product uses is still blocked here | the edge challenges non-browser clients; Chromium reaches the API from the same machine | detections are proven (4.2) and the failure path is proven (4.1), but the server-side call cannot complete from this machine until the endpoint is exempted from the browser-integrity challenge |
| Timeout and 402 not reproduced live | requires a slow or exhausted account | covered at the policy layer, not end to end |
| No cross-browser run | Chromium only | Firefox/WebKit untested; no browser-specific APIs are used |
| No accessibility audit tool | not installed | manual checks above only; axe/Lighthouse is a follow-up |
| Session-trail endpoint has no isolated unit test | its output is `listAudit()`, which is already exercised by `pipeline.test.ts` | the route itself is covered by the manual pass and the browser suite |
| No deployed environment | deployment needs the owner's authorisation | whether a cloud egress passes the edge is unmeasured; `docs/DEPLOYMENT.md` §3 gives the two cheap ways to measure it |
