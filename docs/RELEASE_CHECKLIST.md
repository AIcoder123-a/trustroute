# Release checklist

Everything between "the code works" and "a judge can open the link". Ordered, because most of these steps
are cheap now and expensive after the repository is public.

The commands assume the repository root. Nothing here pushes, deploys or spends money on its own — the
steps marked **owner** need the account holder's decision or credentials.

---

## 0. Decisions only the owner can make

| # | Decision | Why it blocks the release | Default if undecided |
| --- | --- | --- | --- |
| 0.1 | Repository name, owner account, public or private | the rules require a **public** repository with setup instructions and development history | a public repo named `trustroute` under the entrant's account |
| 0.2 | Licence | the rules require **no particular licence** (see `COMPETITION_RULES.md` §5.2); a repo with no licence is "all rights reserved" by default | state the choice in `README.md` rather than leaving it implicit |
| 0.3 | Which `docs/` files ship publicly | `SUBMISSION_DRAFT.md`, `COMPETITION_RULES.md` and this file are working notes; the rules only ask for README + setup + history | ship them (they are honest and contain no key), or move them out before the first push |
| 0.4 | Demo host, and whether it runs **live** or **simulated** | a live public demo spends the account's credits; a simulated one cannot be mistaken for a verdict if the banner is up | deploy simulated first, switch to live only after `accept:live` succeeds from the host's own egress |
| 0.5 | Whether to wire the Wise question to the organiser | prize payment to a mainland-China recipient is unverified (`COMPETITION_RULES.md` §3.1) | ask before the entry is final |

## 1. Pre-flight on the machine

```bash
npm run verify                  # typecheck, lint, 132 assertions, production build
npx playwright test             # 46 runs: 44 passing, 2 deliberate skips
npm run accept:live             # live status, shape, verdict, data source — or the refusal
```

- [ ] `verify` exits 0 with no lint warning
- [ ] Playwright: 0 failures, and the 2 skips are the documented ones
- [ ] `accept:live` output is saved with the commit id it was run against (`docs/API_INTEGRATION.md` §6.3)
- [ ] `git status` is clean apart from intentional changes

## 2. Secret scan before the first push

Run these locally. They print file names, never values.

```bash
# the key must not exist anywhere in the working tree
PREFIX=$(grep '^CLOCKED_API_KEY=' .env.local | cut -d= -f2- | tr -d '\r\n' | cut -c1-8)
git grep -lIF -- "$PREFIX" -- . ':!node_modules' ':!package-lock.json' || echo "working tree: clean"

# nor in any commit on any branch (local only, nothing leaves the machine)
git log -p --all -- . ':!package-lock.json' | grep -cF -- "$PREFIX"

# .env.local must never have been tracked
git log --all --oneline -- .env.local .env | head
```

- [ ] No hit in the working tree, no hit in history, `.env.local` never tracked
- [ ] `.gitignore` still covers `.env*`, `.next/`, `.local/`, `test-results/`, `playwright-report/`
- [ ] `.env.example` carries empty values only, and no real hostname or account id
- [ ] `README.md`, `docs/*.md` and every screenshot are free of keys, tokens, emails and personal data
- [ ] The key in `.env.local` is the one that stays local; the deployed value is set in the host's
      environment, **never** as `NEXT_PUBLIC_*` (that prefix would inline it into the browser bundle)
- [ ] If any of the above ever failed, rotate the key at `clocked.rezolve.ai` before pushing

## 3. What the repository must contain

- [ ] `README.md` — what it is, the three endpoints, one-command run, screenshots, honest limitations
- [ ] `LICENSE` or an explicit statement of terms (§0.2)
- [ ] `.env.example` and the setup steps a stranger needs: `npm install`, `cp .env.example .env.local`,
      `npm run dev` → `http://localhost:3100`
- [ ] The development history: the rules ask for it, so do not squash the repository to a single commit
- [ ] `docs/` consistent with the code it ships with — a stale claim in a doc is a wrong claim
- [ ] No `.next/`, `node_modules/`, `test-results/`, `.local/`

