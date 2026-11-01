# Deploying to Netlify (free plan)

This is the operating manual for the deployment this project now intends to use. It replaces
`docs/RENDER.md` as the primary path, because Render's Blueprint flow asks for a payment card at creation
and the owner declined — Render's files are kept unchanged in case that changes.

Everything below was read from Netlify's own pricing page and docs on **2026-11-01**, and the build
behaviour was measured locally rather than assumed. Limits change; re-read before deploying.

## 1. What the free plan is

| | Free plan |
| --- | --- |
| Price | $0 forever |
| **Card required** | **No** |
| Commercial use | Allowed — no non-commercial clause, unlike Vercel Hobby (`DEPLOYMENT.md` §4.2) |
| Private repository | Yes, for a personal account. *Organization-owned* private repos are the Pro feature, not this |
| **Monthly allowance** | **300 credits, a hard cap** |
| Overage | None. Add-on credits require turning auto-recharge on, which is off by default — so the failure mode is "the site stops", not "a bill arrives" |
| Functions | Node.js, **60 s synchronous execution limit**, **not configurable**; 1 GB memory; 6 MB buffered request/response |
| Sleeping | **None.** The site is always on — there is no cold start for a judge to wait through |
| Visibility | New projects on a credit-based account start **private** and become public only when published |

The 60 s figure is the important correction. Earlier notes in `DEPLOYMENT.md` recorded 10 s for a free
function from a secondary source; Netlify's "Configuration for functions" page states 60 s and says
explicitly that it is not configurable. Nothing in the transport budget has to shrink.

## 2. The arithmetic: deploys are the scarce resource

Netlify bills the free plan in credits, and the rates decide how this project has to be operated:

| Activity | Rate | What it means here |
| --- | --- | --- |
| **Production deploy** | **15 credits each** | **20 deploys exhaust the whole month** before anything else is counted |
| Bandwidth | 20 credits per GB | a judge visit is well under 1 MB; a thousand visits is a few credits |
| Web requests | 2 credits per 10 000 | a screening is one request; negligible |
| Compute | 10 credits per GB-hour | a screen runs ~2 s at 1 GB, so ~1800 screens per 10 credits |

A working month looks roughly like: **10 deploys (150) + ~1 GB of traffic (20) + 60 live screens a day for
30 days (10)** ≈ 180 of 300 credits. The binding constraint is not traffic and not request rate — it is
**how often the site is pushed to production**.

Operational consequence, and it is the one habit this deployment requires: build and test locally, then push
once. A dozen small pushes during the judging window spends two thirds of the month on changes that were not
worth a deploy.

## 3. Compatibility with this project

### 3.1 Verified locally

`netlify build --offline` was run against this repository on 2026-11-01. The Next.js build completed and the
OpenNext adapter picked the project up correctly:

- the adapter read **`next.config.ts`** (`configOrigin: "next.config.ts"` inside its generated
  `run-config.json`), so Next 16's typed config is understood;
- it forced `output: "standalone"` and produced a server handler entry point for the route handlers;
- it acknowledged `serverExternalPackages: ["clocked-sdk"]`, and `clocked-sdk` is present as a real
  directory in `.next/standalone/node_modules/`.

The run stopped at the adapter's packaging step with `EPERM: symlink` — see §4.6. That is a Windows
privilege boundary, not a project defect.

### 3.2 What runs, and where the ceiling sits

| This project | On Netlify | Verdict |
| --- | --- | --- |
| Next.js 16 App Router | OpenNext adapter, "tested with every Next.js release" per Netlify's docs | ok |
| `app/api/analyze/route.ts` (`runtime='nodejs'`) | one Node function; Route Handlers are listed as full support | ok |
| `app/api/status/route.ts` | same | ok |
| `clocked-sdk` via `serverExternalPackages` | shipped in the function bundle as an external module | ok, and the mock screen after deploy proves it loaded |
| `maxDuration = 120` | the host caps at 60 and ignores the declaration | **changed to 60** (§4.1) |
| 512 KB body cap (`lib/body.ts`) | 6 MB buffered payload limit | ok, app limit is far stricter |
| A screen that takes 0.4–0.8 s per stage | 60 s | ok, ~50× margin |
| Request body read, JSON parse, validation | pure Node in a Node runtime | ok |
| In-memory rate limit | **one invocation, then discarded** | **the real incompatibility** (§4.2) |

