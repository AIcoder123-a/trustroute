# API integration

How TrustRoute calls Clocked, field by field, and what is still awaiting a live run.

**Status: no live call has been made.** `CLOCKED_API_KEY` was not present in the build environment on
2026-10-30. Section 6 is an empty, waiting transcript. Do not fill it with anything but real output.

---

## 1. Transport

All calls go through `clocked-sdk@0.7.0` on the server:

```ts
new Clocked({ apiKey: process.env.CLOCKED_API_KEY, timeout: 30_000, maxAttempts: 2, retryBaseDelay: 400, retryMaxDelay: 3_000 })
```

- The key is read inside `getClockedClient()` (`lib/clocked/live.ts`), which is only reachable from a
  route handler. `lib/config.ts` throws at import time if `window` exists, so a client component that
  tries to import it fails loudly rather than shipping the key.
- `maxAttempts: 2` with a 30 s per-attempt timeout keeps a demo responsive (measured latency in the
  docs' recorded examples is 110–400 ms). Each stage also has a 60 s outer budget via
  `AbortSignal.timeout`.
- The SDK owns the `Idempotency-Key` and its bounded retry policy; TrustRoute never generates its own.

## 2. Guard — `POST /clocked/injection`

Request built by `liveGuard()`:

```jsonc
{
  "text": "<user content>",
  "source": "content",
  "instructions": "<deployment policy for the selected content type>",
  "evidence": true,
  "threshold": 0.5
}
```

`source: "content"` is used for every content type: even a support ticket is *retrieved content* from the
agent's point of view, not a direct user message.

`instructions` is the lever that makes the detection accurate. There are four defaults in
`lib/cases.ts` (`DEFAULT_INSTRUCTIONS`), one per content type — for example the support-ticket policy
states that tickets are untrusted data, that the assistant may read and summarise, and that it must not
change payment details or waive approvals because a ticket asked it to. Demo cases may override it.

Response mapping (`lib/clocked/normalize.ts → normalizeGuard`):

| API field | TrustRoute | Used for |
| --- | --- | --- |
| `injection` | `GuardData.injection` | policy thresholds, meter, report |
| `verdict` | `GuardData.verdict` | policy, chip |
| `threshold` | `GuardData.threshold` | meter marker |
| `category`, `categories` | `category`, `categories` | "top category" display |
| `severity`, `severities`, `severity_expected` | same | critical-severity block rule |
| `evidence[].{quote,start,end,confidence}` | same | highlighted spans + evidence quotes |
| `model`, `source`, `instructions_used` | same | provenance line in the report |
| HTTP header `X-Clocked-Credits` | `StageResult.credits` (via SDK `credits`) | credits shown in the decision panel |

A response missing `injection` or `verdict`, or carrying a probability outside 0–1, becomes
`status: 'invalid'` — which the policy turns into REVIEW.

## 3. Protect — `POST /clocked/pii`

```jsonc
{
  "text": "<user content>",
  "entities": {
    "person": null, "email": null, "phone": null, "address": null, "date_of_birth": null,
    "ssn": null, "credit_card": null, "bank_account": null, "ip_address": null,
    "passport": null, "drivers_license": null, "medical": null, "username": null,
    "organization": null, "location": null,
    "employee_id": "Internal employee or customer identifiers, such as EMP-90214 or CUS-77120",
    "api_key": { "description": "API keys, access tokens and other credentials",
                 "format": "sk_live_..., sk_test_..., ghp_..., AKIA..., xoxb-..., bearer tokens" }
  },
  "anonymize": "replace",
  "threshold": 0.5
}
```

All 15 catalog kinds plus two described custom kinds (16 of the 32 allowed). Requesting the catalog
explicitly is deliberate: the default is only nine kinds, and `medical`, `passport`, `drivers_license`
and `bank_account` matter for this product.

Response mapping (`normalizeProtect`): `entities[]` keeps `type`, `value`, `start`, `end`, `confidence`,
`source`; `counts` is passed through; `anonymized_text` is **only** used for comparison, never as the
copy TrustRoute forwards.

`end` is exclusive and offsets refer to the original text — the assumption that `lib/redact.ts`
validates per span rather than trusting.

## 4. Inspect — `POST /clocked/script`

```jsonc
{
  "script": "<user content>",
  "instructions": "<approved scope for this endpoint>",
  "evidence": true,
  "threshold": 0.5
}
```

Only called when the content type is *Script / command*. Nothing is executed: the request is a string in
a JSON body, and the server never writes the script to disk, never shells out, and never passes it to an
interpreter.

Response mapping (`normalizeInspect`): `malicious`, `suspicious`, `verdict`, `threshold`, `category`,
`categories`, `severity*`, `evidence[]`. The evidence `start`/`end` are **character offsets**, so the UI
converts them to line numbers with `lineNumberAt()` before rendering `L<n>`.

## 5. Failure handling

| Failure | Stage status | Policy effect |
| --- | --- | --- |
| 400 / 413 / 422 | `invalid` | REVIEW |
| 401, 403 | `unauthorized` | REVIEW |
| 402 | `quota` | REVIEW |
| 429 | `quota` | REVIEW |
| 409 | `error` | REVIEW |
| 5xx | `error` | REVIEW |
| timeout / abort | `timeout` | REVIEW |
| unparseable body | `invalid` | REVIEW |
| missing key with `CLOCKED_MODE=live` | request fails at 503 before any stage runs | nothing is screened, nothing is released |

Every non-`ok` status also sets `policy.degraded = true`, which changes the headline to
"Screening incomplete. Hold the content and route it to a human." Tests pin this behaviour.

## 6. Live transcript

### 6.1 First real network exchange — 2026-10-30, error path only

One real HTTPS request was made to Clocked during Phase 0, with a deliberately invalid placeholder key,
to prove the transport, the SDK and the error taxonomy work end to end. It was **not** a successful
detection and it is not evidence of integration quality. Raw stage result as returned by
`POST /api/analyze` with `CLOCKED_MODE=live`:

```jsonc
{
  "mode": "live",
  "stages": {
    "guard":   { "status": "unauthorized", "latencyMs": 798, "attempts": 1,
                 "error": { "code": "forbidden", "httpStatus": 403,
                            "message": "The account is not permitted to use this endpoint. Check the plan and endpoint access.",
                            "retryable": false } },
    "protect": { "status": "unauthorized", "latencyMs": 797, "attempts": 1,
                 "error": { "code": "forbidden", "httpStatus": 403, "retryable": false } },
    "inspect": { "status": "skipped" }
  },
  "policy": { "decision": "REVIEW", "degraded": true,
              "headline": "Screening incomplete. Hold the content and route it to a human." }
}
```

What this establishes:

- the request really left the server and reached `clocked.rezolve.ai` over HTTPS (~800 ms round trip);
- an unusable credential is surfaced as **403 PermissionDenied**, not 401 — the mapping in
  `classifyError()` handles both, and the stage is marked `unauthorized`;
- **the pipeline degraded to REVIEW and did not pass**, which is the safety invariant this project
  cares about most;
- no retry storm: `retryable: false` on a permission error, `attempts: 1`.

Still missing: one **successful** call per endpoint.

### 6.2 Successful detection transcript — NOT YET PRODUCED

Run this with a real key and paste the output below, verbatim:

```bash
CLOCKED_API_KEY=clk_... npm run verify:live
```

Expected: three rows (`POST /injection`, `POST /pii`, `POST /script`) with `status: "ok"`, the HTTP
status, latency, credits, verdict and the field list each endpoint actually returned.

```jsonc
// awaiting first successful live run — intentionally empty
```

When it exists, also record here:

- the exact `verdict` strings observed per endpoint;
- whether `severity` was present on every response or only some;
- the credits debited per call, and therefore the cost of one full three-endpoint screen;
- any field that appeared and is not documented (so the normaliser can be tightened);
- whether the custom `api_key` kind was detected in the Protect sample.

## 7. What the demo does without a key

`CLOCKED_MODE=auto` (default) resolves to **mock** when no key is present. Mock mode:

- never opens a socket to clocked.rezolve.ai;
- returns `mode: 'mock'` on every stage, a permanent banner in the UI, and a `MOCK` tag on each card;
- records `"Mock mode — not Clocked output"` as the model identifier;
- states the same thing in every exported report under `dataSources` and `disclaimers`.

`CLOCKED_MODE=live` without a key is a hard error, not a fallback, so a deployment cannot believe it is
live while serving fixtures.
