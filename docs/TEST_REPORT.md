# Test report

**Run date:** 2026-10-30
**Environment:** Windows 11, Node 22.22.2, npm 10.9.7, Chromium (Playwright 1.64.1)
**Clocked key:** none. All detection behaviour below is either the labelled mock or the live *error* path.

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

The initial dependency scan found a high-severity advisory in Next 15's bundled PostCSS and two critical
advisories in vitest's worker pool. Both were fixed by upgrading rather than ignored: Next 16.4.3 and
vitest 5.0.5, re-verified with the full suite.

## 2. Automated tests

### 2.1 Unit and integration (vitest)

```
Test Files  7 passed (7)
     Tests  55 passed (55)
```

| File | Assertions | Covers |
| --- | --- | --- |
| `tests/policy.test.ts` | 14 | block/review/pass rules, threshold overrides, degradation on every failure class, BLOCK precedence over REVIEW |
| `tests/redact.test.ts` | 7 | placeholder output, out-of-bounds and inverted spans, value re-anchoring, overlap resolution, surrogate-pair safety, comparison with `anonymized_text` |
| `tests/pipeline.test.ts` | 11 | all 8 demo cases end to end through the mock adapter, content-type routing (Inspect skipped for prose), audit record contains no raw content, mock labelling |
| `tests/report.test.ts` | 5 | no raw PII or entity values in the export, provenance fields, review inclusion, evidence withholding, no key-like strings |
| `tests/highlight.test.ts` | 5 | segments reconstruct the input exactly, priority on overlap, out-of-range spans ignored |
| `tests/validate.test.ts` | 10 | empty/whitespace, null bytes, unknown content type, prose vs script limits, policy length cap, non-object body |
| `tests/ratelimit.test.ts` | 3 | limit enforcement, per-caller buckets, window refill |

The two invariants that matter most, both enforced by tests:

1. **No incomplete detection can produce PASS** — asserted separately for `error`, `timeout`,
   `unauthorized`, `quota` and `skipped`.
2. **Findings never travel unmasked** — for every demo case with entities, the masked copy exists, differs
   from the original, and contains none of the entity values.

### 2.2 Browser (Playwright)

```
16 passed (24.2s)   # 8 scenarios × desktop 1440×900 and mobile 390×844
```

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
| 9 | API error (authorization) | REVIEW, never PASS | real 403 from Clocked → both stages `unauthorized`, `policy.degraded = true`, decision REVIEW | §4 |
| 10 | Rate limit | 429 + `Retry-After` | 17th request in the window returned 429 | §5 |
| 11 | Timeout | REVIEW | REVIEW — asserted at the policy layer with `status: 'timeout'`; **not** reproduced against a live timeout | `policy.test.ts` |
| 12 | Credits exhausted (402) | REVIEW | REVIEW — policy layer only; not reproduced live | `policy.test.ts` |
| 13 | Malformed response | REVIEW | REVIEW — `normalize*` returns `null`, stage becomes `invalid` | `policy.test.ts` (`invalid` path) |

## 4. Real network exchange with the Clocked API (error path)

`CLOCKED_MODE=live` with a deliberately invalid key, one screen of a 56-character ticket:

```jsonc
{
  "mode": "live",
  "stages": {
    "guard":   { "status": "unauthorized", "latencyMs": 798, "attempts": 1,
                 "error": { "code": "forbidden", "httpStatus": 403, "retryable": false } },
    "protect": { "status": "unauthorized", "latencyMs": 797, "attempts": 1,
                 "error": { "code": "forbidden", "httpStatus": 403, "retryable": false } },
    "inspect": { "status": "skipped" }
  },
  "policy": { "decision": "REVIEW", "degraded": true }
}
```

What this proves: the request leaves the server over HTTPS and reaches Clocked; the SDK's error classes
map to TrustRoute stage statuses; an unusable credential degrades the run to REVIEW instead of passing it;
and no retry storm occurs (`retryable: false`, `attempts: 1`).

What it does **not** prove: any successful detection. That needs a valid key —
see `docs/API_INTEGRATION.md` §6.2 for the exact procedure and what must be recorded.

## 5. Validation and abuse-control responses (curl, real server)

```
POST /api/analyze  {"text":"   "}                        → 400  {"error":"invalid_input","message":"Nothing to screen…"}
POST /api/analyze  {"text":"a"*17000}                    → 400  {"error":"invalid_input","message":"Content is 17,000 characters; the limit…"}
POST /api/analyze  ×22 from one IP                       → 200 ×17 then 429 ×5 (limit 20 − 3 earlier requests)
```

## 6. Manual review pass

- Desktop 1600×1000 and mobile 390×844 screenshotted at every state (idle, block, masked copy, review,
  report dialog). No horizontal overflow, no clipped controls, no overlapping text.
- Keyboard: `Tab` reaches every control in reading order; `⌘/Ctrl+Enter` screens the current input;
  `Escape` closes the review sheet and returns focus to the sheet's close button.
- Colour contrast: body text `#eceef1` on `#0a0b0d` and secondary `#a3aab3` on `#101216` both exceed
  WCAG AA for body text; decision colours are paired with a text label, never colour alone.
- Empty, loading, error and success states all render distinct, actionable UI.

## 7. Known gaps in this report

| Gap | Why | Consequence |
| --- | --- | --- |
| No successful live call | no `CLOCKED_API_KEY` | the "quality of integration" criterion depends on the code and the error path only, for now |
| Timeout and 402 not reproduced live | requires a slow or exhausted account | covered at the policy layer, not end to end |
| No cross-browser run | Chromium only | Firefox/WebKit untested; no browser-specific APIs are used |
| No accessibility audit tool | not installed | manual checks above only; axe/Lighthouse is a follow-up |
| Session-trail endpoint has no isolated unit test | its output is `listAudit()`, which is already exercised by `pipeline.test.ts` | the route itself is covered by the manual pass and the browser suite |
