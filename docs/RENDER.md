# Deploying to Render (free web service)

> **Superseded on 2026-11-01, kept for reference.** Creating the Blueprint now prompts for a payment card
> before the service is provisioned, and the owner declined to bind one, so this path is blocked at step 1
> for a reason that has nothing to do with the code. **`docs/NETLIFY.md` is the current plan.**
>
> Nothing in this file was made false by that: the limits, the ephemeral-filesystem consequence, the health
> check and the cold-start analysis are all still accurate and still the reference if a card is ever bound.
> `render.yaml` is untouched.

The chosen host, and the reasons in order: it runs a **long-lived Node process** (no function timeout, no
adapter, and the in-memory counters stay exact because a free service is always a single instance), it has
**no non-commercial clause** like Vercel Hobby's. The price is a cold start.

Everything below was checked against Render's own documentation on **2026-11-01**:
<https://render.com/docs/free> and <https://render.com/docs/web-services>. Limits change; re-read them
before the deploy.

---

## 1. What the free plan actually gives, and which limits bite here

| Limit | Render's number | What it means for TrustRoute |
| --- | --- | --- |
| Instance hours | 750 / month per workspace, shared | one service running 24/7 is 720 h — it fits, with nothing to spare. A spun-down service does **not** consume hours |
| RAM | 512 MB | `next build` in 512 MB is the tight spot, not runtime. If the build is killed, set `NODE_OPTIONS=--max-old-space-size=460` |
| CPU | a fraction of a core | the app is I/O-bound (three API calls); fine |
| Bandwidth | 100 GB / month | a text-screening demo will not come close |
| Build minutes | 500 / month | a Next build here takes ~90 s, so ~300 builds. Not a constraint |
| Sleep | spins down after **15 min with no inbound traffic**; wakes in about **1 min** | the real cost. Render shows its own loading page to a browser while spinning up, so a judge sees "starting", not a dead link |
| Instance count | **one** — free services cannot scale out | this is a benefit here: the per-window and concurrency counters are exact |
| Filesystem | **ephemeral** — wiped on redeploy, restart *and spin-down* | the daily counter and the audit trail reset every time the service sleeps. This is exactly why `lib/quota.ts` moves the day counter to Redis when one is configured |
| Outbound ports | 25/465/587 blocked | irrelevant: Clocked is HTTPS |
| Service-initiated traffic | Render *may suspend* a free service that makes an uncommonly high volume of outbound requests | the reason `DAILY_SCREENS` stays at 40 rather than 400. Outbound traffic is unsolicited-looking API calls by design |
| Reserved ports | 18012, 18013, 19099 | not used |
| Terms | *"Do not use them for production applications."* Free is framed as preview/hobby | a judged demo is exactly the preview case. There is no non-commercial clause; the wording is guidance, not a licence restriction, but it does mean "production" claims would be overstated |

## 2. Build, start, port

```bash
npm ci && npm run build          # build command
npx next start -H 0.0.0.0 -p $PORT   # start command
```

- Render forwards traffic to `$PORT`, default **10000**, and the server **must** bind `0.0.0.0`. The `-H`
  flag is not optional: `next start` otherwise binds only the loopback interface and the deploy fails with
  "no open ports detected".
- `next start` needs `.next/` from the same build; there is no separate build artefact step.
- No database, no disk, no writable path: the app writes nothing except in-memory maps, so the ephemeral
  filesystem costs nothing.

`render.yaml` at the repository root encodes all of this, so the dashboard form is not the source of truth.

## 3. Environment variables

| Variable | Value on Render | Why |
| --- | --- | --- |
| `NODE_VERSION` | `22` | Next 16 requires Node ≥ 20; 22 is what every test ran on |
| `CLOCKED_MODE` | `mock` first, `live` later | simulated until a non-browser client is proven to reach the API |
| `CLOCKED_API_KEY` | secret, set in the dashboard | never in the repository, never in `render.yaml` |
| `RATE_LIMIT_REQUESTS` | `10` | 10 screens / 5 min / caller |
| `DAILY_SCREENS` | `40` | whole-deployment day ceiling; 40 × 12 credits ≈ 480 credits/day worst case |
| `TRUST_PROXY` | `1` | Render's load balancer writes `x-forwarded-for`; without this the site collapses into 64 fairness buckets |
| `CLOCKED_TIMEOUT_MS` | `25000` (optional) | the SDK default is 30 s; Render's own proxy waits longer than that, so the client should give up first |
| `TURNSTILE_ENABLED` / `_SITE_KEY` / `_SECRET` | off until the widget ships | see §5 — enabling the server gate without the widget refuses every screening |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | empty until an account exists | see §4 |

