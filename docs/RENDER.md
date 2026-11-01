# Deploying to Render (free web service)

The chosen host, and the reasons in order: it runs a **long-lived Node process** (no function timeout, no
adapter, and the in-memory counters stay exact because a free service is always a single instance), it has
**no non-commercial clause** like Vercel Hobby's, and it needs **no card**. The price is a cold start.

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

## 7. The claim this deployment does *not* make

> Render can host this app ≠ Render can reach the Clocked API.

Measured on 2026-11-01 from two different networks: `curl` and Node are answered with
`403 cf-mitigated: challenge` while Chromium from the same IP gets `200`. The refusal follows the **client**,
not the address, so a datacenter egress is unlikely to change it. The only honest sequence is:

1. deploy with `CLOCKED_MODE=mock`;
2. run `npm run accept:live` from a machine that is not this one (a GitHub runner, or the deployed instance
   itself if a route ever proxies it — this app has none by design);
3. switch to `live` only if step 2 answers `200` with a real verdict. Otherwise the demo stays simulated and
   says so, everywhere, including the export.

## 8. Deploy steps (owner, not the assistant)

1. Create the repository from this one and confirm the secret scan (`RELEASE_CHECKLIST.md` §2).
2. Render → **New → Blueprint**, select the repo; `render.yaml` fills the form.
3. Paste the secrets when prompted (`CLOCKED_API_KEY` at minimum; Redis and Turnstile later).
4. Wait for the build; read the log for the "no open ports" and OOM failure modes in §1–2.
5. `curl -s https://<name>.onrender.com/api/status` — expect `mode: "mock"`, `store`, `turnstile: "off"`,
   `trustProxy: true`.
6. Open the site in a private window: the idle screen, a one-click example, the evidence panel, the export.
7. Re-run step 5 after the service has slept for 15 minutes — this is the cold-start path a judge will hit.
8. Only then decide §7.

## 9. Rollback

Render keeps the two most recent deploys, so a bad build is one click back. Nothing in this app migrates
state, so a rollback is safe by construction.
