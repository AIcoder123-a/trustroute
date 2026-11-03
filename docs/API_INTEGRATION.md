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
| Headless **Chromium** from the same machine | `200` on the docs page, and an unauthenticated `POST /clocked/pii` answered `401` — the request reached the API, it was not challenged |

**What that establishes.** Not the credential (an unauthenticated request is refused identically), not
the method or the path (the whole host answers the same way), and not the request body (the browser sent
byte-identical JSON).

**What it does not establish — corrected 2026-10-31.** An earlier version of this section named the
TLS/HTTP fingerprint as *the* cause. That was a hypothesis presented as a measurement. Three
explanations still fit the observations and the evidence collected so far does not separate them:

1. **A client-integrity rule.** The edge scores the TLS/HTTP/JavaScript profile of the connection and
   challenges anything that does not look like a browser. This remains the most economical explanation,
   but it is not proven.
2. **A different egress path.** Chromium may use the Windows system proxy while Node and `curl --noproxy`
   do not. Measured 2026-10-31 (`scripts/egress-compare.mjs`): Chromium reached the API both with its
   default proxy configuration and with the proxy disabled, so a proxy is not *required* for the browser
   to pass. That weakens this explanation without eliminating it.
3. **Per-POP behaviour.** The challenge came back from `-SEA` for Node and `curl`; Chromium's requests
   were answered from `-CMH`. Different Cloudflare POPs can carry different rules and different egress
   addresses, so the "same IP, same minute" phrasing used earlier in this project was never verified and
   should not be repeated.

The practical consequence is unchanged and observable: an API-only client is treated as automated
traffic, while a real browser on the same machine is not.

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

### 6.3 Server-side acceptance — last run 2026-11-01

The browser harness proves the key works. It does not prove the product works, because the product calls
Clocked from Node. That question has its own program:

```bash
npm run accept:check      # preflight: which file the key came from, its fingerprint; sends nothing
npm run accept:live       # alias of verify:live; the three real calls
```

The key is loaded by the npm script itself (`node --env-file-if-exists=.env.local`), so a rotated key is
picked up by editing one file. A variable already exported in the shell takes precedence over the file —
Node's documented behaviour, and the exact way a stale credential survives a rotation — so the preflight
compares the two in memory and warns when they disagree. Neither command prints the key: the preflight
prints its **length** and a `sha256:` **8-character fingerprint**, which identifies which key was used
without being reversible. After the 2026-10-31 rotation the fingerprint changed accordingly, which is how
the two runs in this document are told apart.

`scripts/live-acceptance.mjs` imports `clocked-sdk` directly, calls the three endpoints from the Node
process, and records what came back in `.local/live-acceptance.json` (git-ignored):

- HTTP status, `content-type`, and the edge headers `cf-ray`, `cf-mitigated`, `server-timing`, `x-clocked-credits`
- **one category per call**, because "403" alone conflates four different things:
  `answered` · `edge_challenge` · `auth_failed` · `forbidden` · `credits` · `rate_limited` · `rejected` ·
  `timeout` · `connection_error`
- the transport `cause` chain (`UND_ERR_CONNECT_TIMEOUT`, `ENOTFOUND`, `CERT_HAS_EXPIRED`…), unwrapped from
  undici's generic `fetch failed`, so a connect timeout is not reported as an API problem
- response shape — field names and types, never content
- the actual verdict, probabilities, entity kinds/offsets (values never printed), evidence counts
- credits, cost, attempts, idempotency key, and the credential fingerprint
- the data source, spelled out: *Clocked API via clocked-sdk (server-side Node process)*

Result on 2026-11-01, from this machine, no browser involved, `CLOCKED_MAX_ATTEMPTS=1`:

**Run A — office network (morning).** Egress: the same machine's fixed line.

| Endpoint | Category | HTTP | Latency | Response type | Verdict | Credits | `cf-ray` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /injection` | `timeout` | — | 10,680 ms | — | — (`ConnectionError`) | 0 | — |
| `POST /pii` | `timeout` | — | 10,660 ms | — | — | 0 | — |
| `POST /script` | `edge_challenge` | **403** | 728 ms | `text/html` | — (`PermissionDeniedError`) | 0 | `a5384d90de0f45f7-SEA` |

**Run B — phone hotspot (afternoon, the network the demo would be judged from).** Egress confirmed as a
China Mobile carrier address (AS24445) by two independent clients before the run. The address itself is
withheld from this document: it identifies a subscriber line, and it is not needed to read the result.

| Endpoint | Category | HTTP | Latency | Response type | Verdict | Credits | `cf-ray` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /injection` | `timeout` | — | 10,758 ms | — | — (`ConnectionError`) | 0 | — |
| `POST /pii` | `edge_challenge` | **403** | 997 ms | `text/html` | — (`PermissionDeniedError`) | 0 | `a538a4f8fbdc0da3-SEA` |
| `POST /script` | `timeout` | — | 10,148 ms | — | — | 0 | — |