### 3.3 Two things that do not transfer from a normal Node server

1. **Process memory is not a store.** A serverless function instance is created for an invocation and
   discarded; there is no process that persists between two requests. Any counter kept in a module-level
   `Map` counts for one request. `lib/admission.ts` and `lib/quota.ts` both had to stop assuming otherwise.
2. **`netlify.toml` is not a runtime configuration file.** Netlify's environment-variable table marks
   values from the configuration file as available to *builds*, and values from the UI/CLI/API as available
   to *functions*. A `TRUST_PROXY = "1"` written in `netlify.toml` is silently absent at request time.
   `netlify.toml` therefore declares only build-scoped values, and §8 lists what the owner must set in the
   UI.

## 4. What changed in the code for this host

| Change | Why |
| --- | --- |
| **4.1** `maxDuration` 120 → 60; per-stage budget 60 s → 45 s | Declaring more than the host allows buys nothing and hides a mismatch: the invocation is killed by the platform with a platform error instead of the route answering with its own structured `timeout` stage result. 45 s + assembly stays inside 60 s. |
| **4.2** new `lib/window.ts`; `admit()` reads the window from Redis when configured | The per-caller window is the only thing that stops one visitor spending the whole day's allowance. In process memory on a serverless host it does not count at all, which does not risk money (the quota still caps spend) but does risk the demo being unavailable when a judge arrives. |
| **4.3** `lib/ratelimit.ts` reads `x-nf-client-connection-ip` when `PLATFORM=netlify` | Netlify's guidance is explicit that `X-Forwarded-For` carries CDN node addresses and must not be used to identify a visitor. Without this, judges are folded into a handful of CDN-node buckets and share windows they never spent. The header is gated on the declared platform because ungated it would be spoofable anywhere else. |
| **4.4** `netlify.toml`, `.netlify/` in `.gitignore` | The build is `npm run build` + `publish = ".next"`; the adapter is left unpinned so Netlify keeps shipping Next 16 support. |
| **4.5** `/api/status` publishes `admission.window` and `admission.platform` | The two settings that are set in the UI, not in the repo, are exactly the two that silently degrade. Publishing them makes the post-deploy check a measurement. |

(a) The window is now charged through Redis only when `UPSTASH_REDIS_REST_*` is set. When it is not, nothing
changes from before: the in-process counter, exact on one long-lived process, which is what local
development and Render Free are.
(b) A Redis failure in the **window** degrades to memory and still serves; a Redis failure in the **quota**
refuses with `503`. That asymmetry is deliberate and documented in `SECURITY_NOTES.md` §14.

### 4.6 The one thing that could not be finished locally

`netlify build` fails on this machine at:

```
EPERM: symlink  .next/standalone/node_modules/clocked-sdk
                → .netlify/functions-internal/___netlify-server-handler/.next/node_modules/clocked-sdk-be0007c4dac46b0e
```

The adapter deduplicates an external package by creating a symlink. Creating a symlink on Windows needs
Developer Mode or administrator rights, and this machine has neither (`New-Item -ItemType SymbolicLink`
fails with "requires administrator privileges"). On Netlify's Linux builder this is an ordinary `fs.cp`
and does not fail. It is recorded here rather than papered over, and §9 step 5 is the check that replaces it.

## 5. Phase 1 — simulated, with no credential on the host

The point of this phase is that it cannot cost credits and has nothing to leak: `CLOCKED_MODE` unset with no
key resolves to the labelled simulator, so the created service holds no secret at all.

`npm run deploy:preflight` with the phase-1 environment reports **8 passed, 0 warnings, READY**.

Run by the owner on 2026-11-01; the result is in §9.1.

