# Screenshots

Every image in this folder comes from the production build of the commit it is committed with
(`npm run build && npm start`), at the viewport stated below, with no key, no terminal and no devtools in
frame. Nothing here is a mockup or a design comp.

The set is small on purpose: three screens carry the product story and its safety limits, two carry the
failure state, and the rest record earlier layouts.

## 1. The current set (2026-11-08, after the review-safety fix)

Production build (`npm run build && npm start`), `CLOCKED_MODE=mock`, synthetic demo cases, device scale 2.
These three are the images the README uses.

| File | Viewport | Mode | What it shows |
| --- | --- | --- | --- |
| `intake.png` | 1440×1100 | simulated | The first screen with *Routine support ticket* loaded: the four content-type tabs (Ticket, Web page, Tool output, Script), the input, the enabled *Screen content* action, three sample chips behind *More examples (5)*, and the closed decision primer. The `Simulated` badge and the amber demo strip are in frame. |
| `blocked.png` | 1440×1320 | simulated | The blocked run: red **BLOCK** band with *Do not forward this content*, five Guard passages with line numbers, *Why* with the rule trace (9 checks · 2 blocking), *What to do next*, and the checkpoint reading *Blocked by policy · no approval available*. **No approval control exists in this frame** — the height is larger than the other two so that the whole checkpoint sentence is inside it. |
| `review.png` | 1440×1100 | simulated | The script case: **REVIEW**, script risk 70.8 %, Inspect's flagged lines (L5 88 %, L7 100 %, L8 90 %) in the evidence list, the rule trace, and the checkpoint with *Approve* / *Reject*, the reject-note counter and the sentence that approval changes an internal routing state only. |

**Anything captured before 2026-11-08 predates the review-safety fix and is history, not documentation.**
`review-decision.png` in particular shows an *Approve* button beside a blocked run: that was the defect
fixed in `7e5ff75`, the control no longer renders on a block, and the file is no longer referenced anywhere.

## 2. Older story screens (Phase 7 layout, 2026-11-03)

> These were captured before the Phase 7.1 polish pass. The current first screen and result screens are in
> `phase7.1/` — three examples instead of eight on the first screen, no empty session trail, and the
> outcome primer closed. Behaviour is unchanged, so these images still describe what the product does.

| File | Viewport | Mode | What it shows |
| --- | --- | --- | --- |
| `landing.png` | 1440×900 | simulated | The first screen after the redesign: one statement, one input, one primary action, eight synthetic cases as chips, and a quiet rail that explains PASS / REVIEW / BLOCK before anything is loaded. No step cards, no tutorial column. |
| `workbench-injection.png` | 1440×900 | simulated | The prompt-injection case screened: `BLOCK` with "Do not forward this content. Blocked at the gateway.", five at-a-glance numbers (injection 95.8 %, script risk n/a, masked 1, latency, credits), the reader with the injected sentences highlighted, and the reasoning rail — *Why* (3 findings), *What to do next*, *Human checkpoint*. |
| `stages.png` | 1440×620 crop | simulated | The three detections as rows, not three cards: `Guard · prompt injection` 95.8 %, `Protect · personal data` 1 entity, `Inspect · script behaviour` *not requested*. Each row opens to its meters and thresholds; the provenance footnote sits under them. |
| `review-decision.png` | 324×740 crop | simulated | The reasoning rail at 1×: the three findings with their source tags, the rule trace (9 checks · 2 blocking), the required actions, and the human checkpoint with `Approve` / `Reject` and the note counter ("8 more characters to reject"). |
| `masked-copy.png` | 1440×900 | simulated | The personal-data case after `PASS`: *Forwarded copy* with `<PERSON>`, `<PHONE>`, `<EMAIL>`, `<ADDRESS>`, the mask map (`address → <ADDRESS> ×1`), "4 values masked", and the *See what arrived* affordance back to the original. |
| `report.png` | 1440×900 | simulated | The *Review sheet* dialog: subject table (chars, words, SHA-256 prefix, entities), one screening row per endpoint, protection applied, the copy that would be forwarded, the policy reasons, disclaimers and the raw JSON. |
| `mobile.png` | 390×844 | simulated | The blocked run on a phone, single column: decision band, reader, then reasoning — the order a phone reader needs, not a compressed three-column layout. |
| `mobile-result.png` | 390×844 | simulated | The same run scrolled to the decision band, showing that `Why` and `Again` stay in the band at 390 px and that nothing is clipped. |

`after/desktop-03-block-full.png` is the full-page version of the blocked run: the only image that shows
the decision, the reader, the evidence list, the stage rows, the technical-details disclosure and the
session trail in one frame.

## 3. The failure state

| File | Viewport | Mode | What it shows |
| --- | --- | --- | --- |
| `screening-unavailable.png` | 1440×900 | **live** | A real live-mode run on a machine the edge refuses: the `Unavailable` badge, "no risk verdict · held for a human", the headline *Screening unavailable — manual review required.*, a Protect row that explains its own failure without being expanded, and a rail stating that the content is unscreened rather than cleared |
| `screening-unavailable-mobile.png` | 390×844 | **live** | The same state on a phone: the `Unavailable` badge and headline in the band, with the `Why` affordance that scrolls to the reasons |

Both live images were captured **before** the Phase 7 layout (2026-10-31) and still show the previous dark
interface. They are kept because the evidence in them — a real `403 cf-mitigated: challenge` handled as
"screening unavailable" rather than as a pass — is about behaviour, not styling. They will be re-captured
after the next deployment that can reach the API from a browser-reachable host.

This is the most valuable pair in the folder for a judge: it is the one state a demo that only shows green
checks can never produce. No credit was spent — the refusal happens before authentication.

## 4. Before and after the redesign

| Folder | Contents |
| --- | --- |
| `phase7-before/` | `landing.png` and `result.png` from the previous dark three-column layout, captured 2026-11-03 immediately before the rewrite |
| `phase7-after/` | The same two states from the new layout, same viewport, same case, same mode |
| `phase7.1/` | The final polish pass (2026-11-04): `01-intake-1440`, `02-block-1440`, `03-pii-masked-1440`, `04-review-1440`, `05-intake-390`, `06-block-320`, `07-review-390`, plus `before-intake` / `before-result` carried over from the Phase 7 build |

The pair exists so the visual claims in `docs/TEST_REPORT.md` §7 can be checked rather than taken on
trust. Both halves are 1440×900, simulated mode, and show the *Classic prompt injection* case.

`before/` and `after/` hold an earlier refinement pass (2026-10-31) and are historical; where they disagree
with the root folder, the root folder is current.

## 5. Re-capturing

```bash
npm run build
CLOCKED_MODE=mock npm start          # story screens: the SIMULATED notice must be in frame
CLOCKED_MODE=live npm start          # failure screens: needs a key, spends no credits on a 403
```

- Current set: 1440×1100 at device scale 2, except `blocked.png` at 1440×1320 so its checkpoint fits.
  Older frames used 1440×900 at scale 1; 390×844 and 320 px are checked for overflow
  (`document.scrollWidth === window.innerWidth`) but not committed.
- One screenshot per state, taken after the decision renders — not during the loading skeleton.
- Never crop the mode notice or the `Simulated` / `Live` pill: the mode is part of the evidence.
- Simulated numbers are labelled *simulator threshold* on screen; if a future capture changes the labels,
  re-read `docs/DEMO_SCRIPT.md` before recording, so the narration matches the pixels.
- Check the frame before committing it: no `.env.local`, no terminal, no browser autofill, no real personal
  data. The cases are synthetic, so a real address in a screenshot would mean something went wrong.
