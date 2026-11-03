# Demo script — 100 seconds

Target length **1:40 (100 seconds)**, inside the 90–120 second range. The official rules ask for
"a short video of the application in use" and set no length; 100 seconds is long enough to show the
composition of three endpoints and short enough that a judge watches it to the end.

Screen recording of the running application. No slides, no talking head. **Every claim spoken here is
visible on screen at the same moment.**

---

## Before you record

- [ ] `npm run build && npm start` (production build, no dev overlay) or the deployed URL
- [ ] Open in a clean browser window at 1440×900, 100% zoom, no bookmarks bar, no other tabs
- [ ] Decide the mode before you start, and do not mix modes in one take:
      **live** if `CLOCKED_MODE=live` returns real detections; otherwise **mock**, with the
      `DEMO · SIMULATED RESULTS` banner visible in every frame
- [ ] Never crop the banner out, never hide the mode pill, never say "live" over a simulated run
- [ ] Close notifications, and never show `.env.local`, a terminal with the key, or a DevTools network tab
- [ ] Record at 1920×1080 / 30 fps or better; system audio off, voice-over added in the edit
- [ ] Keep the mouse still while speaking; move it only to the thing being described

## Scene 1 — The problem (0:00–0:10)

**On screen:** the idle workbench. Cursor still.

> "An agent reads a support ticket and cannot tell a customer asking for help from someone telling it to
> ignore its instructions. TrustRoute is the checkpoint in front of that agent."

*If mock:* add one sentence, once: *"This take runs without an API key, so the detections are a labelled
simulation — the masking, the policy and the review are the same code that runs live."*

## Scene 2 — Block an injection (0:10–0:35)

**On screen:** click **Screen the blocked example** (one click, from the landing state).

> "One click runs all three Clocked checks. Guard scores this at ninety-five percent injection, severity
> critical — instruction override. Protect found an email in the body and masked it. Policy blocks: this
> never reaches the agent, and the reason is on screen rather than in a log."

Click one evidence passage; the source view jumps to the highlighted span.

> "Every passage Guard returned is a real offset in this text. Click it and you are looking at the line
> that was scored."

## Scene 3 — Mask, then forward (0:35–1:00)

**On screen:** click *Ticket with personal data* → **Screen content** → **Forwarded copy**.

> "Nothing malicious here, but the agent has no business seeing a phone number or a card. Protect returns
> typed entities with positions; TrustRoute rebuilds the forwarded copy from those spans and shows exactly
> what would leave the gateway."

Click a mask-map chip (`email → <EMAIL> ×1`); the view returns to the replaced span.

> "Each placeholder is traceable back to the value it replaced. This run passes, because masking was
> possible and nothing crossed the block line."

## Scene 4 — The case a human should see (1:00–1:20)

**On screen:** click *Script needing review* → **Screen content**.

> "Inspect is static analysis — the script is never executed. It flags the unsigned download and the
> recursive delete: above the review line, below the block line. So a person decides."

Click **Approve**; the band changes to the reviewer's decision.

> "Approval changes an internal routing state. Nothing is run, nothing is sent."

## Scene 5 — The artefact (1:20–1:35)

**On screen:** click **JSON report** to download, then **Review sheet** and scroll one screen.

> "Every screen produces an export a reviewer can defend: the hashed subject, each endpoint's verdict, the
> thresholds this policy used, every comparison it made, and who approved it. No raw text, no personal
> data, no key."

## Scene 6 — Close (1:35–1:40)

**On screen:** the decision panel, `BLOCK` or the review state.

> "Three Clocked endpoints, one decision, and a failure never becomes a pass. TrustRoute."

---

## The alternate scene, if the live path is refused

If `npm run accept:live` returns `403 cf-mitigated: challenge` on the recording machine, record the mock
take and add **one** shot at 1:35 — a live-mode run of the same case, showing:

> "On this machine the service edge challenges non-browser clients before authentication, so the live
> screen is refused rather than answered. TrustRoute reports that as screening unavailable and holds the
> content — it does not fall back to the simulator, and it does not call the run a verdict."

Then hold on `Screening unavailable — manual review required` for two seconds. This is a legitimate part of
the product, and it is more convincing than a green check mark that the demo cannot actually produce. The
frame to aim for is `docs/screenshots/screening-unavailable.png` — the `Unavailable` badge, "no risk verdict
/ held for a human", and both stages reporting `Request failed · edge_interstitial`.

## Delivery notes

- ~150 words per minute. The narration above is ~260 words — leave the rest for clicks and pauses.
- Do not narrate spinners. Cut dead time in the edit but keep the state transitions, including the
  loading state: it shows the product is doing real work.
- Never say "our AI decides". The distinction *is* the product: detections are model output, the decision
  is policy, and the rule trace shows which comparison produced it.
- Never call a simulated number a Clocked verdict. If the take is mock, say "simulation" once in scene 1
  and let the banner carry the rest.

## Shot list

| # | Time | Action | Must be legible |
| --- | --- | --- | --- |
| 1 | 0:00 | idle workbench | H1, mode pill, sample-case chips |
| 2 | 0:10 | *Screen the blocked example* | BLOCK badge, injection %, evidence list |
| 3 | 0:18 | click an evidence passage | highlight in the source view, `L<n>` in the row |
| 4 | 0:35 | PII case → Forwarded copy | `<PERSON>`, `<PHONE>`, `<EMAIL>`, `<CARD>` |
| 5 | 0:48 | click a mask-map chip | returns to *As received*, span outlined |
| 6 | 1:00 | script case | REVIEW badge, malicious %, flagged lines |
| 7 | 1:12 | Approve | reviewer override, "nothing was executed" |
| 8 | 1:20 | JSON report + review sheet | thresholds, checks, disclaimers |
| 9 | 1:35 | close | product name |

## If a judge asks for a 30-second version

Scenes 2 and 5 only: block an injection, then show the export. The decision band and the report between
them carry the whole argument.
