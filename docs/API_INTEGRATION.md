# API integration

How TrustRoute calls Clocked, field by field, and what a real key actually returned.

**Status: all three endpoints verified with a real key on 2026-10-30** — 200, real detections, real
credits debited (section 6.2). One transport caveat remains and is documented in 6.1: from the machine
this project was built on, the service edge challenges **non-browser** clients before authentication, so
the app's server-side path (`clocked-sdk` over Node) gets `403 edge_interstitial` there while a real
browser gets `200`. The product still calls Clocked only from the server; the browser run is a
verification harness (`scripts/live-verify.mjs`), never a runtime transport.

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
| 401 | `unauthorized` | REVIEW |
| 403 with a JSON body | `unauthorized` | REVIEW |
| 403/401 answered with an HTML page | `edge_interstitial` (not retryable) | REVIEW — the request never reached the API |
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

### 6.1 A real key, two transports — 2026-10-30

`CLOCKED_API_KEY` was present in `.env.local` (52 characters, server-only, ignored by Git). Two things were
then measured from the same machine within minutes of each other.

**Server-side path (`clocked-sdk` over Node) — blocked at the edge.**

```jsonc
{
  "runAt": "2026-10-30T11:09:28.749Z",
  "sdk": "clocked-sdk@0.7.0",
  "rows": [
    { "endpoint": "POST /injection", "status": "error", "error": "ConnectionError",       "attempts": 2 },
    { "endpoint": "POST /pii",       "status": "error", "error": "PermissionDeniedError", "httpStatus": 403,
      "body": "<!DOCTYPE html><title>Just a moment...</title>…" },
    { "endpoint": "POST /script",    "status": "error", "error": "PermissionDeniedError", "httpStatus": 403,
      "body": "<!DOCTYPE html><title>Just a moment...</title>…" }
  ]
}
```

Systematic narrowing, one variable at a time:

| Probe | Result |
| --- | --- |
| `curl` with a Node-like `User-Agent` | `403`, `cf-mitigated: challenge` |
| `curl` with a Chrome `User-Agent` | `403`, challenge |
| `curl` with the full browser header set (`sec-ch-ua`, `sec-fetch-*`, `Origin`, `Referer`, `Accept-Language`) | `403`, challenge |
| `curl --noproxy '*'` (bypassing the local proxy) | `403`, challenge |
| `curl` to `/`, `/account`, `/apis`, and `GET /clocked/pii` | `403`, challenge — the whole host, not one endpoint |
| Headless **Chromium** from the same machine | `200`, page renders, no `cf_clearance` cookie needed |

So the discriminating variable is the **client's TLS/HTTP fingerprint**, not the network path, not the
method, not the path, and certainly not the credential: the same IP, the same minute, the same key —
allowed for Chromium, challenged for `curl` and for Node. Cloudflare calls this a managed challenge; the
practical consequence is that an API-only client is treated as automated traffic.

**What this means for the product.** `CLOCKED_MODE=live` on this machine produces three
`edge_interstitial` stage failures, `policy.degraded = true`, reason `detection_incomplete`, decision
**REVIEW** — measured end-to-end through `POST /api/analyze`, not inferred. Nothing is ever released on a
failed detection. The fix belongs upstream: the endpoint needs to be exempted from the browser-integrity
challenge for non-browser API keys, which is a one-line WAF exclusion the account owner should request.

**Browser path (used only to verify the key) — succeeds.** `scripts/live-verify.mjs` drives the project's
Chromium to make the same three calls from the service's own origin. Results in 6.2.

### 6.2 Successful detection transcript — 2026-10-30

```bash
npm run verify:live:browser      # node scripts/live-verify.mjs
```

```
injection  http=200  credits=3  cost=$0.000598  ms=564  verdict=injection  injection=0.9957  severity=critical  evidence=1
pii        http=200  credits=6  cost=$0.001195  ms=510  entities=person+phone+email+credit_card+employee_id+api_key
script     http=200  credits=3  cost=$0.000598  ms=429  verdict=malicious  malicious=0.9956  severity=critical  evidence=3

total: 12 credits, $0.002391
```

One full three-endpoint screen therefore costs **about 12 credits / $0.0024** (observed range per call:
`/injection` 3–4, `/pii` 6–7, `/script` 2–3). A rejected request, such as an unknown entity kind, is
answered `422` with **no credits charged**. The marketing page advertises 4,000 free credits; the
account's remaining balance is behind a web login and was not read here, so consumption is reported per
call rather than as a balance.

The verbatim responses are committed as `tests/fixtures/clocked-*.json` and asserted by
`tests/live-contract.test.ts`, so a drift in field names or offsets fails the build rather than the demo.

#### Field structure actually observed

`POST /injection` — 200:

```
model, injection, verdict, threshold, source, instructions_used,
category, categories, severity, severity_expected, severities,
evidence[], residual, residual_verdict, timing
```

- `verdict`: the string `"injection"` (the benign counterpart is `"benign"`, as `/script` shows).
- `severity`: a **string** (`"critical"`), while `severities` is the full 5-way distribution
  (`none/low/medium/high/critical`). `severity_expected` is a **number** (4.943 here), not a label —
  a confidence-weighted severity score.
- `categories`: a 7-way distribution, `category` the arg-max (`"tool misuse or data exfiltration"`).
- `evidence[]`: `{ quote, start, end, confidence, without }`. `text.slice(start, end) === quote` exactly
  (verified: 46..156 → 110 characters). `without` re-scores the text with that span removed.
