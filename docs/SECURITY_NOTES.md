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

## 12. The rate limiter is a speed bump on a multi-instance host (audited 2026-11-01)

> **Partly superseded by §14.** The window is now shared when Redis is configured, and the analysis
> below is what remains true when it is not. Read §14 before relying on any number here.

Asked directly in review: are the IP, concurrency and daily limits dependent on single-process memory? Yes.
Both stores are module-level `Map`s — `windows` in `lib/ratelimit.ts` and the admission state in
`lib/admission.ts` — so the limits are exact only while exactly one process serves the demo.

| Property | Consequence |
| --- | --- |
| State is per process | N instances give `N × DAILY_SCREENS` of headroom, and the concurrency slot is per instance |
| State dies with the process | a cold start or a redeploy resets the day's count; scale-to-zero forgets it every time the demo sleeps |
| The window is per caller key | the key is an edge-written address, trustworthy only when the host's edge rewrites the header — direct-to-origin, a client can present a new IP per request |
| Nothing is signed | a request that reaches the process is trusted to have come through the edge |

So the honest statement is: on Vercel (or any host that runs several instances) the daily ceiling is a
speed bump, not a ceiling. On a single long-lived process it is exact. §14 covers what changed when a
serverless host was chosen anyway, and which of these properties survive.

The two controls that would make it exact are now **implemented and unit-tested, and disabled until
configured**:

| Control | Code | Default | What has to happen before it protects anything |
| --- | --- | --- | --- |
| Turnstile gate | `lib/turnstile.ts` | off | a Cloudflare site key + secret, **and** the browser widget (not shipped — enabling the server half alone refuses every screening) |
| Shared atomic daily counter | `lib/quota.ts` + `lib/redis-rest.ts` | off (memory) | `UPSTASH_REDIS_REST_URL` and `_TOKEN`; then the ceiling is one `EVAL`, shared, restart-proof, fail-closed |

Neither can be exercised end to end in this repository's suite, because both need an account: the tests
drive them through an injected `fetch`, which covers the wire format, the refusal paths and the fail-closed
branch, but not Cloudflare's or Upstash's actual availability. Until they are configured, the deployment
rule is one instance, `DAILY_SCREENS ≤ 40`, and watch `X-Daily-Remaining`.

What the product does today to keep the damage bounded: defaults are mode-derived (60 live / 240 mock), the
remaining daily budget is returned on every response, `GET /api/status` publishes the configured ceilings
without the key, and the same-origin check stops *other pages* from spending credits — it never claimed to
stop a script, and §6 of this file lists that as a deliberate weakness rather than a control.

Two further details of the implementation are worth stating because they are easy to get wrong:

- **Identity is not taken from a client-written header by default.** `callerIdentity()` reads the *last*
  hop of `x-forwarded-for` (the one a proxy appended) only when `TRUST_PROXY=1`; otherwise a claimed
  address is folded into 64 buckets, which is a fairness partition, not proof. The ceilings that bound
  spending are the daily quota and the Turnstile gate, not the bucket.
- **The quota is consumed last** — after the window and concurrency checks, and after the body has parsed
  and validated. A request refused for any of those reasons does not spend the deployment's allowance for
  everyone else, and neither does a paste that is too long or a malformed body: only a screening that is
  about to reach a detector is charged. A granted reservation is never refunded, because a screening that
  fails locally may still have been billed upstream.

## 13. The credential and the build — checked in the artefact, not just in the source (2026-11-01)

Source-level rules are in §3 and are enforced by `tests/harness-hygiene.test.ts`. This section records the
checks that look at what actually ships, because a build step can inline a value that no source file ever
mentions.

| Check | How | Result |
| --- | --- | --- |
| No credential in the browser bundle | `npm run build` with the key present in `.env.local`, then `grep -rlF "<key>" .next` | **no match anywhere in `.next`** |
| No `NEXT_PUBLIC_*` in the bundle | `grep -rl "NEXT_PUBLIC_" .next/static` | no match; no such variable exists in the source either |
| The variable *name* in the bundle | `grep -rl "CLOCKED_API_KEY" .next/static` | one match, and it is the mock banner's instruction text ("Adding `CLOCKED_API_KEY` to `.env.local`") — a name, not a value, and the name is public knowledge |
| One read point | `tests/harness-hygiene.test.ts` asserts the string `process.env.CLOCKED_API_KEY` appears only in `lib/clocked/live.ts` and `lib/config.ts` | enforced by test |
| No client component imports server config | the same suite | enforced by test |
| What `/api/status` publishes | `app/api/status/route.ts` | mode, limits, quota store, gate state, `trustProxy`; `configuredKey` is a boolean, never the key |
| A hosted value cannot be overwritten by the repo | `render.yaml` marks every secret `sync: false` | the dashboard value is the only copy |