## 6. Phase 2 — live, and only after the ceiling is real

Order matters, and on this host it matters even more than on Render, because there is no instance lifetime
to appeal to: **every invocation may be a different instance**, so `DAILY_SCREENS` with a memory counter is
not `instances × limit` in the worst case but *as many screens as there are concurrent invocations*.

| Step | Why this order |
| --- | --- |
| 1. Create the Redis (Upstash free, no card) and set `UPSTASH_REDIS_REST_URL` / `_TOKEN` in the UI | The shared counters must exist before anything can spend |
| 2. Redeploy; `curl /api/status` → `admission.store: "redis"` **and** `admission.window.store: "redis"` | Two counters, two stores; checking one is not checking the other |
| 3. Set `CLOCKED_API_KEY` and `CLOCKED_MODE=live`, and raise `DAILY_SCREENS` (start at 20) | The key is the last thing added, so no window exists where a key is present without a ceiling |
| 4. Redeploy; screen one one-click case | 12–19 credits; the point is `mode` and the stage statuses, not a verdict |
| 5. `X-Daily-Remaining` decreases by one, and **keeps decreasing after a redeploy** | A counter that resets on deploy is not a counter. This is the only check that distinguishes a real ceiling from a decorative one |

**One deploy or two?** The order above is written for a site that is already reachable, where "a key with a
ceiling that is not real" is a window somebody can spend in. While the site is still unpublished that window
has no visitors, so setting all six values in one edit and running §12 step 1 immediately is equivalent and
saves 15 credits. The two-step order becomes the right one the moment the URL is public.

If step 4 returns `Screening unavailable — manual review required`, the service's egress was challenged
too. Switch `CLOCKED_MODE` back to `mock` and say so — the product refuses to fake a verdict, and so should
the deployment.

The exact values, the browser steps and the run sheet are §11 and §12.

## 7. What phase 1 settled, and what is still unproven

Settled on 2026-11-01 by the run in §9.1: the adapter packages this app, `clocked-sdk` resolves inside the
function, a screening completes on the host, and the two runtime-only variables arrived. Three things that
cannot be settled that way remain:

- **Whether Netlify's egress reaches the Clocked API.** The GitHub Actions run proved a Node client from a
  datacenter can (`TEST_REPORT.md` §4.4), which falsified the "non-browser clients are refused everywhere"
  reading — but Netlify's functions run from a different network, and a mock screening never leaves the
  host. Only §12 step 2 answers it.
- **Whether `next.config.ts` header rules survive into a function response.** Netlify documents that custom
  headers do not apply to function-served content, and the adapter generated no header rules for this
  project. The app sets them itself, so §9 step 4 measured it rather than assuming either way.
- **Whether the audit trail and the session trail mean anything here.** They are module-level arrays
  (`lib/audit.ts`), which is exact on one long-lived process and per invocation on this host: after an idle
  gap the trail can be empty while the screening history it should show is not. Nothing security-relevant
  depends on it, but a judge clicking *session trail* may see fewer events than they produced, and that is
  worth knowing before it is mistaken for a bug.

None of the first two can be settled from this machine. Each is a check with a named expected result, and
both cost nothing to run.

## 8. Creating the service (owner, in the browser)

1. `https://app.netlify.com/signup` → sign up **with GitHub**. No card is requested at any point.
2. Authorise the Netlify GitHub App. Choose **Only select repositories** → `trustroute` only. This is
   revocable later from GitHub → Settings → Applications.
3. **Add new project** → **Import an existing project** → **GitHub** → pick `trustroute`.
4. Branch to deploy: **`master`**. Netlify pre-fills build settings from `netlify.toml`; confirm
   Build command `npm run build`, Publish directory `.next`.
5. **Before** clicking Deploy, open **Add environment variables** and add these three (they are not
   secrets, and they must live in the UI because `netlify.toml` values never reach functions):

   | Key | Value | What it does |
   | --- | --- | --- |
   | `TRUST_PROXY` | `1` | allows the CDN's caller-address headers to be believed |
   | `PLATFORM` | `netlify` | selects `x-nf-client-connection-ip` as the caller address |
   | `CLOCKED_MODE` | `mock` | pins the simulator, so a key pasted later cannot quietly start spending |

