# Deployment: what it takes, what is blocked, and how to find out cheaply

Nothing here has been deployed. No account was created, no service was purchased, and no remote was
configured. This document is the analysis that has to exist **before** the owner authorises a deploy.

---

## 1. What a deployment actually needs

| Requirement | Why | Where it lives |
| --- | --- | --- |
| Node runtime (not static export) | `/api/analyze` calls Clocked server-side; the key must never reach the browser | route handlers with `runtime = 'nodejs'` |
| One environment variable | `CLOCKED_API_KEY` | host's secret store, not the repo |
| Outbound HTTPS to `clocked.rezolve.ai` | the whole product is a client of that API | the host's egress |
| ~30 s function budget | three detections run in parallel, each up to a 30 s client timeout | host's function limit |
| In-memory state is acceptable to lose | audit trail and rate-limit counters are per-process by design | documented limitation, `docs/SECURITY_NOTES.md` §6 |

That is the entire list. There is no database, no queue, no storage bucket, no build-time secret. The
app is one Next.js server plus one API call.

## 2. The blocker is a client-integrity rule we have not identified

The measured failure from the build machine is an HTML challenge (`403`, `cf-mitigated: challenge`) for
**non-browser clients**, while Chromium on the same machine reaches the API layer — its unauthenticated
`POST` was answered `401`, not challenged. What decides that difference has **not** been established.
Candidates are a client-integrity rule (TLS/HTTP/JS profile), a different egress path, or per-POP
behaviour; the measurements that separate them are listed in `docs/API_INTEGRATION.md` §6.1. An earlier
version of this file called it "a fingerprint decision" as if it were measured — it was not, and the
support request now asks the provider rather than asserting.

The consequence, stated plainly:

> **Moving to a cloud host may not change the outcome, and we do not know yet.**
> A Node process on Vercel, Render or Fly has the same TLS fingerprint as a Node process on this
> laptop. If the rule is fingerprint-based, every one of them is refused. If the rule is IP-reputation
> based, a datacenter IP is more likely to look worse, not better.

So the honest statement is: **the server-side path is unverified from any host other than this machine**,
and no amount of reading documentation resolves that. It needs one measurement from a different egress.

## 3. The cheap experiment, before any deployment

Two ways to get that measurement without deploying anything. Either is enough.

**Option A — another network, same machine.** Run from a phone hotspot or an office network:

```bash
npm run accept:check      # credential preflight: which file, which fingerprint, sends nothing
npm run accept:live       # server-side SDK calls; the key comes from .env.local
```

If it answers `200`, the block was this network's egress, and any host with a clean egress will work.

**Option B — a CI runner.** `.github/workflows/live-check.yml` is committed and does exactly that: a
stock `ubuntu-latest` runner (Node 22, datacenter egress) runs `npm run accept:live` with
`CLOCKED_API_KEY` from repository secrets. It costs nothing, takes about two minutes, and answers the
question "will a cloud egress pass?" more directly than any hosting comparison table.

Both options need the owner: A needs a network, B needs a repository and a secret. **Neither was run by
the assistant**, because both require credentials or an external account.

Reading the result — the script labels each call, so the four outcomes are not confused with each other:

| Category printed | HTTP | What it means | What to do |
| --- | --- | --- | --- |
| `answered` | 200 | a real detection came back | the path works from that network |
| `edge_challenge` | 403 + `cf-mitigated: challenge`, `text/html`, 0 credits | refused at the edge **before authentication** | provider action (`/clocked/*` exemption), not a code change |
| `auth_failed` | 401 | the credential was rejected | check or rotate the key — this one *is* about the key |
| `timeout` / `connection_error` | none | nothing reached the API | the network path (tethering, DNS, captive portal, proxy) |

Reading the result across the two networks:

| Result | Meaning | Next step |
| --- | --- | --- |
| `200` from CI or hotspot | the challenge was local; the server path works elsewhere | deploy to any Node host, live mode, no design change |
| `403 challenge` from both | the rule is not about this network | ask the provider to exempt `/clocked/*` (see `.local/support/SUPPORT_EMAIL.md`) before deploying |
| `403` from CI but `200` from hotspot | the rule penalises datacenter egress | deploy behind a residential/office egress you control, or keep the demo simulated |
| `timeout` from one network only | that network's path is broken, not the API | retry from the host you intend to deploy to, and report timeouts separately from 403s |