Three operational notes that go with it:

- **A shell export silently wins over `.env.local`.** `npm run accept:check` compares the two in memory and
  prints only length and a SHA-256 prefix, which is how a key that was rotated in one place and not the
  other gets caught before it wastes an acceptance run.
- **Deploy with the key in the host's environment panel, never in a variable a client can read.** The
  deployment audit (`npm run deploy:preflight`) fails on any `NEXT_PUBLIC_*` variable for this reason,
  including one added for an unrelated purpose.
- **The exit codes are part of the control.** `deploy:preflight` returns non-zero, and the CI workflow fails
  the job, so "we forgot to check" shows up as a red build rather than as a bill.

## 14. What a serverless host changes, and what it does not (2026-11-01)

The deployment moved to Netlify, where each invocation may run in a freshly created instance that is
discarded afterwards. That is a stronger version of the problem §12 describes, and it needs its own
statement because the numbers in §12 are phrased for "several instances" rather than "no process at all".

The four ceilings, re-stated for a host with no persistent process:

| Ceiling | Where it lives now | What is true on Netlify |
| --- | --- | --- |
| Human-check (Turnstile) | verified server-side per request | unchanged — it holds no state |
| Per caller, per window | **Redis when configured**, else memory | in memory it counts for **one invocation**; it does not become approximate, it stops counting. Redis makes it shared and correct |
| Per caller, concurrent | process memory, deliberately | a concurrency slot is per instance by construction; across N instances the effective ceiling is `N × concurrentPerCaller`. Not moved to Redis: a slot with no reliable release path leaks on every crash |
| Whole deployment, per UTC day | **Redis when configured**, else memory | in memory the ceiling is "as many screens as there are concurrent invocations", then it is forgotten. This is the one that guards money |

Three asymmetries are deliberate rather than incidental:

- **The quota fails closed, the window does not.** An unreadable daily counter returns `503
  quota_unavailable` and nothing is screened; an unreadable window counter degrades to the in-process
  counter and the request continues. The window bounds fairness, the quota bounds spend, and only one of
  those justifies an outage.
- **The quota is charged after validation, the window before it.** A malformed body costs the caller a
  window slot (it did make a request) but not the deployment a screening (it never reached a detector).
- **The window key is hashed before it becomes a Redis key name.** The store is operated on somebody
  else's account, and a caller address is a person; `windowKey()` keeps a truncated SHA-256 and the window
  bucket index, nothing else.

**Address identity is platform-specific, and now says so.** Netlify's own guidance is that
`X-Forwarded-For` carries CDN node addresses on their platform and must not be used to identify a visitor;
the authoritative header is `x-nf-client-connection-ip`. Reading that header unconditionally would be a
spoofing hole on any other host — a client could invent an identity per request — so it is read only when
`PLATFORM=netlify` is set *and* `TRUST_PROXY=1`. Neither value is a secret, and neither can be set from
`netlify.toml`, because Netlify's configuration-file variables reach builds but not functions. A deployment
that forgets them is not broken: it reports `trustProxy: false` / `platform: null` on `/api/status` and
folds every visitor into 64 buckets, which is coarse but not exploitable.

**What a deployment without Redis can still claim:** nothing is spent twice, the day's ceiling bounds the
worst case to the number of concurrent invocations, the remaining budget is on every response, and a
screening that the budget refused returns `429` rather than a fabricated verdict. **What it must not
claim:** that the per-caller window limits one caller. It does not, and §12's table says why.

Two operational consequences of the same design, both measured on 2026-11-01:

- **`/api/status` reports configuration, not reachability.** It says `store: "redis"` when the two variables
  are set, whether or not that Redis answers. An outage therefore looks healthy from the outside, and the
  only signal is the screenings themselves: `503 quota_unavailable`, arriving in ~17 ms because a refused
  connection fails immediately rather than waiting out the 3 s timeout. Treat a rise in that 503 as "the
  shared store is gone", not as "the demo is broken".
- **The audit and session trails are per invocation.** They are module-level arrays, which is exact on a
  long-lived process and meaningless here: a judge who screens, waits fifteen minutes and opens the trail
  may see an empty list. Nothing security-relevant depends on it — the records are content-free by design —
  but it is a fidelity limit of this host, not a bug, and the fix would be the same shared store the
  counters already use.