6. **Deploy**. First build takes 2–4 minutes on 300 build-minutes/month — a deploy is 15 credits of
   allowance, so treat the first build as the one that counts.
7. The project is **private until published**. Netlify will offer a `*.netlify.app` URL; publishing it is
   an explicit step and is what makes it reachable by a judge. Do not publish until §9 passes.

## 9. Verification, in order

1. `curl -s https://<site>.netlify.app/api/status` — expect `mode: "mock"`, `configuredKey: false`,
   `admission.store: "memory"`, `admission.window.store: "memory"`, `turnstile: "off"`,
   **`trustProxy: true`**, **`platform: "netlify"`**. If either of the last two is `false`/`null`, step 5 of
   §8 did not reach the runtime: add the variables in **Project configuration → Environment variables** and
   redeploy.
2. Open the site in a private window: the idle screen loads, a one-click example runs, the **simulated
   mode banner is visible**, the evidence panel and the export work.
3. Screen once and confirm the response carries `X-RateLimit-*` and `X-Daily-Remaining` headers.
4. `curl -sI https://<site>.netlify.app/` and check for `x-frame-options`, `x-content-type-options`,
   `referrer-policy`. **If they are absent**, the adapter did not carry `next.config.ts` headers into the
   function response — record it, and the fix is a `middleware.ts` that sets the same headers, which is a
   separate small change rather than a guess made now.
5. Screen once from a browser and confirm the page does **not** show an SDK import error, which is what a
   missing `clocked-sdk` in the bundle would look like.
6. Re-check `/api/status` after 20 minutes of no traffic: it must answer immediately. Netlify does not
   sleep, and this is the check that proves the difference from Render.

### 9.1 The phase-1 run (2026-11-01, owner)

Three consecutive **Classic prompt-injection** screenings, from the browser, on the deployed site — all
three completed normally. That settles the three things §7 listed as unproven: the adapter packages this
app, `clocked-sdk` resolves inside the function, and a screening completes on the host. It also settles the
two variables that cannot live in a config file: `/api/status` reports `platform: "netlify"` and
`trustProxy: true`, so `PLATFORM` and `TRUST_PROXY` did reach the runtime rather than the build.

One detail worth recording, because a judge will hit it: the first attempt was unreadable until Chrome's
**auto-translate** was switched off for the site. Translation rewrites text nodes, so the evidence panel's
character offsets no longer point at the text they describe — the screening was fine, the view was not. The
standard remedy is `translate="no"` on the document; it is untested here and belongs in its own change
rather than smuggled into a deploy whose purpose is something else.

## 10. Costs, failure modes, rollback

- **A production deploy is 15 credits.** Ten deploys is half the month. Batch changes.
- **Exceeding 300 credits stops the site** until the next cycle. It cannot generate an invoice, because
  auto-recharge is off by default and no card is on file.
- **Rollback** is one click: *Deploys* → pick a previous successful deploy → *Publish deploy*. This does
  **not** create a new build, but treat it as spending the allowance rather than free.
- **Region**: functions default to `cmh` (Ohio) and can be changed in *Project configuration → Build &
  deploy → Functions region*. It is not fixed at creation the way Render's is.
- **TLS, custom domain, deploy previews** are all included; none are needed for judging.


## 11. Enabling live: the exact variables

Live is not a code change — the deployed build already contains the live path. It is five environment
values, one of which is a secret, and one redeploy.

