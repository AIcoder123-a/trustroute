# Implementation plan and status

**Last updated:** 2026-10-30
**Deadline:** 2026-11-10 23:59 ET → 2026-11-11 12:59 UTC+8

This is a living document. Status is updated at the end of every working phase, and it is the first
place to look for what works, what is stubbed, and what is blocked on the entrant.

---

## 1. Product thesis

An AI agent reads a support ticket, a retrieved page, a tool result or a script. All four are
attacker-controlled. TrustRoute puts a checkpoint in front of the agent: three Clocked detections, a
deterministic policy decision, and an audit record a human can defend.

The product is **not** an agent runtime. It never executes a script, never sends a message and never
calls a downstream tool. That boundary is what makes it honest to demo and safe to publish.

Differentiators, in the order judges will see them:

1. **Three detections feed one decision.** Guard, Protect and Inspect are composed, not displayed
   side by side. Each one can move the outcome (see §3).
2. **The decision is deterministic and inspectable.** `lib/policy.ts` is a pure function with unit
   tests; a model verdict never becomes a decision by itself.
3. **Redaction is real, not cosmetic.** The forwarded copy is rebuilt from Protect spans with
   boundary checks, surrogate-pair safety and overlap reconciliation, then compared against Clocked's
   own `anonymized_text`.
4. **Failure is never a pass.** Timeout, 401, 402, malformed JSON or a skipped required stage degrades
   the run to REVIEW.
5. **Every number is labelled with its origin** — `LIVE` or `MOCK`, per stage, plus the endpoint path.

## 2. Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Rules verification, environment check, API research | **done** (with 2 unverified items, §6) |
| 1 | Project scaffold + real API adapter + mock adapter | **done**; live calls **blocked on API key** |
| 2 | Screening workflow: input → detect → mask → decide | **done** |
| 3 | Human review, export, UI productisation | **done** |
| 4 | Automated tests, security review, defect fixing | **in progress** (unit + 16 browser tests green) |
| 5 | Submission materials, deployment | **not started** (needs entrant authorization) |

## 3. How each endpoint changes the product

This is the section that answers the judges' "meaningful use" test, one endpoint at a time.

### Guard (`/injection`) → the decision

- `injection` probability ≥ **0.85** (or `verdict = injection` with `severity = critical` and ≥ 0.70)
  → **BLOCK**.
- Probability ≥ 0.50 but below the block line → **REVIEW** with the exact numbers in the reason text.
- Below 0.50 → contributes an informational reason only.
- Guard failing (any non-`ok` status) forces REVIEW and sets `policy.degraded = true`.

Without Guard there is no block path for prose. This is the depth argument for the group award.

### Protect (`/pii`) → the forwarded copy **and** the decision

- Every returned entity is turned into a placeholder by `lib/redact.ts`, which validates offsets,
  re-anchors spans whose value does not match, expands spans that would split a surrogate pair, and
  drops overlapping spans deterministically.
- The masked copy is what the UI offers to copy and what the export report contains. The original is
  never labelled "safe to forward".
- High-sensitivity kinds (`ssn`, `credit_card`, `bank_account`, `medical`, `passport`,
  `drivers_license`, `date_of_birth`) force **REVIEW** even when nothing malicious is present.
- Low-sensitivity findings (name, email, phone, address…) keep the run at **PASS** with mandatory
  masking — that is the "transform and forward" case, and it is why a PII-only ticket does not queue a
  human.
- ≥ 6 findings force REVIEW on volume alone.
- If spans are returned but no trustworthy masked copy can be built, the run is forced to REVIEW and the
  original can never be forwarded in its place.

### Inspect (`/script`) → the decision for script content

- Requested only when the content type is *Script / command*. `malicious` ≥ **0.80** → **BLOCK**;
  `suspicious` verdict or `suspicious` ≥ 0.50 → **REVIEW**; otherwise informational.
- Evidence offsets are converted to line numbers for display.
- Inspect failing for a script forces REVIEW — a script is never released unscreened.

