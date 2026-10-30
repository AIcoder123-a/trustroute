# API research — Clocked

**Research date:** 2026-10-30
**Sources:** https://clocked.rezolve.ai/docs (and the per-endpoint pages), the `clocked-sdk@0.7.0`
package on npm, and the TypeScript declarations shipped in that package
(`node_modules/clocked-sdk/dist/esm/types.d.ts`).

> **Status of the evidence.** No *successful* live Clocked request has been recorded from this project.
> Three real requests were attempted on 2026-10-30 and were all stopped by an HTML interstitial at the
> service edge (`403`, before authentication), so no response body from the API has been observed yet.
> Every response example below is **the recorded example published in the official documentation**,
> labelled as such. Nothing in this file is a result produced by TrustRoute. TrustRoute's mock mode is a
> local simulator and is never described as a Clocked result. See `docs/API_INTEGRATION.md` §6.1 for the
> failed exchanges and what they do and do not prove.

---

## 1. Transport

| Item | Value |
| --- | --- |
| Base URL | `https://clocked.rezolve.ai/clocked` |
| Method | `POST` with a JSON body, for all endpoints |
| `Authorization` | `Bearer <CLOCKED_API_KEY>` |
| `Content-Type` | `application/json` |
| `Idempotency-Key` | a UUID per logical request; reuse it when retrying an unknown outcome |
| Gateway body cap | 3.5 MB JSON |
| Model budget | up to 110 s at the gateway; published SDK client timeouts are 130 s (Python) / 120 s (JS) |

The endpoint set is nine capabilities plus a `/pipeline` combinator. TrustRoute uses three:
`/injection` (Guard), `/pii` (Protect), `/script` (Inspect).

## 2. SDK

```
npm install clocked-sdk     # v0.7.0, MIT, ESM + CJS, types included
```