The timeouts are `fetch failed ← UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error (attempted addresses:
104.21.65.122:443, 172.67.163.50:443, timeout: 10000ms)` — both Cloudflare anycast addresses, no TCP
connection, no TLS, no HTTP status, so nothing about the credential or the account. The call that reached
the edge was challenged. **Two different networks produced the same two failure shapes in the same order**,
which is why the next question was not "which network" but "which client".

**What this establishes.** When a request reaches the edge, it is refused before authentication and before
billing (0 credits, `x-clocked-credits` absent), with an HTML challenge rather than a JSON error — not the
key, not the body, not the method. When it does not reach the edge, there is no answer at all, and that is
a property of the path, not of the API.

**What it does not establish.** Whether the rule keys on the TLS fingerprint, the HTTP/2 settings or
something else about the client. §6.3.2 narrows it to "the client", not the address.

**Why the script does not try to get past it.** Solving a managed challenge programmatically is exactly the
kind of bypass the challenge exists to prevent, and an integration that depends on defeating a security
control is not an integration a judge should trust. The script records, exits with code `3`, and says so.

Exit codes: `0` all three answered · `1` a call failed with a response · `2` not configured · `3` challenged
· `4` the report contained the key (nothing is written in that case) · `5` nothing reached the API ·
`6` preflight only: a shell export is shadowing `.env.local`.

#### 6.3.1 Why the timeouts are not "the API is down"

Credential-free probes on the same machine, same minute (2026-11-01):

| Probe | Path | Result |
| --- | --- | --- |
| `curl https://clocked.rezolve.ai/` ×6 | through the loopback proxy the environment exports (`HTTP(S)_PROXY`) | 3 × `403` in ~1.0 s, 3 × no response after the 12 s timeout |
| Node `fetch('https://example.com')` | direct — undici ignores proxy variables by design | `200` in 1.1 s |
| Node `fetch('https://clocked.rezolve.ai/')` | direct | `UND_ERR_CONNECT_TIMEOUT` |

Two conclusions, and they point at different owners:

1. **Not a general egress block.** Another HTTPS host answers in about a second from the same process,
   so the machine can reach the internet. What fails is the TCP connection to this host's anycast
   addresses, intermittently, from this network.
2. **Not a credential question.** The calls that do connect are refused with an HTML challenge before
   authentication, and the ones that do not connect never present a credential at all.

The product does not use an environment proxy: `fetch` in Node ignores `HTTP(S)_PROXY`, so a deployed
instance will behave like the direct probes above. `CLOCKED_PROXY` exists for a proxy-shaped network, and
needs the optional `undici` package (`npm i -D undici`); it was not installed for these runs, so every
number in §6.3 is a direct-connection number.

#### 6.3.2 The same address, three clients — the refusal follows the client

If the challenge were about the network or the account, every client from one address would be treated
alike. On the hotspot, in one sitting, with **no credential in any of these requests**:

| Client | Request | Result |
| --- | --- | --- |
| Node `fetch` (undici) | `GET /` ×4 | `403` + `cf-mitigated: challenge` + HTML "Just a moment…", ~0.97 s each, `cf-ray` all `-SEA` |
| `curl` 8.x | `GET /` ×2 | `403` + `cf-mitigated: challenge`, ~1.15 s each |
| Chromium (Playwright, no key) | `GET /` | **`200`**, `finalTitle: "Clocked — A frontier model for decisions and exact extraction."`, no challenge |

Same public address, same minute, no cookie or session carried over, and the browser
was not given a credential — it was only asked whether the page loads.

**Interpretation (later shown to be wrong — see §6.3.3).** At the time this read as: the rule discriminates on
*what the client looks like*, not on where it connects from. That was consistent with everything observed
here — two different networks refused Node identically, while a browser from one of those networks passed —
but the comparison varied the client while holding the *path to the host* roughly constant, so it could not
separate the two. A cloud runner, which varies both at once, did: same Node client, `200` (§6.3.3). The
paragraph is kept as written because the mistake is instructive.

**What this changes for the deployment.** The claim still has to be earned, but not for the reason stated
above. A Render instance is a Node client on a different address than this laptop — and a different address
than the runner, too. The runner's `200` makes it likely, not certain. The order stands: deploy simulated,
measure from the host's own egress, switch to live only if a real verdict comes back. See `docs/RENDER.md`
§7.3.