Cross-endpoint composition worth noting for the write-up: a *safe-looking* ticket that contains a
prompt injection still gets its email address masked before the block decision is rendered, so the
reviewer sees the masked copy rather than raw data.

## 4. Architecture decisions (and why)

| Decision | Alternative rejected | Reason |
| --- | --- | --- |
| Next.js App Router, server-side route handlers | client-side calls to Clocked | the API key must never reach the browser; the rules and the API docs both say so |
| Deterministic policy module separate from the API layer | let the model's `verdict` drive the UI | a detector is not a policy; judges score "reproducibility", and an auditable rule table is reproducible |
| Own redaction built from spans | display `anonymized_text` only | proves the transformation is understood, and catches offset bugs; the API copy is still shown for comparison |
| Explicit `mock` mode with per-stage badges | silent fallback to fixtures | the README and the UI must never imply a fixture came from Clocked |
| Tailwind + hand-written components | shadcn/ui | fewer dependencies, no generated code that a judge has to read; the visual language is bespoke |
| System font stack | `next/font/google` | build must succeed offline; no external fetch at build time |

## 5. Work completed (evidence)

| Area | Evidence |
| --- | --- |
| Screening pipeline | `lib/pipeline.ts`, `app/api/analyze/route.ts` |
| Policy engine | `lib/policy.ts` + 14 cases in `tests/policy.test.ts` |
| Redaction | `lib/redact.ts` + 7 cases in `tests/redact.test.ts` |
| Mock adapter | `lib/clocked/mock.ts`, labelled in every response |
| Live adapter | `lib/clocked/live.ts` (SDK, error taxonomy, per-attempt timeout) |
| Review flow | `app/api/review/route.ts`, in-memory audit in `lib/audit.ts` |
| Export | `lib/report.ts` + printable sheet in `components/ReportDialog.tsx` |
| UI | `components/Workbench.tsx` and children |
| Tests | 55 unit/integration assertions, 16 browser assertions (desktop + mobile) |

## 6. Blocked on the entrant

| # | Blocker | Impact if unresolved |
| --- | --- | --- |
| 1 | `CLOCKED_API_KEY` | **No live integration evidence.** The Protect/Guard/Inspect award is judged largely on real integration; mock-only would be a serious weakness. |
| 2 | Clocked account + `CLOCKEDHACKATHON` credits | same as above |
| 3 | Public GitHub repo (needs explicit authorization to push) | entry requirement |
| 4 | Public demo deployment (needs authorization) | entry requirement |
| 5 | Age + Wise payout eligibility confirmation | eligibility / prize |

## 7. Remaining engineering work (no blockers)

1. Live smoke script (`scripts/live-smoke.mjs`, `npm run verify:live`) that performs one real call per
   endpoint and writes a redacted transcript into `docs/API_INTEGRATION.md`. **Written; not yet run.**
2. Persist nothing sensitive: confirm the audit table never stores text (already covered by a test).
3. Accessibility pass: focus order, contrast of `text-fg-3` on `bg-panel`, `aria-live` on the decision
   panel when a run finishes.
4. Rate-limit UX: surface `Retry-After` in the error banner (currently a generic message).
5. Optional stretch (only if the core is finished): a `Verify` (`/grounding`) panel that checks a
   candidate agent reply against the approved documents. Explicitly deprioritised — breadth outside the
   Protect/Guard/Inspect group is worth 0 for that award and risks the core.

## 8. Definition of done for submission

- [x] builds, type-checks, lints, unit tests pass
- [x] three endpoints integrated in code, with a mock path that is labelled
- [ ] three endpoints integrated **against the live API**, with a recorded transcript
- [x] policy genuinely changes the outcome
- [x] six-plus demo cases, all reachable in one click
- [x] full flow exercised in a real browser, desktop and mobile
- [x] no key in client code, no key in the repo
- [x] README matches the product
- [ ] submission draft finalised with real demo/repo URLs
- [ ] deployment verified
