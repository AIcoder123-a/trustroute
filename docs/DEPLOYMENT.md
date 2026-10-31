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

## 4. Free hosting, ranked for this specific app

Assessed against what the app needs, not against generic five-star reviews. Prices and limits change;
re-check before committing.

| Host | Fits this app? | Notes |
| --- | --- | --- |
| **Vercel (Hobby)** | Best fit | First-party Next.js 16 support, secret env vars, 300 s function default on Hobby. Free tier is non-commercial — fine for a public demo, read the terms. Egress is datacenter. |
| **Cloudflare Workers / Pages** | Possible, more work | Needs the `nodejs` runtime compatibility flags and an adapter for the Node SDK; request body limit is smaller than our caps; egress is inside the same network as the challenge. |
| **Render (free web service)** | Adequate | Node runtime, secrets, sleeps after idle (cold start ~30 s, which is longer than a reviewer's patience). |
| **Fly.io** | Adequate | Free allowance is thin, needs a Dockerfile, allows choosing a region close to the API. |
| **Railway / Koyeb** | Trial credit | Works, but "free" is time-limited; a demo that dies mid-judging is worse than no demo. |
| **Netlify** | Weak fit | Next.js adapter lags; route handlers need functions config. |
| **GitHub Pages / any static host** | **No** | There is no server, so no key handling and no screening. This app cannot be exported statically by design. |

**Recommendation if the live path works:** Vercel Hobby, one project, one environment variable,
`CLOCKED_MODE=live`, `RATE_LIMIT_REQUESTS=20`. It is the smallest configuration surface and the only one
where the Next.js behaviour on the host matches the behaviour measured locally.

**Recommendation if the live path is refused everywhere:** deploy anyway, but with
`CLOCKED_MODE=mock` and the banner the app already renders — a demo that says what it is beats a demo
that fails with a red error box, and beats a repository that can only be run locally.

## 5. Pre-flight checklist (for whenever the owner authorises it)

1. `npm run verify` — type, lint, 101 unit assertions, build.
2. `npx playwright test` — 24 browser assertions, desktop + mobile.
3. `npm audit` — currently 0 vulnerabilities.
4. Confirm the deployment has **no** `NEXT_PUBLIC_*` variable and that `/api/status` reports
   `configuredKey: true` without echoing the key.
5. Set `RATE_LIMIT_REQUESTS` to the demo allowance (20 per 5 minutes) and put the URL behind a
   Cloudflare rate-limit rule if it will be public for a week.
6. After deploy, run the three checks against the deployed URL — not against localhost — and paste the
   response headers into `docs/API_INTEGRATION.md` §6.2. Until that exists, the deployed instance is
   unverified no matter how green the build was.

## 6. Delivery strategy: three tiers, and what each one is worth

| Tier | What runs live | What the submission can claim |
| --- | --- | --- |
| **A — three endpoints live** | Guard, Protect, Inspect all return real Clocked results in the demo | The full claim: "screens untrusted content with three Clocked detections". This is the target. |
| **B — one or two endpoints live, the rest explicitly unavailable** | e.g. Guard + Protect live, Inspect shown as unavailable with the reason | A narrower but true claim. The interface must say *which* detection is live, per stage, and the decision must degrade to REVIEW when a required stage is missing — which it already does by construction. |
| **C — simulated only** | nothing | **Not a completed submission.** It demonstrates the workflow and the policy engine, and the recorded live fixtures prove the integration was built against real responses, but "we call the Clocked API" cannot be said about the running demo. This is a fallback for a deadline, not a goal. |

The product supports all three without code changes: `CLOCKED_MODE` decides the transport, and every
stage carries its own `mode`, so a partial deployment is representable — a live Guard card next to a
failed Protect card with the real error is exactly what the interface is built to show. What it will not
do is pretend: there is no code path that substitutes a simulated result for a failed live one.