Nothing else is required. `/api/status` echoes `mode`, the limits, the store, the gate state and
`trustProxy`, and never the key — check it after every deploy.

## 4. What the ephemeral filesystem costs, and the fix

On a sleeping or redeploying free instance the process is gone, so:

- the day's spent counter returns to zero (**more budget than intended**),
- the per-caller window and concurrency map are empty,
- the audit trail is empty (it is a session trail, and the UI says so).

The first item is the one that spends money. Two options, in order of effort:

1. **Accept it, with a small ceiling.** `DAILY_SCREENS=40`. Worst case, a service that sleeps every 15
   minutes could hand out 40 per wake — which is why the Turnstile gate in §5 matters more than the
   counter on this host.
2. **Move the counter to Redis** (`lib/quota.ts`, already implemented and tested): set
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, and the daily ceiling becomes atomic, shared
   and restart-proof. It **fails closed** — if Redis cannot answer, screening is refused with `503`
   rather than allowed.

## 5. Turnstile: server side is ready, the widget is not

`lib/turnstile.ts` verifies a token with `siteverify`, refuses replays (in-memory, or Redis `SET NX` when
Redis is configured), and treats an unreachable verifier as a refusal. It is **off by default**.

Turning it on is a two-step change, and doing only the first step breaks the demo:

1. Render the widget in the client and send the token as `x-turnstile-token` on `/api/analyze`.
   *(not done — it adds a third-party script and a public site key to the page)*
2. Set `TURNSTILE_ENABLED=true`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`.

Until step 1 exists, leaving `TURNSTILE_ENABLED=false` is the only correct setting; `/api/status` reports
`turnstile: "off"` so this cannot be mistaken for a protected deployment.

## 6. Health check and cold start

- **Health check path:** `/api/status`. It is a `GET` that always answers `200`, does no I/O beyond reading
  environment variables, and is deliberately public. It is *not* a liveness proof for the Clocked path —
  that is what `npm run accept:live` is for.
- **Cold start:** ~1 min after 15 min idle. Render serves its own loading page to a browser, so the first
  visitor sees "service is starting" rather than a timeout. In practice: open the link yourself a minute
  before a judging window, or accept that the first judge waits.
- **Do not keep it awake with a pinger.** A cron ping consumes instance hours (750 is exactly one month of
  24/7) and defeats the tier's purpose.

## 7. What is now measured, and the one thing still unknown

Until 2026-11-01 the honest claim was: *Render can host this app ≠ Render can reach the Clocked API.*

That gap is half closed. From this machine, `curl` and Node were answered with `403 cf-mitigated: challenge`
while Chromium from the same address got `200`, and the conclusion drawn at the time — "the refusal follows
the client, so a datacenter egress is unlikely to change it" — **was wrong**. A GitHub-hosted runner is a
non-browser client on someone else's network, and it was answered normally.

| | Local machine (2026-11-01) | GitHub-hosted runner (2026-11-01) |
| --- | --- | --- |
| Client | Node `clocked-sdk` | Node `clocked-sdk` — the same shape |
| Egress | home / mobile carrier | datacenter (`cf-ray …-MSP`) |
| Result | `403 cf-mitigated: challenge` | **`200`, real verdicts, 12 credits for three calls** |

So the refusal is about *this machine's path to the host*, not about server-side clients. Full record:
`TEST_REPORT.md` §4.4.

**Still unknown:** Render's own egress. A runner is not a Render instance — different network, different
address, and three detections run in parallel on a 0.1-CPU dyno. That is one real screen away from being
known (§7.3), and it costs 12–19 credits to find out.

### 7.1 What cannot be used for the test

| Idea | Why it does not work |
| --- | --- |
| Render **Shell** | Free instances have **no shell and no SSH** (Render's own comparison tables say so). Paid instances only. |
| Render **one-off job** | Not available on the free compute plan; one-off jobs are a paid feature. |
| A **probe route** in this app (`/api/probe`) | A public endpoint that spends credits on demand is the exact thing §4–5 exist to prevent. Not added, and it should not be. |
| A **public** repo or a public demo just to test | Publishes the project before the owner has decided to, and answers nothing that a private runner does not. |

### 7.2 How the question was answered (done, and repeatable)

`.github/workflows/live-check.yml` does one thing: three real calls through `clocked-sdk` from a stock
`ubuntu-latest` runner — no deployment, no browser, no public URL. A **private** repository is enough;
private repositories get 2,000 Actions minutes a month on the free plan and this job uses under one. What
was actually done, in order, entirely inside GitHub:

1. **Create the repository as private.** `github.com/new` → name `trustroute` → **Private** → no README.
2. **Push this local repository to it**: `git remote add origin https://github.com/<account>/trustroute.git`
   then `git push -u origin master` — this repository's branch is `master`, not `main`.
