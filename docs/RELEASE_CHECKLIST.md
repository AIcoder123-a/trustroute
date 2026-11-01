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
| 0.2 | Licence | the rules require **no particular licence** (see `COMPETITION_RULES.md` §5.2); a repo with no licence is "all rights reserved" by default | §0.2.1 analyses both; the default if undecided is to publish **without** a licence, with the copyright line in `README.md` |
| 0.3 | Which `docs/` files ship publicly | `SUBMISSION_DRAFT.md`, `COMPETITION_RULES.md` and this file are working notes; the rules only ask for README + setup + history | ship them (they are honest and contain no key), or move them out before the first push |
| 0.4 | Demo host, and whether it runs **live** or **simulated** | a live public demo spends the account's credits; a simulated one cannot be mistaken for a verdict if the banner is up | Render free, one instance, simulated first; switch to live only after `accept:live` succeeds from the host's own egress (`DEPLOYMENT.md` §4.1) |
| 0.5 | Whether to wire the Wise question to the organiser | prize payment to a mainland-China recipient is unverified (`COMPETITION_RULES.md` §3.1) | ask before the entry is final |

### 0.2.1 Licence: all rights reserved vs MIT

The rules ask for a public repository and say nothing about licensing, so this is a choice about what the
work is *for* after the challenge. Both options are defensible; they are not equivalent.

| | No licence (all rights reserved) | MIT |
| --- | --- | --- |
| What a reader may do | read the code on GitHub, which is all a judge needs | read, run, modify, redistribute, including commercially, with the copyright notice kept |
| Signal to a reviewer | "this is a portfolio piece, not a library" — some read it as unfinished or unfriendly | unambiguous: reusable, with attribution |
| Downside | legally ambiguous in practice — GitHub's own terms let others view and fork, so "reserved" is not the same as "private"; anyone who wants to reuse it must contact you | someone can deploy the same demo, resell it, or wrap it in a product; you keep copyright but not exclusivity |
| Effect on the entry | none — the rules require neither | none — a licence does not change eligibility or judging |
| Reversibility | you can add MIT later at any time | you cannot withdraw the rights already granted for released versions |

Recommendation: **MIT if the project is meant to be a portfolio artefact** (a security-gateway demo that
others can run is worth more to the author than the exclusivity it loses), **no licence if the intent is
to keep the design closed** while satisfying the rules. Either way, state the choice explicitly in
`README.md` — an implicit licence is the one thing that reads as an oversight rather than a decision.
Do not invent a "source-available, non-commercial" licence for this: a hand-written clause is harder to
read than MIT and has no legal review behind it.


## 1. Pre-flight on the machine

```bash
npm run verify                  # typecheck, lint, 133 assertions, production build
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

## 9. The launch, in order

One ordered pass, so the ordering decisions are made once rather than in the moment. Each step states what
it proves; a step that is skipped is a claim that has to be softened later.

| # | Step | Command / action | Proves |
| --- | --- | --- | --- |
| 1 | Freeze the code | `npm run verify && npx playwright test` | the commit being published is the commit that passed |
| 2 | Check the credential | `npm run accept:check` | the key comes from `.env.local`, is the rotated one, and is not a stale shell export |
| 3 | Measure the server path | `npm run accept:live` (hotspot or CI, `DEPLOYMENT.md` §3) | whether a non-browser client can reach the API at all |
| 4 | Decide the tier | `DEPLOYMENT.md` §7 A/B/C | what the entry is allowed to claim |
| 5 | Secret scan | §2 of this file | the repo can be made public |
| 6 | Create the public repository | owner | the rules' repository requirement |
| 7 | Deploy with `CLOCKED_MODE=mock` | Render: build `npm ci && npm run build`, start `npx next start -p $PORT` | the build runs on the host, and a wrong turn costs nothing |
| 8 | Verify from outside | §5 of this file (`/api/status`, headers, cross-origin 403) | the deployed instance behaves like the local one |
| 9 | Switch to live, if step 3 passed | set `CLOCKED_MODE=live`, `DAILY_SCREENS=40`, `RATE_LIMIT_REQUESTS=10`, redeploy | the demo screens for real, within a bounded budget |
| 10 | Screen once in a private window | one-click example | the host's egress reaches Clocked — the only honest proof |
| 11 | Record the demo | `docs/DEMO_RECORDING.md` | the video, in a mode the demo can actually produce |
| 12 | Check the link as a stranger | private window, phone, no session | a judge can open it |
| 13 | Fill the entry form | §7 of this file | the entry |
| 14 | Watch the balance for 24 h | `X-Daily-Remaining`, provider dashboard | the spend is what was planned |

Two rules that outrank the order: never publish with the key in a variable the browser can read, and never
leave the demo live with an unbounded budget on a host that can start more than one instance.