## 4. Deploying the demo (see `DEPLOYMENT.md`)

- [ ] Host chosen on measured grounds, not popularity: function duration, payload cap, CPU budget, terms
      that permit the use, and a way to cap spend
- [ ] Environment set in the host's dashboard: `CLOCKED_MODE`, `CLOCKED_API_KEY`, `DAILY_SCREENS`,
      `RATE_LIMIT_REQUESTS`; nothing prefixed `NEXT_PUBLIC_`
- [ ] `DAILY_SCREENS` chosen against the balance: a live screen costs 12–19 credits, so 60/day is ~1,000
      credits/day at worst — size it for the judging window (Nov 11–17), not for a single demo
- [ ] Preview deployments either share the key deliberately or are disabled; a preview URL is public too
- [ ] `CLOCKED_MODE=mock` for the first deploy, so a wrong turn costs nothing

## 5. After the first deploy, from outside the machine

```bash
curl -s https://<demo-host>/api/status            # mode, configuredKey, limits — no key material
curl -sI https://<demo-host>/ | grep -iE 'strict-transport|content-type-options|frame-options|cross-origin'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<demo-host>/api/analyze \
  -H 'origin: https://evil.example' -H 'content-type: application/json' -d '{"text":"hi"}'
```

- [ ] `/api/status` reports the intended mode and a plausible daily ceiling
- [ ] Security headers present: HSTS, `nosniff`, `X-Frame-Options: DENY`, COOP/CORP `same-origin`
- [ ] A cross-origin POST is refused with `403 cross_origin_blocked`, and the response carries **no**
      `Access-Control-Allow-Origin` header
- [ ] One real screen returns `X-Daily-Remaining` one lower than before it
- [ ] The last request of the daily budget returns `429` with a readable message — test this on a
      throwaway deployment, not on the one the judges will open
- [ ] Oversized body → `413`; empty text → `400`; both say nothing was screened
- [ ] The failure state is reachable and honest: with the edge refusing, the app says
      *Screening unavailable — manual review required*, never PASS (`docs/SCREENSHOTS.md` §2)
- [ ] `npm run accept:live` from a machine that is not this one, to learn whether the host's egress is
      challenged too (`DEPLOYMENT.md` §6)

## 6. The demo link

- [ ] Opens without a login, a cookie banner or a modal
- [ ] Public, and stays public through **18 November 2026** (`COMPETITION_RULES.md` §5.2)
- [ ] The mode banner is visible on first paint, before any content is loaded
- [ ] One demo case screens in under three seconds on a normal connection
- [ ] Works in a private window and on a phone
- [ ] The URL in the entry form and the URL in `README.md` are the same string

## 7. Entry form

- [ ] Project name, one-line pitch, overview (`PROJECT_OVERVIEW.md` is the source)
- [ ] Repository URL (public) and demo URL (or the video, if no demo is deployed)
- [ ] Video: 90–120 s, unlisted-public on YouTube/Vimeo, captions, mode banner never cropped
- [ ] The form asks how the entry handles a failed or uncertain detection — answer with the
      `unavailable` state, not with a retry story (`COMPETITION_RULES.md` §5.1)
- [ ] Deadline in local time: **2026-11-11 12:59 (UTC+8)**; the form locks and cannot be edited afterwards
- [ ] Screenshots uploaded where the form offers an image field: `docs/screenshots/` root set only

## 8. After publishing

- [ ] Watch `X-Daily-Remaining` and the Clocked dashboard for the first day; a public URL with a key is a
      spending surface, and the only reliable signal is the balance
- [ ] If the balance drops faster than expected: lower `DAILY_SCREENS`, redeploy, then investigate
- [ ] If the key is suspected leaked: rotate at the provider, update the host, redeploy — the code needs no
      change, because it reads the key from the environment on every request
- [ ] Keep the recorded commit id, the acceptance output and the video together, outside the repository
- [ ] Re-read the rules page once more before the deadline; the `Changes` section is the first thing to check