3. **Add the key as a repository secret**: Settings → Secrets and variables → Actions → *New repository
   secret* → name `CLOCKED_API_KEY`. The workflow passes it as an environment variable to a script that
   never prints it.
4. **Run it**: Actions → *live-check* → *Run workflow*.
5. **Read the artifact**: `live-acceptance.json` (retained 7 days) has, per endpoint, the HTTP status,
   latency, response type, classification, credits, `cf-ray`/`cf-mitigated` and the verdict.

Two things learned the hard way, worth keeping:

- The workflow did **not** appear in the Actions tab until a second push touched the file, even though it was
  present on the default branch from the first push. A brand-new repository does not always index
  `.github/workflows` on its first push. Check `GET /repos/{owner}/{repo}/actions/workflows` — `total_count:
  0` means "not indexed", not "misconfigured".
- `concurrency: live-check` is in the file so a double click on *Run workflow* queues rather than spending
  the credits twice.

Reading the result — the same table as `DEPLOYMENT.md` §3:

| Artifact says | Meaning | Next |
| --- | --- | --- |
| three `answered` rows, `200` — **this is what happened** | a datacenter egress reaches the API | the question moves to Render itself: §7.3, then §10 |
| `edge_challenge` again | the rule is not about a particular network — it applies to non-browser clients generally | keep the public demo simulated; the provider escalation (`API_INTEGRATION.md` §6.4) is the only path |
| `timeout` / `connection_error` | that runner could not open a connection | re-run once; if it repeats, the runner's egress is filtered and the result says nothing about Render |
| `auth_failed` / `forbidden` | the key, not the edge | fix the secret, do not touch the network |

Beyond its verdict, the run proved that the **key works from a machine that is not this one** (a rotation
that broke something shows up here), and it produced a dated artifact that can be attached to the provider
escalation if one is ever needed.

### 7.3 The in-service proof: one screen, after the ceiling is real

A passing workflow does not prove *this service* passes — different host, different egress, and a free
instance has a fraction of a core. The only in-service proof is a real screen — but it must not be the first
thing a live deployment does. Two preconditions, both cheap, both reversible:

1. **The mock deploy works** (§8 phase 1): the site loads, a one-click case runs, `/api/status` says
   `mode: "mock"` and `configuredKey: false`.
2. **The day ceiling is shared and holds** (§10): `/api/status` reports `admission.store: "redis"`, and the
   counter survives a restart. Without this, "live" means the ceiling resets every time the service sleeps.

Then, and only then:

3. In the dashboard add `CLOCKED_API_KEY`, set `CLOCKED_MODE=live` and `DAILY_SCREENS=20`, and deploy.
4. `curl -s https://<name>.onrender.com/api/status` → `mode: "live"`, `admission.store: "redis"`.
5. Open the site in a private window and screen **one** one-click example. Three outcomes, all informative:
   - **PASS/REVIEW/BLOCK with real numbers** → the deployment works; keep it, and raise `DAILY_SCREENS` to
     the number §10 justifies.
   - **`Screening unavailable — manual review required`** → the service was challenged too. Switch back to
     `mock` immediately; the product already refuses to fake a verdict.
   - **`503 not_configured`** → the key is missing or malformed on the host; `deploy-preflight` names which.
6. Spend at most one screen on this. 12–19 credits; the point is the `mode` and the stage statuses, not a
   verdict.

## 8. Deploy steps (owner, not the assistant)

Render deploys from a **private** repository too, so the repository from §7.2 serves both the connectivity
test and the deployment. **None of this has been done** — it is the sequence to follow, written so that the
first deployment cannot expose the key.

### Phase 1 — simulated, with no secret on the host

`render.yaml` deliberately declares **no secret** in this phase. The mock needs no key, and a deployment that
was never given one cannot leak one.

1. Render dashboard → **New +** → **Blueprint** → connect GitHub → choose `AIcoder123-a/trustroute` →
   **Connect**. (A first-time Render account may ask to install the GitHub App on that one repository only.)
2. The next screen is filled from `render.yaml` and asks for **nothing**: name `trustroute`, plan **Free**,
   branch `master`, build `npm ci && npm run build`, start `npx next start -H 0.0.0.0 -p $PORT`, health
   check `/api/status`.
3. **Apply** / **Create Web Service**. First build is 2–4 minutes on a free instance.
4. If the build dies with `Killed` or a heap error, add `NODE_OPTIONS=--max-old-space-size=460` (§1).
5. `curl -s https://<name>.onrender.com/api/status` → expect `mode: "mock"`, `configuredKey: false`,
   `admission.store: "memory"`, `turnstile: "off"`, `trustProxy: true`.