## 4. Free hosts, compared against what this app actually needs

Not "which host is popular". Six requirements decide this, and a host that fails one of them is not a
candidate however good its developer experience:

| Requirement | Why it is non-negotiable here |
| --- | --- |
| A **Node.js** runtime for route handlers | `/api/analyze` calls the SDK; there is no static export |
| **Server-side environment variables** | the key must never be inlined into the client bundle |
| **≥ 60 s per request** | three detections in parallel, each with a 30 s client timeout |
| **Outbound HTTPS** to `clocked.rezolve.ai` | the whole product is a client of that API |
| A **free tier that lasts through 2026-11-18** | judging runs to the winners' announcement |
| **Terms that allow a public demo for a prize entry** | §4.2 — this is where Vercel Hobby fails |

Checked on 2026-11-01. Limits and terms change; re-read the provider's page before deploying.

| Host | Next 16 runtime | Per-request ceiling | Free-tier terms | Fit |
| --- | --- | --- | --- | --- |
| **Vercel Hobby** | native, no adapter | 300 s duration; 4.5 MB payload; 1 M invocations; 100 GB transfer; 4 CPU-hours active CPU | **non-commercial personal use only**; Vercel may remove a Hobby deployment "with or without notice"; Hobby/trial content may be used for model training | technically the best fit, contractually the worst for a prize entry (§4.2) |
| **Render — free web service** | persistent Node process, `next start` | no function timeout; 512 MB RAM, 0.1 CPU | no commercial-use restriction found (secondary sources; confirm on their pricing page) | **best free fit**: no adapter, long requests allowed, one process so the in-memory counters are exact — cost is a ~1 min cold start after 15 idle minutes |
| **Netlify — free** | Next.js runtime (adapter) | **10 s per function** on free (26 s on Pro); 300 credits/month | no commercial-use restriction reported | workable only with `CLOCKED_TIMEOUT_MS=8000` and one attempt, otherwise a slow screen returns 502 |
| **Cloudflare Workers / Pages** | OpenNext adapter | **10 ms CPU per request** on free; 100 k requests/day | no commercial-use restriction | the 10 ms CPU ceiling is the blocker for SSR; the paid plan ($5) lifts it — out of scope here |
| **Fly.io / Railway / Koyeb** | yes | generous | no ongoing free compute; trial credit with an expiry | a demo that dies mid-judging is worse than no demo |
| **GitHub Pages / any static host** | none | — | — | **impossible by design**: no server means no key handling and no screening |

### 4.1 Recommendation

**Primary: Render's free web service.** It is the only free option that satisfies all six requirements
without an adapter, without a function timeout, and without a non-commercial clause. The application is
already a normal Node server (`next start`), so nothing in the code changes; the only deploy-specific
detail is binding the port the host provides:

```bash
# Render: build command
npm ci && npm run build
# Render: start command — $PORT (default 10000) and 0.0.0.0, not the local 3100
npx next start -H 0.0.0.0 -p $PORT
```

`render.yaml` at the repository root encodes the whole service; **`docs/RENDER.md` is the operating manual**
(limits read from Render's docs on 2026-11-01, the ephemeral-filesystem consequence, health check, cold
start, and the two-step Turnstile enablement).

