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
- `.env*` is git-ignored; `.env.example` documents the variables and contains no values. This was checked
  rather than assumed: `git check-ignore` matches `.env.local`, and the live key value appears in no
  tracked file and in no commit in `git log --all -p`.
- Both verification scripts print field *structure*, not the key, not the raw content; the key is read
  inside the script and never written to `stdout`, a file or a fixture. Neither script writes a HAR file,
  a Playwright trace or a screenshot. See §7 for where the credential sits during a browser-based check.
- `tests/fixtures/` contains real API responses. They were recorded from synthetic samples, and
  `tests/live-contract.test.ts` asserts they carry no `Authorization`, `Bearer` or `CLOCKED_API_KEY`
  string.
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

## 7. The verification harness and the credential

`npm run verify:live:browser` (`scripts/live-verify.mjs`) drives Chromium because the service edge
challenges non-browser clients. That raised a fair question: **where is the key while that runs?**

**Now: only in the Node process, plus the request header on the wire.** The page issues a plain
same-origin `fetch` with no `Authorization` header; the header is attached in `page.route`, on the CDP
side, as the request leaves the browser. Consequences:

| Question | Answer |
| --- | --- |
| Does page JavaScript ever receive the key? | No. `page.evaluate` is called with `[path, payload]` only. |
| Can a script on `clocked.rezolve.ai` read it? | No — it is not in the page's JS heap, and `fetch` cannot be made to expose request headers set by the network stack. |
| Does it appear in the browser's network log? | Yes, as the `Authorization` header of the outgoing request. That is unavoidable for any authenticated HTTP call and is the same exposure as the SDK path. |
| Is there a HAR, trace, screenshot or log containing it? | No. The script writes no artifacts; `playwright.config.ts` records traces only for e2e against `localhost`, and `test-results/` was scanned for the key value: no hits. |
| Does the product ever call Clocked from the browser? | No. `scripts/` is a harness; `app/` and `components/` never import it, and `lib/config.ts` throws in a browser context. |

**Before 2026-10-31 this was not true, and it is worth recording rather than quietly fixing.** The first
version of the harness passed the key into `page.evaluate`, so the credential sat in the JavaScript heap
of the page on `clocked.rezolve.ai`. Impact was limited — a local headless browser on the owner's
machine, a page served by the key's own provider, no HAR or trace retained, no third-party script on
that page — but it was still a credential inside a page context, which is one XSS or one saved heap
snapshot away from disclosure. Fixed by moving the header to `page.route`; verified by re-running the
three calls (all `200`, identical verdicts). `tests/harness-hygiene.test.ts` now fails if the harness
ever hands the key to the page again.

**Re-audited 2026-10-31, after the harness was rewritten.** Four questions, answered from the code and
from a run:

| Residual path | Exposure | Mitigation in place |
| --- | --- | --- |
| The `Authorization` header crosses the CDP WebSocket between Playwright and Chromium (loopback) | Anything recording that channel — a Playwright trace, a proxy in front of CDP, a remote-debugging port exposed beyond loopback — would see the header | The harness starts no trace, writes no HAR, and connects to a browser Playwright launched itself on an ephemeral loopback port. `playwright.config.ts` traces only the e2e suite against `localhost`. |
| Page-side code (the provider's own scripts) | None: the header is merged in the network stack by `route.continue`, so it is not readable by `fetch`, `XHR` or any script | Verified by the design; a compile-time test keeps `page.evaluate` free of the value |
| The document itself | A future edit that injects the key into the DOM would not be caught by the argument-list test | The harness now reads `page.content()` from Node after the calls and exits non-zero (`4`) if the value appears anywhere in the document |
| Treating a browser `200` as proof the product works | A demo could claim "live" on the strength of a browser call the product never makes | The harness prints, on every run: *"This proves the key works from a browser. It does not verify the server-side path — run `npm run verify:live` for that."* |

The one thing this cannot remove is that the key must exist in the Node process to be attached at all.
That is true of any client, including the SDK.

Rotating the key is therefore optional rather than urgent. Rotate it if you ever ran an older copy of
the harness with a DevTools window open, with tracing enabled, or on a machine you do not control.

**What the harness is not allowed to do:** it does not spoof a browser TLS fingerprint for a non-browser
client, does not solve or automate the challenge, and does not proxy product traffic through the
browser. It launches a real Chromium, which the provider's own site is meant to serve.

## 8. Dependency and supply chain

- Clocked SDK pinned to `0.7.0`; the unrelated npm package `clocked` was checked and rejected
  (`npm view` on 2026-10-30 showed it is "an analog clock using momentjs").
- `npm audit` reports **0 vulnerabilities** as of 2026-10-31 (Next 16.4.3, React 19.3.1, vitest 5.0.5
  after two advisories were fixed by upgrading). Re-run it before deploying; a clean run today says
  nothing about tomorrow.
- No runtime dependency beyond `next`, `react`, `react-dom` and `clocked-sdk`. Icons are inline SVG.

## 9. Response headers

Set in `next.config.ts`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`, `Permissions-Policy` disabling camera/microphone/geolocation, and
`poweredByHeader: false`. API responses are `Cache-Control: no-store`.

A Content-Security-Policy is **not** set, because a wrong one breaks the app and a permissive one is
theatre. Next.js needs `unsafe-inline` for its inline bootstrap script unless you adopt nonces; that
is a follow-up, listed rather than faked.

## 10. Reporting

This is a challenge entry, not a production service. If you find a vulnerability in TrustRoute, open an
issue on the repository once it is public; do not test against any deployment with real data, because
there should never be real data in it.

## 11. Public demo hardening — audited 2026-10-31

The question this section answers is not "is the code careful" but "if this URL is posted to a judging
page, what can a stranger make it do?" Nine areas, each with what was found and what changed.

| # | Area | Finding | Control now |
| --- | --- | --- | --- |
| 1 | Key handling | Read only inside route handlers; no `NEXT_PUBLIC_*` anywhere; `lib/config.ts` throws on import in a browser context | unchanged, and re-verified by `tests/harness-hygiene.test.ts` + `tests/report.test.ts` |
| 2 | Request limits | Per-IP window existed; a body cap and a per-caller concurrency cap did not | 512 KB body cap before parsing (`413`), 2 concurrent screens per caller (`429`), 20 per 5-minute window, 16 k/32 k content caps |
| 3 | Credit abuse | Per-IP limits do nothing against many IPs; a live screen costs 12–19 credits | whole-deployment daily ceiling, **60 in live mode, 240 in mock**, configurable; `X-Daily-Remaining` on every response |
| 4 | CORS / origin | Any page could make a visitor's browser POST to `/api/analyze` and spend credits | `lib/origin.ts`: same-host or allow-listed `Origin` only, `Origin: null` refused, `403` otherwise. No `Access-Control-Allow-*` header is emitted at all, so a cross-origin page cannot read a response either |
| 5 | Error leakage | The catch-all returned `error.message` from the pipeline | generic message; the internal detail stays on the server. `401`/`403`/`402`/`429` keep their own vocabulary so an operator can tell them apart |
| 6 | PII in logs / exports / storage | No `console.*` in `app/`, `lib/` or `components/`; exports carry a hash, not text; audit records are content-free | verified by grep and by `tests/report.test.ts` and `tests/pipeline.test.ts`; the masked copy is the only content-shaped field in an export, and it is post-masking |
| 7 | Cancel / double click / stale response | The button is disabled while a screen runs, but a cancelled run could still land after a second run started | monotonic request id in `components/Workbench.tsx`; a response only applies if it belongs to the newest request. Cancel aborts the fetch, records that nothing was screened, and produces no decision |
| 8 | Unavailable vs review vs complete | A failed detection used to be shown as REVIEW, which reads as a finding | explicit `screening` state: badge *Unavailable*, headline `Screening unavailable — manual review required`, stage text "contributed nothing", no forwarded copy, `screening: "unavailable"` in the export, and a disclaimer |
| 9 | GitHub Actions | `workflow_dispatch` only, `permissions: contents: read`, secret scoped to a single step | `persist-credentials: false` on checkout; the acceptance script prints no key; the artifact it uploads is the acceptance record, which is self-checked for the key before it is written |

Notes on the choices:

- **Why allow a request with no `Origin`?** A browser sends `Origin` on every cross-site POST, so refusing
  its absence protects nothing a browser could exploit, while breaking `curl`, health checks and the
  acceptance script. `Origin: null` *is* refused, because that is what a sandboxed frame or a `data:`
  document reports.
- **Why no CORS headers?** Same-origin use needs none. Omitting them means the browser blocks a cross-origin
  *read* even if a request is sent — a second lock on the same door.
- **Why a concurrency cap when the provider allows four?** A demo does not need parallelism, and a queue of
  parallel screens is how a free account hits the provider's own limit and starts returning 429s to
  everyone.
- **Why the daily ceiling differs by mode?** Mock screens cost nothing, so a low cap would only make the
  demo fail for a judge; live screens cost money, so the default is the smaller number. `lib/config.ts`
  derives it from the resolved mode, and an explicit `DAILY_SCREENS` always wins.

Still weak, and stated so it is not mistaken for solved:

- The counters are per process. Two instances double the effective ceilings; a restart resets them.
- There is no authentication. The daily ceiling and the origin check are the only things between a
  stranger and the credit balance.
- The rate limiter trusts `x-forwarded-for`, which a direct-to-origin request can forge. Behind a host that
  sets it (Vercel, Cloudflare) that is the correct behaviour; exposed directly, it is not.
- No CSRF token. The origin check is the control; it is sufficient for a JSON-only API with no cookie
  session, which is what this is.