6. Open the site in a private window: idle screen, one-click case, evidence panel, export.
7. Re-run step 5 after 15 minutes idle — that is the cold-start path a judge will hit.

### Phase 2 — live, and only after §10

8. Add the Redis pair in the dashboard (**Environment** → *Add Environment Variable*), confirm
   `admission.store: "redis"`, then restart and confirm the counter survived (§10).
9. Add `CLOCKED_API_KEY`, set `CLOCKED_MODE=live` and `DAILY_SCREENS=20`, and deploy.
10. Run the one-screen proof in §7.3.

### Things that will otherwise waste an afternoon

- `autoDeploy: false` is set in `render.yaml`, so **a push does not redeploy**. After pushing, use
  **Manual Deploy → Deploy latest commit**. This is deliberate: a doc commit should not rebuild a service
  that is mid-judging.
- Free services sleep after 15 minutes idle and take about a minute to wake. Render shows its own loading
  page, so a judge sees "starting", not a dead link — but open the link yourself a minute before a judging
  window.
- Environment variable changes restart the service; a restart wipes the in-memory counters (§4). That is the
  reason §10 exists.
- Render keeps the two most recent deploys, so any bad phase-2 change is one click back (§9).

## 9. Rollback

Render keeps the two most recent deploys, so a bad build is one click back. Nothing in this app migrates
state, so a rollback is safe by construction.

## 10. Before opening live to judges: make the ceiling real

A live public demo is a URL that spends the account's credits. Four controls stand in front of it. Three of
them live in process memory, and a free instance's process is **not durable** — it is destroyed on redeploy,
on restart, and on every 15-minute sleep. So the question is not "are the controls configured" but "which of
them still mean something after the process is gone".

| Control | Where | On a free Render instance |
| --- | --- | --- |
| Request body cap, 512 KB | `lib/body.ts` | stateless — always holds |
| Per-caller window, 10 per 5 min | `lib/ratelimit.ts` | in memory: resets on restart; and only meaningful with `TRUST_PROXY=1` |
| Concurrency, 2 per caller | `lib/admission.ts` | in memory: same caveat |
| **Day ceiling** (`DAILY_SCREENS`) | `lib/quota.ts` | **in memory it resets on every wake — this is the one that spends money** |

Reading that honestly: with no Redis, "40 screens a day" is really "40 screens per process lifetime", and a
service that sleeps every 15 minutes can hand out 40 again on every wake. The per-caller limits do not save
you, because they are per caller, and the ceiling is the only control that bounds a crowd.

### The one prerequisite: a shared counter

1. Create an Upstash Redis database — free tier, **no card**. Copy the REST URL and REST token.
2. Render → **Environment** → add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Save; the service
   restarts.
3. `curl -s https://<name>.onrender.com/api/status` → `admission.store: "redis"`,
   `admission.sharedAcrossInstances: true`.

The code **fails closed** here on purpose: if Redis cannot answer, screening is refused with `503
quota_unavailable` and `Retry-After: 30` rather than allowed. A demo that is briefly down is a nuisance; a
demo that silently loses its ceiling is the failure this section exists to prevent.

### Three checks that prove it, not three that merely show it

1. **Store.** `/api/status` says `store: "redis"`.
2. **It moves.** Screen once; the `X-Daily-Remaining` response header is one lower than before.
3. **It survives.** Restart the service (or let it sleep 15 minutes, then wake it), and screen again. The
   header must continue from where it was — **not** jump back to the configured ceiling. This is the only
   check that distinguishes a real shared ceiling from an in-memory one.

### Sizing the number

A screen costs 12–19 credits (`TEST_REPORT.md` §4.4 measured 12 for a three-endpoint screen). If the judging
window is seven days:

| `DAILY_SCREENS` | Worst case over 7 days | Comment |
| --- | --- | --- |
| 40 | ≈ 3,400 credits | comfortable against a 20,000 balance, and leaves room for re-tests |
| 20 | ≈ 1,700 credits | the value §7.3 starts with; raise it once the deployment is proven |
| 60 (default in live) | ≈ 5,000 credits | only if the balance can absorb it |

### What is still missing, and why it is acceptable for now

There is **no human-check widget**. `lib/turnstile.ts` verifies tokens server-side, but the browser half is
not written (§5), so `TURNSTILE_ENABLED=false` and `/api/status` says `turnstile: "off"`. Without it, a bot
can spend the day's ceiling instead of a person spending a fraction of it. The ceiling bounds the damage;
Turnstile would make the damage smaller. That is the honest trade, and it is why `DAILY_SCREENS` stays low
rather than "as high as the balance allows".