The **cold start is the accepted cost**: after 15 minutes idle the instance sleeps and the next request
takes about a minute. Two ways to soften it, neither required: an external uptime pinger every 10 minutes
during the judging window, or wording the demo link ("first load may take a minute — the instance is
waking"). Do not hide it; a judge who waits 50 seconds and then sees a working screening is fine, one who
sees a timeout is not.

**Secondary: Netlify free**, if the cold start is judged worse than a per-request cap. Then the transport
budget must fit inside the 10 s function limit: `CLOCKED_TIMEOUT_MS=8000`, `CLOCKED_MAX_ATTEMPTS=1`. A
refused or slow API still ends in `Screening unavailable`, which is the honest state, but a legitimately
slow screen (three parallel detections, ~1–2 s normally) has less headroom.

**Vercel Hobby: only with a written answer** from Vercel support, or if the entry is treated as a
personal, non-commercial project. §4.2 explains why the clause is not a formality here.

**If the live path is refused from every network** (§3), deploy the same build with `CLOCKED_MODE=mock` on
whichever host wins above. The demo is then a labelled simulation — the banner, the per-stage badges and
the export all say so — and a judge can still open it, run the whole workflow and read the code. That is
tier C in §7, and it is a fallback for a deadline, not a goal.

**Never** deploy with a live key and an unbounded daily budget. §5 is the arithmetic, §5.2 is why the
current counters are not enough on a serverless host.

### 4.2 The Vercel clause, read against a prize entry

Quoted from Vercel's Fair Use Guidelines (page last updated 2026-09-14, read 2026-11-01):

> "Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform
> requires either a Pro or Enterprise plan. Commercial usage is defined as any Deployment that is used for
> the purpose of financial gain of anyone involved in any part of the production of the project, including
> a paid employee or consultant writing the code."

…with examples that are all about the deployment itself: taking payments from visitors, advertising a
product for sale, being paid to build or host the site, affiliate links, ad networks. It also says
**asking for donations is not commercial use**. The Terms of Service add two clauses that matter more than
the definition:

> "You shall only use the Services under a Hobby plan for your personal or non-commercial use."
> "We reserve the right to disable or remove any Project or website deployment on the Hobby plan with or
> without notice at our sole discretion."

**Assessment for this entry — two readings, and the risk is asymmetric.**

| Reading | Argument | Consequence if it is the right one |
| --- | --- | --- |
| The demo is non-commercial | it takes no payments, carries no ads, has no affiliate links, sells nothing; the prize is awarded by a third party for the project, not paid by visitors or for hosting | nothing happens; Hobby is fine |
| The demo is commercial | a cash prize is "financial gain of anyone involved in any part of the production of the project" — the entrant produced it | the deployment is outside the plan, and Vercel may remove it without notice — mid-judging |

The second reading is not far-fetched: the clause is deliberately broad ("anyone involved in any part of
the production"), and a prize is money to the person who wrote the code. What makes this worth acting on
is not the probability but the failure mode: there is no bill to pay, there is a **dead link during the
judging window**, and the rules require the demo to stay publicly accessible through 18 November.

Two further points a security product should not gloss over:

1. **Model training on Hobby content.** The Terms of Service grant Vercel a licence over "Your Content"
   and state that on Hobby (or a trial Pro plan) that content may be used to train models, with opt-out
   by settings change or upgrade. This app's whole input is other people's untrusted text. If the demo
   runs live and accepts visitor content, that is a disclosure the demo page would have to carry.
2. **No SLA and no notice.** Hobby is offered "at our sole discretion"; a viral post or an abuse spike is
   grounds for removal, not for a conversation.

**What to do, in order:** (a) use Render for the public demo, so the question does not arise; (b) if Vercel
is preferred for its Next.js fidelity, ask Vercel support in writing — their own guidelines invite it —
and keep the Render deploy ready as a fallback; (c) whatever the host, do not put the only copy of the
demo behind a plan whose terms are arguable.

### 4.3 What each host would have to be verified on before trusting it

Whatever is chosen, the same four checks decide it, and none of them can be answered by a comparison
table: does the build run there at all; does the deployed instance reach `clocked.rezolve.ai` (§3); does a
slow screen survive the host's own timeout; and does the free tier survive ten days of judging traffic.

## 5. Protecting the credit balance

Live screening is not free: a full screen costs **12–19 credits** (measured, §6.2 of
`docs/API_INTEGRATION.md`). A 20,000-credit balance is therefore about **1,000–1,600 screens in total** —
enough for a demo, not enough for an open endpoint.

| Control | Where | Default | What it stops |
| --- | --- | --- | --- |
| Per-IP window | `RATE_LIMIT_REQUESTS` / `LIMITS.windowMs` | 20 per 5 min | one visitor holding the button down |
| Per-caller concurrency | `LIMITS.concurrentPerCaller` | 2 | ten tabs from one visitor, which is also how the provider's 4-concurrent limit gets tripped |
| Whole-deployment daily ceiling | `DAILY_SCREENS` | **60 live**, 240 mock | many visitors, which per-IP limits cannot see |
| Input caps | `LIMITS.proseCharacters` / `scriptCharacters` | 16 k / 32 k | one request that costs several times the normal price |
| Same-origin check | `lib/origin.ts` | on | another site triggering paid screens from a visitor's browser |

Recommended live configuration for a ten-day public window:

```
CLOCKED_MODE=live
RATE_LIMIT_REQUESTS=10
DAILY_SCREENS=40          # 40 × ~15 credits ≈ 600 credits/day ≈ 6,000 over the window
```

40 screens a day is enough for a judge who opens the link, loads two examples and reads the interface; it
is not enough for someone scraping the endpoint. `X-Daily-Remaining` on every response makes the remaining
budget visible to whoever is operating it, and `GET /api/status` publishes the configured ceilings (never
the key).

### 5.1 What these controls are, and what they are not

| Control | Honest description | Why it is not abuse protection on its own |
| --- | --- | --- |
| Same-origin check (`lib/origin.ts`) | stops **another page** from making a visitor's browser spend credits | it is a browser rule: `curl` sends no `Origin`, or sends whatever it likes. It never stopped a script and is not presented as one |
| Per-IP window (`lib/ratelimit.ts`) | a fixed window in a `Map` | per **process**; the caller key comes from `x-forwarded-for`, which is only trustworthy when the host's edge rewrites it — behind a bare Node server a client can invent an IP per request |
| Per-caller concurrency | a slot in a `Map` | per process; a restart, a new instance or a killed request leaks nothing but also protects nothing |
| Daily ceiling (`lib/admission.ts`) | the control that actually protects the balance | **in process memory**: N instances mean N × `DAILY_SCREENS`; a cold start forgets the day; scale-to-zero forgets it twice |
| Input caps | bounded cost per request | bound a single screen, not the number of screens |

The deployment consequence is arithmetic, not opinion. On a serverless host that runs several instances:

```
effective ceiling ≈ instances × DAILY_SCREENS − (counters lost to cold starts)
```

With `DAILY_SCREENS=40` and ten instances, one attacker can spend 400 credits-worth of screens in a day
without ever meeting a limit, and every cold start hands a fresh budget to whoever asks first. On a
**single** long-lived process — Render's free web service, or any one-instance host — the same code is
exact, because there is exactly one `Map`. That is one more reason §4.1 prefers a single instance.

### 5.2 A free stack that actually holds the balance

Two controls, both free, neither requiring a purchase. **Both are now implemented and unit-tested, and
both are off until the owner configures them** — that is the intended state: the code ships, the accounts
do not exist yet.

**Layer 1 — Turnstile as the gate (free, no counter needed).** Cloudflare's free plan covers Turnstile with
**unlimited verifications**, and it works on any host without putting the site behind Cloudflare. The
widget issues a single-use token valid for about five minutes; the server verifies it at
`https://challenges.cloudflare.com/turnstile/v0/siteverify` with the secret, before spending a credit.
One extra fetch (~100 ms) per screen stands between a script and the account balance — and unlike a
counter it needs no shared state, so it behaves identically on one instance or twenty.

Implemented in `lib/turnstile.ts`, with three details that are easy to skip:

- **Replay is refused before verification.** A token dies at Cloudflare once verified, but two concurrent
  replays can both reach `siteverify` first. The claim is a `SET … NX PX 300000` on the token's SHA-256
  (Redis) or a bounded map (single process).
- **An unreachable verifier is a refusal**, `503`, never a pass. A failed verification also releases the
  claim, so a still-valid token is not burned by our outage.
- **The token proves a human, not an identity.** It is never used as the caller key.

**Layer 2 — a shared atomic counter for the hard ceiling.** Upstash Redis over HTTPS (REST) is the usual
free choice: one database, 256 MB, **500,000 commands/month** (≈16,000/day), no credit card. The whole
daily ceiling is **one** round trip — a Lua script, so the increment and the expiry are atomic:

```
EVAL "local n = redis.call('INCR',KEYS[1]); if n == 1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;
      if n > tonumber(ARGV[2]) then return {n,0} end; return {n,1}"
     1 trustroute:quota:<UTC-day> <seconds-to-midnight> <DAILY_SCREENS>
```

Fail **closed** on a Redis error: the ceiling exists to protect money, and "the limiter is down" must not
mean "spend freely". Implemented in `lib/quota.ts`; budget is ~1 command/screen, three orders of magnitude
inside the free tier, because the ceiling is the point and not the quota.

**Layer 3 — the edge, if there is one.** Cloudflare's free plan includes a single rate-limiting rule with a
10-second window. It is worth configuring only if the demo already sits behind Cloudflare; it is not worth
moving the demo for.

What remains uncovered after all three: someone with many addresses can still spend the daily ceiling. That
is the design — a bounded loss of one day's budget, not an unbounded one.

### 5.3 What is in the code today

| Control | Status | Where |
| --- | --- | --- |
| Per-caller window, per-caller concurrency | **implemented, in process memory** (exact on Render's single instance) | `lib/ratelimit.ts`, `lib/admission.ts` |
| Daily ceiling | **implemented**, memory by default, **Redis when configured** | `lib/quota.ts` |
| Turnstile verification + replay guard | **implemented server-side, off by default** — the browser widget is not shipped, so enabling it without one would refuse every screening | `lib/turnstile.ts`, `docs/RENDER.md` §5 |
| Same-origin refusal, body cap, input caps, generic errors | **implemented** | `lib/origin.ts`, `app/api/analyze/route.ts` |
| Caller identity that does not trust a client-written header | **implemented** — `TRUST_PROXY` decides whether `x-forwarded-for` is believed; otherwise claimed addresses fold into 64 buckets | `lib/ratelimit.ts` |
| Shared counter (Upstash) | **implemented, unconfigured** — needs the two env vars | `lib/quota.ts` |

Until Redis is configured, the honest deployment rule stands: **run exactly one instance** (Render's free
tier is always one), keep `DAILY_SCREENS` at 40 or below, and watch `X-Daily-Remaining`. On a host that
scales out, the in-memory ceiling is a speed bump, not a limit.

## 6. Pre-flight checklist (for whenever the owner authorises it)

1. `npm run verify` — typecheck, lint, unit tests, production build.
2. `npx playwright test` — desktop and mobile flows.
3. `npm run accept:check` — confirms the key is loaded from `.env.local`, prints its fingerprint, and sends
   nothing. Then `npm run accept:live` for the real three calls (§3).
4. Confirm the deployment has **no** `NEXT_PUBLIC_*` variable, and that `/api/status` reports the expected
   `mode` without echoing the key.
5. Set `CLOCKED_MODE`, `RATE_LIMIT_REQUESTS` and `DAILY_SCREENS` as in §5, and confirm the values appear in
   `/api/status`. On Render, also set the start command to `npx next start -p $PORT`.
6. After deploy, check the **deployed URL**, not localhost:

   ```bash
   curl -s https://<deployment>/api/status
   curl -sI https://<deployment>/ | grep -iE 'strict-transport|frame-options|cross-origin'
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<deployment>/api/analyze \
     -H 'origin: https://evil.example' -H 'content-type: application/json' -d '{"text":"hi"}'   # expect 403
   ```

7. Then prove the deployed instance **screens**: load the one-click injection example in a private window
   and read the mode badge and the decision. A green build is not evidence that the host's egress reaches
   the API; only a screen is.
8. Time the first request after idle, and write the number down (`cold start: __ s`). If it is over a
   minute, say so next to the demo link instead of letting a judge discover it.

## 7. Delivery strategy: three tiers, and what each one is worth

| Tier | What runs live | What the submission can claim |
| --- | --- | --- |
| **A — three endpoints live** | Guard, Protect, Inspect all return real Clocked results in the demo | The full claim: "screens untrusted content with three Clocked detections". This is the target. |
| **B — one or two endpoints live, the rest explicitly unavailable** | e.g. Guard + Protect live, Inspect shown as unavailable with the reason | A narrower but true claim. The interface says which detection is live per stage, and an incomplete run reports `Screening unavailable — manual review required` rather than a verdict. |
| **C — simulated only** | nothing | **Not a completed submission.** It demonstrates the workflow, the masking and the policy engine, and the committed fixtures prove the integration was built against real responses, but "we call the Clocked API at runtime" cannot be said about the running demo. This is a fallback for a deadline, not a goal. |

The product supports all three without code changes: `CLOCKED_MODE` decides the transport, every stage
carries its own `mode`, and the incomplete case has its own visible state. What it will not do is pretend:
there is no code path that substitutes a simulated result for a failed live one, and none that turns
"screening unavailable" into PASS.
