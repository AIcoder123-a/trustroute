# Screenshots

Every image in this folder comes from the production build of the commit it is committed with
(`npm run build && npm start`), at the viewport stated below, with no key, no terminal and no devtools in
frame. Nothing here is a mockup or a design comp.

The set is small on purpose: five screens carry the product story, two carry the failure state.

## 1. The five story screens

| File | Viewport | Mode | What it shows | Demo scene |
| --- | --- | --- | --- | --- |
| `landing.png` | 1440×900 | simulated | The idle state: the three-step strip (paste → three checks → a policy decides), the empty input with its character budget, the demo-case rail, and *How the decision is made* explaining PASS / REVIEW / BLOCK before any content is loaded | 1 |
| `workbench-injection.png` | 1440×900 | simulated | The prompt-injection case screened: `BLOCK`, "Do not forward this content. Blocked at the gateway.", Guard at 95.8 % / severity critical / category *instruction override*, 1 entity masked, 5 evidence passages each anchored to an `L<n>` line, and the rule trace reading *8 checks · 2 blocking* | 2 |
| `masked-copy.png` | 1440×900 | simulated | The personal-data case after `PASS`: the *Forwarded copy* tab with `<PERSON>`, `<PHONE>`, `<EMAIL>`, `<ADDRESS>`, the mask map (`email → <EMAIL> ×1`), "4 values masked · 4 kinds · 96 chars removed", and the empty-evidence explanation ("Neither Guard nor Inspect returned a passage…") | 3 |
| `review-decision.png` | 364×902 crop | simulated | The decision panel on its own, at 1× so the text is readable: findings, rule trace, *What to do next*, the Guard/Inspect/entities/credits readout, the human checkpoint with `Approve` / `Reject` / `Recheck`, and the note counter ("8 more characters to reject") | 4 |
| `report.png` | 1440×900 | simulated | The *Review sheet* dialog over the workbench: subject table (chars, words, SHA-256 prefix, entities), the screening table row per endpoint (`POST /injection` ok · benign · 0.0 % · 410 ms, `POST /pii` ok · 4 finding(s), `POST /script` skipped), protection applied, the copy that would be forwarded, and the policy reasons | 5 |
| `mobile.png` | 390×844 | simulated | The same blocked run on a phone: the source view with the injected sentences highlighted through a word wrap the desktop layout never produces, and the evidence list below it | 4 (mobile proof) |

`docs/screenshots/after/desktop-03-block-full.png` is the full-page (1000×1089) version of the blocked run:
it is the only image that shows the detection stages in the same frame as the decision — the probability
ruler at 95.8 %, the simulator threshold (50 %) and the policy block line (85 %) drawn on the same scale,
plus the Protect entity table.

## 2. The failure state

| File | Viewport | Mode | What it shows |
| --- | --- | --- | --- |
| `screening-unavailable.png` | 1440×900 | **live** | A real live-mode run on a machine the edge refuses: the `LIVE` pill, the amber `Unavailable` badge, "no risk verdict / held for a human", the headline *Screening unavailable — manual review required.*, an explanation that the REVIEW state exists because the content is unscreened — not because anything was found — and both stages reporting `Request failed · edge_interstitial` with the 403-instead-of-JSON explanation |
| `screening-unavailable-mobile.png` | 390×844 | **live** | The mobile decision bar in that state: `UNAVAILABLE` chip and the same headline, with the `Why` affordance that scrolls to the reasons |

This is the most valuable pair in the folder for a judge: it is the one state a demo that only shows green
checks can never produce. It was captured with `CLOCKED_MODE=live` against `clocked.rezolve.ai`, which
answered the server-side call with `403 cf-mitigated: challenge`; the screenshots record the product's
handling of that answer, not a hand-written fixture. No credit was spent — the refusal happens before
authentication.

## 3. Recorded, not curated: `before/` and `after/`

`before/` and `after/` hold the same five states captured on either side of the 2026-10-31 refinement pass
(1× at 1440×900, plus the mobile pair). They are kept as the evidence for the visual claims in
`docs/TEST_REPORT.md` §6 rather than as submission material; when they disagree with the root folder, the
root folder is current.

## 4. Re-capturing

```bash
npm run build
CLOCKED_MODE=mock npm start          # story screens: the SIMULATED banner must be in frame
CLOCKED_MODE=live npm start          # failure screens: needs a key, spends no credits on a 403
```

- Viewport 1440×900 at device scale 1 for desktop, 390×844 for mobile; the layout is tuned for both.
- One screenshot per state, taken after the decision renders — not during the loading skeleton.
- Never crop the mode banner or the `LIVE` / `SIMULATED` pill: the mode is part of the evidence.
- Simulated numbers are labelled *simulator threshold* on screen; if a future capture changes the labels,
  re-read `docs/DEMO_SCRIPT.md` before recording, so the narration matches the pixels.
- Check the frame before committing it: no `.env.local`, no terminal, no browser autofill, no real personal
  data. The cases are synthetic, so a real address in a screenshot would mean something went wrong.