**What would fix it.** A provider-side exemption for `/clocked/*` for requests that present an API key —
which is the normal shape for an API endpoint and the reason the support email asks for exactly that. No
change on this side, and nothing in this repository attempts to look like a browser.

#### 6.3.3 Answered by a cloud egress, and the answer is "not challenged"

The open question above is whether the rule keys on the client or on the path to the host. A GitHub-hosted
runner differs from this machine in both respects at once, so a successful run there separates them.
`live-check` run 1, 2026-11-01T10:16:13Z, pure Node `clocked-sdk@0.7.0`:

| Endpoint | HTTP | `cf-ray` | `cf-mitigated` | Verdict |
| --- | --- | --- | --- | --- |
| `POST /injection` | **200** | `…-MSP` | absent | injection 0.9957, critical |
| `POST /pii` | **200** | `…-MSP` | absent | 4 entities |
| `POST /script` | **200** | `…-MSP` | absent | benign 0.0026 |

12 credits, 1 attempt per call, no retry, no proxy. Details and the full record: `TEST_REPORT.md` §4.4.

So the refusal in §6.3 is **not** a rule against non-browser clients. It is a property of the path from this
machine to the host — the same Node client shape is answered normally from a datacenter egress. The support
request in §6.4 is therefore no longer a prerequisite for a hosted deployment; it is only a question about
why one particular home/mobile path is challenged.

#### Transport knobs that were checked

The SDK exposes enough to change the transport without changing the product, and the adapter now honours
the two that matter operationally:

| SDK option | Product support | Why |
| --- | --- | --- |
| `baseUrl` | `CLOCKED_BASE_URL` | If the provider supplies a different endpoint root, that is a one-line change, not a rewrite |
| `timeout` | `CLOCKED_TIMEOUT_MS` (5–120 s) | A corporate proxy is slower; a demo should still fail fast |
| `maxAttempts`, `retryBaseDelay`, `retryMaxDelay` | fixed at 2 / 400 ms / 3 s | Retries are bounded on purpose: a retried detection is billed again |
| `fetch` | not used by the product | The acceptance script uses it to inject an `undici` `ProxyAgent` when `CLOCKED_PROXY` is set — **for that process only**, with no system proxy, NIC or environment change |

The `fetch` hook is the answer to "can this run behind a proxy?" without touching the machine's network
configuration: `CLOCKED_PROXY=http://proxy.internal:8080 npm run accept:live` uses the proxy; unsetting it
uses a direct connection. Both were left unset for the run above, so the refusal is a direct-connection
refusal.

### 6.4 Escalation to the provider

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

### 6.5 Provider reply — 2026-11-02

Clocked Support answered on **2026-11-02**. The reply is summarised here because the raw message is
correspondence, not a project artifact, and is kept outside the repository under `.local/support/`.

What the reply says, in its own terms:

1. The service sits behind a **Cloudflare edge rule that checks browser integrity**, and such a rule can
   refuse non-browser clients with `403` before the request reaches the API.
2. For **Python `urllib`** clients, the suggested mitigation is to send a **descriptive `User-Agent`**
   instead of the library default.
3. The edge rules are **being corrected** on their side.

**What of that applies here.** Nothing in this project uses Python `urllib`. The product and both
acceptance harnesses call Clocked through `clocked-sdk@0.7.0` from Node. Its transport is:

```js
// node_modules/clocked-sdk/dist/esm/client.js:17
const USER_AGENT = isNode() ? `clocked-js/${VERSION} node/${process.versions.node}` : null;
```

so a Node process already sends `User-Agent: clocked-js/0.7.0 node/22.x.x` — a descriptive product token,
which is exactly the mitigation the reply proposes. It is set by the SDK, not by this application, and a
browser build of the SDK sends none because the browser supplies its own.

**Therefore the `User-Agent` advice is not a verified fix for this case, and was not treated as one.** The
refusals recorded in §6.3 already carried that descriptive token and were still answered with
`cf-mitigated: challenge`, so the suggestion does not explain them. No header was added, no user agent was
spoofed, no proxy was configured, and no challenge was solved.

**What stands as the positive evidence.** The GitHub-hosted runner run of 2026-11-01 (`live-check #1`)
called all three endpoints through the same SDK and the same code path and received `200` on each —
`/injection`, `/pii`, `/script` — for 12 credits and $0.0024 (`docs/TEST_REPORT.md` §4.4). That run remains
the proof that the integration is correct; this machine's egress remains the thing that is not.

**Still open.** Whether a participant in mainland China is eligible to enter and to receive an award is a
competition question, not an API question, and **the organiser has not replied**. It is recorded as
unresolved in `docs/COMPETITION_RULES.md` rather than assumed.

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
