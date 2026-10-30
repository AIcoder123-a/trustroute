# Security notes

TrustRoute's own threat model, what it stores, and where it is deliberately weak. Written for the
judges and for whoever deploys this next — not marketing copy.

---

## 1. What TrustRoute handles

Untrusted third-party content: support tickets, retrieved pages, tool output, scripts. Some of it is
personal data; some of it is written to manipulate the model that reads it. The gateway sees all of it
before the agent does.

## 2. The threats it addresses

| Threat | Control | Residual risk |
| --- | --- | --- |
| Prompt injection in retrieved content | Clocked Guard + a deterministic block line | Detection is probabilistic; a novel phrasing can pass. TrustRoute never claims a pass is proof of safety, and the UI repeats that. |
| Personal data reaching a model / log / downstream tool | Clocked Protect + span-validated masking; only the masked copy is offered for forwarding | Protect can miss data. The report says so explicitly. |
| An agent running a malicious script | Clocked Inspect (static) + a human checkpoint for anything above 0.80 malicious | Static analysis cannot prove intent. A benign verdict is explicitly labelled "not an execution authorization". |
| Silent failure of the safety layer | Any non-`ok` stage forces REVIEW; `CLOCKED_MODE=live` without a key refuses to start | A bug in `lib/policy.ts` would be the failure mode; 14 unit tests pin the invariants. |
| Confusing model output with policy | Verdicts and the decision are rendered in separate regions with different vocabulary | A reviewer who reads only the decision still sees the reasons. |

## 3. Secrets

- `CLOCKED_API_KEY` is read from `process.env` inside a route handler. It is not in the client bundle
  (no `NEXT_PUBLIC_`), not in a payload, not in an export, not in a log line.
- `lib/config.ts` is server-only and throws on import in a browser context, so an accidental client
  import fails at build/runtime instead of leaking.
- `.env*` is git-ignored; `.env.example` documents the variables and contains no values.
- The live smoke script prints field *structure*, not the key, not the raw content.
- The exported report has an assertion in `tests/report.test.ts` that it contains neither `clk_…`
  patterns nor the string `CLOCKED_API_KEY`.

## 4. What is stored

| Data | Where | Lifetime |
| --- | --- | --- |
| Submitted content | Node process memory during the request only | discarded when the response is written |
| Masked copy | returned to the browser; kept in React state | until the tab reloads |
| Audit record | in-memory array, 200 entries | lost on restart |
| Review events | in-memory array, 200 entries | lost on restart |
| Rate-limit counters | in-memory map | window expiry |
| Exported report | downloaded to the user's machine | under the user's control |

The audit record deliberately contains **no content**: run id, timestamp, mode, content type, SHA-256
prefix, character count, decision, per-stage status, entity count, two probabilities, duration. A test
asserts that neither the text nor an entity value appears in it.

`demo-reviewer` is the hard-coded actor name for review events. There is no authentication, so claiming
a different reviewer would be meaningless — the honest choice is to have exactly one visible identity.

## 5. Data boundary shown to the user

Before content leaves the browser the UI states, and the README repeats:

- **sent to Clocked:** the pasted content (or demo case) and the deployment policy for the content type;
- **stays local:** the API key, browser history, cookies;
- **retained by TrustRoute:** a hashed, content-free audit record and the review events of this session.

Because Clocked is a third party, a real deployment should point users at Clocked's own data-handling
terms. This demo does not accept real user content: all eight cases are synthetic.

## 6. Deliberate weaknesses (know these before deploying)

1. **No authentication.** Anyone who can reach the URL can screen content and consume credits. The
   per-IP limit (20 per 5 minutes) is the only brake. For a public demo, put it behind a shared secret or
   a Cloudflare rate-limit rule.
2. **Rate limiting is per process.** `X-Forwarded-For` is trusted, which is spoofable unless your edge
   sets it. Multi-instance deployments get one window per instance.
3. **The audit trail is not durable.** It exists to demonstrate the shape of a record, not to be an
   audit log. A production build would write to a store with a retention policy and no raw content.
4. **Mock heuristics are weak by design.** `lib/clocked/mock.ts` is a demo simulator, not a detector. It
   is labelled as such everywhere and cannot be enabled in a deployment that asks for live mode.
5. **No PII redaction of logs.** There are no logs of content, which sidesteps the problem rather than
   solving it; if you add request logging, redact first.
6. **The export is generated in the browser.** It is built from the response already in memory, so it is
   consistent with what was shown — but it is not a signed server-side attestation. If an export must be
   tamper-evident, generate and sign it on the server.
7. **Content size is capped, not streamed.** 16k prose / 32k script keeps a request under the API caps
   and prevents accidental cost; larger inputs are rejected with a clear message rather than truncated
   (truncation would silently change what was screened).

## 7. Dependency and supply chain

- Clocked SDK pinned to `0.7.0`; the unrelated npm package `clocked` was checked and rejected
  (`npm view` on 2026-10-30 showed it is "an analog clock using momentjs").
- `npm audit` was not run as a gate; run `npm audit --omit=dev` before deploying and read the output.
- No runtime dependency beyond `next`, `react`, `react-dom` and `clocked-sdk`. Icons are inline SVG.

## 8. Response headers

Set in `next.config.ts`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`, `Permissions-Policy` disabling camera/microphone/geolocation, and
`poweredByHeader: false`. API responses are `Cache-Control: no-store`.

A Content-Security-Policy is **not** set, because a wrong one breaks the app and a permissive one is
theatre. Next.js 15 needs `unsafe-inline` for its inline bootstrap script unless you adopt nonces; that
is a follow-up, listed rather than faked.

## 9. Reporting

This is a challenge entry, not a production service. If you find a vulnerability in TrustRoute, open an
issue on the repository once it is public; do not test against any deployment with real data, because
there should never be real data in it.