- Present and undocumented when this project started: `residual` (0.0038 — the same text with all evidence
  removed), `residual_verdict`, `timing { read_ms, total_ms }`, `instructions_used: "custom"`.

`POST /pii` — 200:

```
model, entities[], counts, threshold, instructions_used, mentions, checks, anonymized_text, timing
```

- `entities[]`: `{ type, value, start, end, confidence, source, mentions }`. `source` was `"model"` on all
  six findings. `text.slice(start, end) === value` on all six.
- The 15 built-in kinds are `person, email, phone, address, date_of_birth, ssn, credit_card, bank_account,
  ip_address, passport, drivers_license, medical, username, organization, location`. Any other kind must be
  sent with a `description` — the API answers `422 unknown entity '…'` otherwise.
- `anonymized_text` uses `<PERSON>`, `<CREDIT_CARD>`, `<EMPLOYEE_ID>`, `<API_KEY>` — angle-bracket upper-case
  tokens, the same convention TrustRoute builds, so the two can be compared byte for byte (they match; see
  the contract test).
- No `verdict` field: Protect reports findings, not a judgement. The decision is the policy engine's job.
- Also returned: `mentions`, `checks { trimmed, split, rejected }`.

`POST /script` — 200:

```
model, malicious, suspicious, verdict, threshold, instructions_used,
category, categories, severity, severity_expected, severities, evidence[], timing
```

- `verdict`: `"malicious"` (0.9948) or `"benign"` (0.0026) in the two samples.
- `evidence[]`: `{ line, start, end, confidence }` — and the offsets are **positions in the whole script,
  not in `line`**: a hit on the second line came back as `{ line: "vssadmin delete shadows /all /quiet",
  start: 50, end: 85 }` while `line` is 35 characters long. This was wrong in the earlier research note
  ("character offsets not line numbers" was right, but the scope was not pinned down); the adapter now
  treats them as document offsets and `lib/highlight.ts` documents the measured behaviour.
- Benign scripts return an empty `evidence` array rather than omitting the key.

#### What the key proved

- One key works on all three endpoints; nothing about the account had to be changed between calls.
- Detections are real: a classic injection scored 0.9957 / critical, the PII sample found 6 entities
  including both custom kinds, and a Defender-disabling script scored 0.9948 / critical.
- Credits and cost arrive on every response as headers (`x-clocked-credits`, `x-clocked-cost-usd`), which is
  what the workbench surfaces per stage.
- A re-run on 2026-10-31 through the same harness produced identical verdicts (0.9957, six entities,
  0.9956) at 19 credits / $0.0038, after the harness was changed to stop passing the key into page
  JavaScript. See `docs/SECURITY_NOTES.md` §7. The same call therefore costs **12–19 credits** depending
  on how much model time it uses, and a cost figure quoted as exact would be wrong.

#### Where the key sits during that harness run

The key is attached in Node, in `page.route`, as the request leaves the browser; the page's own `fetch`
carries no `Authorization` header and no page script can read the credential. This was not always true —
the first version passed it into `page.evaluate`. The details, the impact assessment and the rotation
advice are in `docs/SECURITY_NOTES.md` §7.

### 6.3 Escalation to the provider

The 403 is not something TrustRoute can fix in code: the request is refused before authentication, at the
edge, on a property of the client rather than of the account. The prepared escalation material lives
outside the repository, under `.local/support/` (git-ignored), because vendor correspondence is not a
project artifact:

| File | Contents |
| --- | --- |
| `SUPPORT_EMAIL.md` | English email: the two paths side by side, the header block, the six questions, and an explicit statement that no key is included and no challenge bypass is being asked for |
| `DIAGNOSTICS.md` | generated by `node scripts/collect-diagnostics.mjs`: 15 probes across two transports, timestamped, with `cf-ray`, `cf-mitigated`, remote IP, TLS time and the transport failures kept separate from the refusals |
| `diagnostics.json` | the same data, machine-readable |

`scripts/collect-diagnostics.mjs` **sends no credential** — the challenge precedes authentication, so a
key would add nothing to the report and put a secret in a support thread. Before writing anything it
scans its own output for the key, any `*_KEY`/`*_TOKEN`/`*_SECRET` environment value and any `Bearer`
credential, and aborts if it finds one.

What the run on 2026-10-31 established beyond the earlier session: from this machine the connection
itself is unreliable (13 of 15 probes timed out at connect: `curl` exit 28, `UND_ERR_CONNECT_TIMEOUT`),
and **every probe that did reach the edge was refused with the challenge** — 2 of 2. Reporting only the
timeouts would have described a different fault; reporting only the 403s would have hidden that half the
attempts never got an answer. Both are in the export.

## 7. What the demo does without a key

`CLOCKED_MODE=auto` (default) resolves to **mock** when no key is present. Mock mode:

- never opens a socket to clocked.rezolve.ai;
- returns `mode: 'mock'` on every stage, a permanent **DEMO · SIMULATED RESULTS** banner in the UI (with a
  disclosure that expands into the reason), and a `MOCK` tag on each card;
- records `"Mock mode — not Clocked output"` as the model identifier;
- states the same thing in every exported report under `dataSources` and `disclaimers`, and labels the
  printable review sheet "SIMULATED RESULTS — not Clocked output".

`CLOCKED_MODE=live` without a key is a hard error, not a fallback, so a deployment cannot believe it is
live while serving fixtures.