| Key | Value | Secret | Read by |
| --- | --- | --- | --- |
| `CLOCKED_MODE` | `live` | no | `lib/config.ts` — an existing variable, edited rather than added |
| `CLOCKED_API_KEY` | the rotated key | **yes** | `lib/clocked/` — never sent to the browser |
| `UPSTASH_REDIS_REST_URL` | `https://<name>.upstash.io` | treat as one | `lib/redis-rest.ts` |
| `UPSTASH_REDIS_REST_TOKEN` | the database token | **yes** | `lib/redis-rest.ts` |
| `DAILY_SCREENS` | `20` | no | `lib/config.ts` — the money ceiling |
| `RATE_LIMIT_REQUESTS` | `10` | no | `lib/config.ts` — per caller per 5 min |
| `TRUST_PROXY`, `PLATFORM` | `1`, `netlify` | no | already set during phase 1; do not touch |

Do **not** add `TURNSTILE_*`. §13 says why, and the short version is that the shipped bundle has no widget,
so switching the gate on refuses every screening with `403 challenge_required`.

Where to put them matters, and the reason is not obvious:

- **The UI, not `netlify.toml`.** A value in the config file reaches the build; only a value in the UI
  reaches the function at runtime. A `DAILY_SCREENS` in `netlify.toml` would silently do nothing.
- **Scopes are a Pro feature**, so on the free plan a variable applies to all scopes and there is nothing to
  tick. Adding it is enough.
- **A config-file value overrides the same key in the UI.** Nothing in `netlify.toml` uses these names
  (`NODE_VERSION` and `NETLIFY_NEXT_SKEW_PROTECTION` are the only two), so there is no collision to worry
  about — but adding one later would silently win.

Before the redeploy, check the intended environment with the audit that reads it:

```bash
# the values, minus the two secrets, are enough to catch the mistakes that matter
CLOCKED_MODE=live CLOCKED_API_KEY=<key> DAILY_SCREENS=20 RATE_LIMIT_REQUESTS=10 TRUST_PROXY=1 PLATFORM=netlify UPSTASH_REDIS_REST_URL=<url> UPSTASH_REDIS_REST_TOKEN=<token> npm run deploy:preflight
```

Expected: **`READY WITH CAVEATS`**, the single caveat being `turnstile`. A `FAIL quota_store` means one of
the two Redis variables is missing in the environment being checked — on the host that is exactly the state
that silently spends money, so it is a hard stop rather than a warning.

**The cap, chosen rather than defaulted.** `DAILY_SCREENS=20` is 240–380 credits a day at 12–19 credits a
screen. Against a 10,000-credit balance that is 26–41 days; against 20,000 it is 52–83. A live default of 60
would be 720–1,140 a day — inside a three-week judging window that is most of a 20,000-credit balance spent
on curiosity clicks. The cap can be raised later; it cannot be un-spent.

## 12. The live acceptance run

`scripts/deployed-check.mjs` exists for this. It reads `/api/status` and asserts what the deployment *says*
against what the phase expects, and it spends nothing unless `--screen` is passed.

```bash
npm run check:deployed -- https://<site>.netlify.app --live            # free: status only
npm run check:deployed -- https://<site>.netlify.app --live --screen   # one screening, 3 real calls
```

Run in this order, and stop at the first failure.

| # | Step | Expected | What a deviation means |
| --- | --- | --- | --- |
| 1 | `--live`, read-only | 7–8 `PASS`, one `WARN turnstile` | `FAIL mode` → `CLOCKED_MODE` never reached the function; `FAIL quota_store` or `window_store` → the Redis pair did not; `FAIL platform` → `PLATFORM` did not |
| 2 | `--live --screen` | `200`, three stages `ok`, `daily left` = 19 when 20 is the cap, credits reported | `503 quota_unavailable` → Redis is configured but unreachable, nothing was screened; `403 challenge_required` → a `TURNSTILE_*` variable was set; `200` with `decision` that says unavailable → the host's egress is challenged (§12.1) |
| 3 | Upstash console → **Data Browser** → search `trustroute:quota:` | the key for today's UTC date, value `1`, a TTL counting down to midnight | no key at all = the counter is in memory and `--screen` was charged to a ceiling that does not exist |
| 4 | Wait ≥ 15 min with no traffic, run `--screen` again | `daily left` = 18 | 19 again = a fresh instance started from zero, i.e. memory |
| 5 | Same console, `trustroute:win:` | one key per caller, expiring in ≤ 5 min | absent = the per-caller window is per invocation and therefore not counting |

