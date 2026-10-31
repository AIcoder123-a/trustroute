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
CLOCKED_API_KEY=… npm run verify:live
```

If it answers `200`, the block was this network's egress, and any host with a clean egress will work.

**Option B — a CI runner.** `.github/workflows/live-check.yml` is committed and does exactly that: a
stock `ubuntu-latest` runner (Node 22, datacenter egress) runs `npm run verify:live` with
`CLOCKED_API_KEY` from repository secrets. It costs nothing, takes about two minutes, and answers the
question "will a cloud egress pass?" more directly than any hosting comparison table.

Both options need the owner: A needs a network, B needs a repository and a secret. **Neither was run by
the assistant**, because both require credentials or an external account.

Reading the result:

| Result | Meaning | Next step |
| --- | --- | --- |
| `200` from CI or hotspot | the challenge was local; the server path works elsewhere | deploy to any Node host, live mode, no design change |
| `403 challenge` from both | the rule is not about this network | ask the provider to exempt `/clocked/*` (see `.local/support/SUPPORT_EMAIL.md`) before deploying |
| `403` from CI but `200` from hotspot | the rule penalises datacenter egress | deploy behind a residential/office egress you control, or keep the demo simulated |

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
| **Terms that allow a public demo** | some free tiers are personal-use only |

Searched on 2026-10-31; limits change, so re-check before deploying.

| Host | Node + secrets | Request ceiling | Free-tier caveat worth knowing | Fit |
| --- | --- | --- | --- | --- |
| **Vercel Hobby** | Yes: Node runtime, encrypted env vars per environment | 300 s max duration; 4.5 MB request/response payload; 4 CPU-hours/month; 1 M invocations | Free tier is **personal, non-commercial use only**, 100 deployments/day | **Best fit technically.** One project, one variable, no adapter. Read the non-commercial clause against how the demo is presented. |
| **Render — free web service** | Yes | No function-style cap, but the instance sleeps | Free instances spin down when idle; the first request after that is slow | Adequate. A cold start in front of a judge is the whole risk. |
| **Fly.io** | Yes, via `fly secrets` | Configurable, no 60 s problem | Free allowance is small and requires a card; needs a Dockerfile | Adequate; you also choose the region closest to the API. |
| **Cloudflare Workers / Pages** | Yes, with `nodejs_compat` | **Free plan: 10 ms CPU per request** (I/O wait excluded), 100 k requests/day | Next.js on Workers needs the OpenNext adapter, and 10 ms CPU is a real risk for server rendering; the paid plan raises CPU to 30 s | **More work, and possibly paid.** Attractive only because the request would originate inside the same network as the API — which is a hypothesis about the challenge, not a fix. |
| **Railway / Koyeb** | Yes | Generous | "Free" is a trial credit with an expiry | Poor: a demo that dies mid-judging is worse than no demo. |
| **Netlify** | Adapter-dependent | Fine | Next.js support lags the framework release | Weak fit for Next 16 route handlers. |
| **GitHub Pages / any static host** | No server | — | — | **Impossible by design.** No server means no key handling and no screening. |

### 4.1 Recommendation

**If the server-side live path passes** (see §3): Vercel Hobby, one project, `CLOCKED_MODE=live`,
`DAILY_SCREENS=40`, `RATE_LIMIT_REQUESTS=10`. It is the smallest configuration surface, and its Next.js
behaviour is the one the local production build already exercises.

**If it is refused everywhere:** deploy the same build with `CLOCKED_MODE=mock`. The demo is then a
labelled simulation — the banner, the per-stage badges and the export all say so — but a judge can open it,
run the whole workflow, and read the code. A working, honest simulated demo plus recorded live fixtures is
a stronger entry than a link that only works on the author's laptop.

**Never** deploy with a live key and an unbounded daily budget. §5 is the arithmetic.

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

The counters live in process memory. One instance is exact; several instances each keep their own, so the
effective ceiling is `instances × DAILY_SCREENS`. Put a shared limiter at the edge if the host scales out.

## 6. Pre-flight checklist (for whenever the owner authorises it)

1. `npm run verify` — typecheck, lint, unit tests, production build.
2. `npx playwright test` — desktop and mobile flows.
3. `npm audit` — currently 0 vulnerabilities.
4. Confirm the deployment has **no** `NEXT_PUBLIC_*` variable, and that `/api/status` reports the expected
   `mode` without echoing the key.
5. Set `CLOCKED_MODE`, `RATE_LIMIT_REQUESTS` and `DAILY_SCREENS` as in §5, and confirm the values in
   `/api/status`.
6. After deploy, run the three checks **against the deployed URL**, not localhost:

   ```bash
   CLOCKED_BASE_URL=https://<deployment>/api/clocked node scripts/live-acceptance.mjs   # only if such a proxy exists
   curl -s https://<deployment>/api/status | jq
   ```

   There is no proxy route in this app by design — the point of step 6 is to prove the deployed instance
   screens, for example by loading the two one-click examples in a private window and reading the mode
   badge. Until that is done, the deployed instance is unverified however green the build was.

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
