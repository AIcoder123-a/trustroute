# Demo script

Target length **2:30**. Screen recording of the running app, no slides, no talking head required.
Every claim spoken here is visible on screen at the same moment.

---

## Before you record

- [ ] `npm run build && npm start` (production build — no dev overlay), or the deployed URL
- [ ] **Live mode** if a key is available; otherwise mock mode is fine **but the banner must be visible
      on screen** and scene 1 acknowledges it. Never crop the banner out.
- [ ] Browser at 1440×900, 100% zoom, no bookmarks bar, no other tabs
- [ ] Clear the input first so the hero and the idle state are visible at the start
- [ ] Close any notification toasts; do not show the `.env.local` file
- [ ] Record at 1080p/30 or better; capture system audio off, voice-over added in edit

## Scene 1 — The problem (0:00–0:15)

**On screen:** the workbench, idle. Cursor rests near the left rail.

> "An AI agent reads a support ticket. It cannot tell the difference between a customer asking for help
> and someone telling it to ignore its instructions. TrustRoute is the checkpoint in front of that agent."

*If mock mode:* "This is running without an API key, so the detections are a labelled simulation — the
policy, masking and review are exactly the same code."

## Scene 2 — A ticket that must not reach the agent (0:15–0:55)

**On screen:** click *Classic prompt injection* → **Screen content**.

Wait for the result, then move the cursor down the three regions as you speak.

> "One click. Clocked Guard scores it at ninety-five percent injection — instruction override, severity
> critical. Protect already found an email address in the body and masked it. The policy blocks: this
> content never reaches the agent, and the reason is on screen, not in a log."

Point at the highlighted span in the source view, then at the Evidence list directly under it — one
click on a passage selects it in the source above.

## Scene 3 — Personal data: mask, then forward (0:55–1:25)

**On screen:** click *Ticket with personal data* → **Screen content** → switch to *Forwarded copy*.

> "Nothing malicious here — but the agent has no business seeing a phone number or an address. Protect
> returns four entities with positions; TrustRoute rebuilds the copy from those spans and shows exactly
> what would be forwarded. This one passes, because masking was possible and nothing was above the block
> line."

Toggle to *As received* and back, so the before/after is visible, and point at the mask-map chips
(`email → <EMAIL> ×1`) — clicking one jumps back to the exact span it replaced.

## Scene 4 — The interesting case: a script a human should see (1:25–2:00)

**On screen:** click *Script needing review* → **Screen content**.

> "Inspect is static — the script is never executed. It flags the unsigned download and the recursive
> delete, at seventy percent malicious. Below the block line, above the review line: a human decides.
> Approve, and the internal state changes — nothing is run, nothing is sent."

Click **Approve**, let the "reviewer override" line appear.

## Scene 5 — The artefact (2:00–2:25)

**On screen:** click **Review sheet**, scroll slowly through the sheet, then close it and click
**JSON report** to trigger the download.

> "Every screen produces an export a reviewer can defend: the hashed subject, each endpoint's verdict,
> the thresholds this policy used, the reasons, the decision, who reviewed it. No raw text, no personal
> data, no API key."

## Scene 6 — Close (2:25–2:30)

**On screen:** back to the idle workbench, or the decision panel still showing.

> "Three Clocked endpoints, one decision, and a failure never becomes a pass. TrustRoute."

---

## Delivery notes

- Speak at ~140 words per minute; the script above is ~330 words, so leave room for clicks and pauses.
- Do not narrate loading spinners. Cut dead time in the edit; keep the state transitions.
- Never say "our AI decides". The distinction *is* the product: detections are model output, the decision
  is policy.
- If a live run is unavailable, say so once, plainly, in scene 1. Judges score honesty and reproducibility
  higher than a perfect demo.

## Shot list

| # | Time | Action | Must be legible |
| --- | --- | --- | --- |
| 1 | 0:00 | idle workbench | H1, mock/live badge, case rail |
| 2 | 0:15 | *Screen the blocked example* (single click) | BLOCK badge, 95.8% injection, evidence passages |
| 3 | 0:55 | load case 2, screen, forwarded copy | `<PERSON>`, `<PHONE>`, `<EMAIL>`, `<ADDRESS>` |
| 4 | 1:25 | load case 6, screen, approve | REVIEW badge, flagged lines, override note |
| 5 | 2:00 | open review sheet, then export JSON | report rows, thresholds, disclaimers |
| 6 | 2:25 | close | product name |

## If a judge asks for a 30-second version

Scenes 2 and 5 only: block an injection, then show the export. The decision panel and the report between
them carry the whole argument.