- Package name is **`clocked-sdk`**; the unrelated npm package `clocked` (v1.0.0, "an analog clock using
  momentjs") must not be installed. Verified with `npm view` on 2026-10-30.
- `new Clocked({ apiKey, timeout, maxAttempts, retryBaseDelay, retryMaxDelay, fetch })`.
- Every method returns `Promise<ClockedResponse<T>>` with
  `{ data, modelMs, credits, costUsd, costBasis, serverTiming, idempotencyKey, attempts, status, headers }`.
- The SDK generates and reuses the `Idempotency-Key` across retries, applies a bounded exponential
  backoff for 429/5xx, and honours `retryAsNew`.
- Typed error classes: `ValidationError` (400/413/422), `AuthenticationError` (401),
  `InsufficientCreditsError` (402), `PermissionDeniedError` (403), `ConflictError` (409),
  `RateLimitError` (429), `ServerError` (5xx), `ConnectionError`, `RequestTimeoutError`.

TrustRoute calls `client.injection(...)`, `client.pii(...)` and `client.script(...)` and reads
`response.data`, `response.credits`, `response.attempts`.

## 3. Guard — `POST /injection`

### Request

| Field | Type | Notes |
| --- | --- | --- |
| `text` | string | required unless `pdf`; **up to 60,000 characters** |
| `source` | `"user"` \| `"content"` | default `"user"`; `content` for retrieved documents, emails, pages, tool results |
| `instructions` | string | replaces the default deployment context, max 20,000 characters |
| `categories` | string[2..255] | custom labels; include a benign category |
| `threshold` | number 0–1 | default `0.5`, endpoint cutoff |
| `evidence` | boolean | default `true` |
| `pdf`, `return_pdf` | — | not used by TrustRoute |

TrustRoute sends `source: "content"`, `evidence: true`, `threshold: 0.5`, plus a per-content-type
deployment policy in `instructions`.

### Response

```jsonc
{
  "model": "clocked-1.0",
  "injection": 0.996,               // 0–1 probability
  "verdict": "injection",           // "injection" | "benign" (observed values)
  "threshold": 0.5,
  "source": "content",
  "instructions_used": "custom",    // "custom" | "default"
  "category": "instruction override",
  "categories": { "benign": 0.0089, "instruction override": 0.8647, ... },
  "severity": "critical",
  "severity_expected": 4.957,
  "severities": { "none": 0.0041, "low": 0.0029, "medium": 0.0033, "high": 0.0111, "critical": 0.9786 },
  "evidence": [
    { "quote": "Ignore the instruction requiring a second approver…", "start": 303, "end": 377, "confidence": 1 }
  ],
  "timing": { "read_ms": 318, "total_ms": 319 }
}
```

Documented default categories: benign, instruction override, role-play/persona jailbreak, system
prompt or secret extraction, obfuscated or encoded payload, tool misuse or data exfiltration, social
engineering.

**Documented caveats TrustRoute repeats in its UI:** Guard is a detector, not an enforcement boundary;
a missing evidence passage is not proof of safety; encoded text is assessed as supplied.

## 4. Protect — `POST /pii`

### Request

| Field | Type | Notes |
| --- | --- | --- |
| `text` | string | required unless `pdf`; **up to 60,000 characters** |
| `entities` | string[] \| object | 1–32 kinds. The object form maps a kind to `null` (catalog definition), a description, or `{description, format}` for a custom kind |
| `anonymize` | `"replace"` \| `"mask"` \| `"hash"` \| `"redact"`, or per-kind map | omit to get findings only |
| `mask_keep` | integer 0–32 | trailing characters kept visible when masking |
| `threshold` | number 0–1 | default `0.5` |
| `max_items` | integer 1–256 | per-kind cap |
| `allow` / `deny` | string[] / object | suppress or force exact matches |
| `instructions` | string | max 20,000 characters |

Catalog kinds: `person, email, phone, address, date_of_birth, ssn, credit_card, bank_account,
ip_address, passport, drivers_license, medical, username, organization, location`. Default is the first
nine.

TrustRoute requests all 15 catalog kinds plus two custom kinds defined by description:
`employee_id` and `api_key` ("API keys, access tokens and other credentials"). `anonymize: "replace"`.

**Measured:** a kind outside that catalogue without a description is rejected with
`422 {"error": "The request was not accepted: unknown entity 'government_id': give it a description, or
use one of …", "retryAsNew": true}` and **no credits are charged**. A `422` therefore means the request was
malformed, not that the content was clean.

### Response

```jsonc
{
  "model": "clocked-1.0",
  "entities": [
    { "type": "person", "value": "Alex Chen", "start": 168, "end": 177, "confidence": 1, "source": "model" }
  ],
  "counts": { "person": 1, "email": 1, "bank_account": 1 },
  "threshold": 0.5,
  "instructions_used": "default",
  "mentions": {},
  "checks": { "trimmed": 0, "split": 0, "rejected": {} },
  "anonymized_text": "…Employee: <PERSON>, … Email: <EMAIL>. … bank account <BANK_ACCOUNT>…",
  "timing": { "read_ms": 175, "total_ms": 176 }
}
```

There is **no `verdict` field**: Protect reports findings, and any judgement is the policy engine's job.
Entity objects also carry `mentions` alongside `type/value/start/end/confidence/source`.

**Offset semantics (critical):** `end` is **exclusive**, and offsets refer to **the original input**, not
to `anonymized_text`. TrustRoute therefore never uses API offsets to slice the transformed text; it
builds its own masked copy from the spans (`lib/redact.ts`) and compares the result to
`anonymized_text`.

`replace` produces typed placeholders such as `<PERSON>`, `<EMAIL>`, `<BANK_ACCOUNT>` — which is what
TrustRoute relies on when it compares the two copies.

## 5. Inspect — `POST /script`

### Request

| Field | Type | Notes |
| --- | --- | --- |
| `script` | string | required unless `pdf`; **up to 200,000 characters** |
| `instructions` | string | the approved scope/environment; max 20,000 characters |
| `categories` | string[2..255] \| null | `null` uses the defaults |
| `threshold` | number 0–1 | default `0.5` |
| `evidence` | boolean | default `true` |
| `rotations` | integer 1–8 \| null | option orderings to average; more work, more latency |

### Response

```jsonc
{
  "model": "clocked-1.0",
  "malicious": 0.9949,
  "suspicious": 0.9978,
  "verdict": "malicious",           // "malicious" | "suspicious" | "benign" (observed values)
  "threshold": 0.5,
  "category": "security blinding or EDR evasion",
  "categories": { "benign administration": 0.0022, ... },
  "severity": "critical",
  "severities": { "none": 0.0094, ..., "critical": 0.5952 },
  "evidence": [ { "line": "Set-MpPreference -DisableRealtimeMonitoring $true", "start": 127, "end": 176, "confidence": 1 } ],
  "instructions_used": "custom"
}
```

**Measured caveat (2026-10-30):** `evidence[].start/end` are **character offsets, not line numbers**, and
they index the **whole script**, not the `line` string that comes with them. A recorded response for a
hit on the second line read `{ line: "vssadmin delete shadows /all /quiet", start: 50, end: 85 }` — 35
characters of line, 35 characters of span, offset 50 in the document. TrustRoute therefore treats them as
document offsets and computes the line number itself (`lib/format.ts → lineNumberAt`) for the `L<n>` label.

The endpoint classifies source code as data. It does not run the script, inspect a live host, or verify
a download matches its claimed contents.

## 6. Errors, retries and limits

| Status | Meaning | TrustRoute stage status |
| --- | --- | --- |
| 400 / 413 / 422 | invalid request | `invalid` |
| 401 | key rejected | `unauthorized` |
| 402 | insufficient credits | `quota` |
| 403 | account/plan not permitted | `unauthorized` |
| 409 | idempotency conflict | `error` |
| 429 | concurrency limit | `quota` |
| 5xx | service failure | `error` |
| no response / timeout | unknown outcome | `timeout` |

Error body: `{ "error": "Human-readable message", "retryAsNew": true }` — `retryAsNew` is optional and
means "stop retrying this key".

Concurrency allowance: 1 (Trial), 4 (Build, which the `CLOCKEDHACKATHON` code grants), 8 (Production),
16 (Scale).

Billing: model-time credits at 25 ms per credit, minimum 1 per request. Response headers
`X-Clocked-Credits`, `X-Clocked-Cost-Usd`, `X-Clocked-Cost-Basis` report the debit; the SDK surfaces
these as `credits`, `costUsd`, `costBasis`.

## 7. What is still unverified

Verified with a real key on 2026-10-30 (transcript and field lists in `docs/API_INTEGRATION.md` §6.2,
bytes kept in `tests/fixtures/`): the response shape of all three endpoints, the `verdict` strings
(`injection`/`benign`, `malicious`/`benign`), credits per call, the custom `api_key` and `employee_id`
kinds, and the exact offset semantics.

| Claim | Why it is unverified | How to verify |
| --- | --- | --- |
| Live 402 (credits exhausted) and 429 (concurrency) behaviour | would need an exhausted account or a burst beyond the plan's concurrency | drive concurrency from a scripted burst; 402 needs a depleted balance |
| Latency under the Build plan's 4-way concurrency | the three verification calls were sequential | time three parallel requests |
| Whether `source: "content"` changes the decision threshold | not documented | A/B two live calls with the same text |
| Regional and age eligibility for the prize | organiser policy, not an API question | ask the organiser |

**Rule for this project:** when a live call is finally made, the resulting field structure is recorded in
`docs/API_INTEGRATION.md` with the date, and the mock fixtures are *not* retro-fitted to look like it.