Steps 2 and 4 spend 12–19 credits each. **Step 3 is the one that proves durability** and costs nothing:
a memory fallback cannot create a key in somebody else's database. Step 4 proves the same thing from the
outside, which is why it is worth the second screening — it is the only evidence a reader can reproduce
without access to the store.

### 12.1 If step 2 reports itself unavailable

`policy.screening === "unavailable"` means the detectors did not answer — the edge challenged the host, the
same way it challenged this machine (`API_INTEGRATION.md` §6.3). The product refuses to fake a verdict, and
so should the deployment: set `CLOCKED_MODE=mock`, redeploy, and the site is honest again. Keep the mock
deployment and attach the run to the provider escalation; do not retry it hoping for a different answer.

### 12.2 Fail-closed, measured rather than asserted

The one test that cannot be run against the live site without breaking it is "what happens when Redis is
gone" — so it was run locally, on the real route, on 2026-11-01:

| Environment | Request | Result |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL=http://127.0.0.1:9` (nothing listening) | valid body | **`503 quota_unavailable` in 17 ms**, nothing screened, no credits |
| same | empty `text` | `400 invalid_input` — and the counter is not reached, because it is charged after validation |
| no Redis variables | valid body | `200`, served from the in-process counter |

17 ms matters: a refused connection fails immediately, so an outage does not turn into a 3-second hang per
request followed by a 60-second function kill. And the `503` is a refusal rather than a fallback — an
unreadable budget is treated as no budget, which is the only defensible reading when the spend is on
somebody else's account.

## 13. Turnstile: why it stays off for the first live window

**The gate cannot be switched on today**, and this is a fact about the build rather than a preference: the
browser never sends `x-turnstile-token` (`components/Workbench.tsx` posts four fields and no header), so
`TURNSTILE_ENABLED=true` would make `verifyTurnstile` answer `missing_token` for every request and the route
would return `403 challenge_required` before anything was read. Every judge would see a refusal.

What that leaves, honestly:

| Gate | What it stops | What it does not |
| --- | --- | --- |
| Same-origin check | a stranger's page triggering a screening in a visitor's browser | anything with no `Origin` header — `curl` is accepted on purpose, so operational checks work |
| Per-caller window, in Redis | one visitor in a loop | a script that rotates addresses, and it is 10 per 5 min, not 10 a day |
| Daily quota, in Redis | the bill | nothing — but it is spent by the first caller to arrive, so a bot can take the whole day from the judges |
| `DAILY_SCREENS=20` | the size of that loss | the loss |

So the risk of shipping without Turnstile is **availability, not money**: the worst case is one day's cap
(240–380 credits) spent by something that is not a judge, and a judge who then reads "this demo has used its
screening allowance for today" — which is true, specific, and not a fake verdict.

Three things make that acceptable for the first window, and all three are already in place:

1. **The cap bounds the damage** at one day's worth, and it resets at UTC midnight rather than needing
   intervention.
2. **The kill switch is one variable.** `CLOCKED_MODE=mock` plus a redeploy returns the site to a fully
   usable, zero-cost demo in about three minutes. That is the answer to abuse, and it costs 15 credits.
3. **The site can stay unpublished** until the entry is submitted, so the exposure window starts when the
   owner chooses it.

**Revisit it if any of these happen**, and not before: the day's cap is exhausted before the first judge is
expected; the `trustroute:quota:` value rises by double digits inside a few minutes; or credits fall with
no matching human sessions in the site's own analytics.

Enabling it later is a small, contained change — a `Turnstile` component that loads
`https://challenges.cloudflare.com/turnstile/v0/api.js`, one `x-turnstile-token` header on the existing
`fetch` in `components/Workbench.tsx`, the public site key added to the `/api/status` payload (the app reads
it but does not publish it), and then `TURNSTILE_ENABLED=true` with `TURNSTILE_SECRET` in the UI. It is a
deploy, so it is not free: batch it with the next change that has to happen anyway.
