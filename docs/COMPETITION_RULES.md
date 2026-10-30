# Competition rules — Clocked Build Challenge 2026

**Verification date:** 2026-10-30
**Sources read in full on that date:**

| Document | URL |
| --- | --- |
| Challenge landing page | https://clocked.rezolve.ai/challenge |
| Official rules | https://clocked.rezolve.ai/build-challenge/rules |
| API documentation (index) | https://clocked.rezolve.ai/docs |

Everything below is quoted or paraphrased from those pages on that date. Where a page did not answer a
question, the item is marked **UNVERIFIED** rather than guessed.

---

## 1. Key dates (all times Eastern)

| Date | Event | Status |
| --- | --- | --- |
| October 21, 2026 | Building opens | past |
| **November 10, 2026, 11:59 p.m. ET** | Entries close; the entry form is locked | **~11 days from verification date** |
| November 11–17, 2026 | Judging and People's Choice voting | future |
| November 17, 2026, 11:59 p.m. ET | Voting closes | future |
| November 18, 2026 | Winners announced | future |

Local time for the deadline: 2026-11-11 12:59 (UTC+8, China Standard Time). The form is locked at the
deadline, and edits after it are not possible.

## 2. Prizes

| Award | Amount | Type |
| --- | --- | --- |
| Best Overall App | $600 | judged |
| Best Use of Decide, Extract, or Fill | $400 | judged |
| Best Use of Protect, Guard, or Inspect | $400 | judged |
| Best Use of Verify, Compare, or Rerank | $400 | judged |
| People's Choice | $200 | community vote |

- A project may win **one judged award plus People's Choice**, maximum $800.
- Prizes are paid **per project**, shared by the team; the amount does not grow with team size.
- Total prize pool: $2,000.

## 3. Eligibility

From section 3 of the official rules, an entrant must satisfy **all** of:

1. At least 18 years old and of legal majority where they live.
2. Live in an eligible location (section 4).
3. Not an employee, contractor or officer of Rezolve.ai, not a judge, not a member of their immediate
   family or household.
4. Not prohibited from receiving payments from a United States business under sanctions or export law,
   and not on a US restricted-party list.

### 3.1 Location eligibility — mainland China

Section 4 states the challenge is open worldwide **except**:

> "The challenge is not open to residents of Cuba, Iran, North Korea, Syria, Russia, Belarus, or the
> Crimea, Donetsk, and Luhansk regions of Ukraine, nor to residents of the province of Quebec, Canada."

The three cumulative conditions in section 4 are:

- taking part in a skill-based contest with cash prizes is lawful for the entrant, and the contest does
  not have to be registered, bonded or approved by a government authority;
- **Rezolve.ai can send a business payment to a resident of that location through Wise from the United
  States, under Wise's current coverage**;
- United States sanctions and export laws permit the payment.

**Assessment:** mainland China is **not** on the exclusion list, so the first and third conditions are
not obviously disqualifying.

**UNVERIFIED — payment reachability.** The second condition depends on Wise's current coverage for
business payments from the US to a recipient in mainland China. This document does **not** assert that
such a payment is possible; Wise coverage changes and cannot be confirmed from the challenge pages. The
rules themselves say:

> "If a location becomes ineligible during the challenge because of a change in law or in Wise's
> coverage, an entrant from that location remains eligible for recognition but may not be able to
> receive a cash prize."

**Action required by the entrant (not something this project can do):** ask the organizers directly, in
a comment on the Clocked challenge announcement on LinkedIn — the rules explicitly route eligibility
questions there so that every answer is public. Until that answer exists, treat the cash prize as
**at risk** and the recognition as the realistic outcome.

### 3.2 Age

**UNVERIFIED for this entrant.** The rules require 18+ and legal majority. Age was not established in
this project's records; the entrant must confirm it.

### 3.3 Team

- Teams of any size are allowed; every member must meet the eligibility terms.
- One member submits from their Clocked account and is the point of contact.
- Each Clocked account holds one entry.
- Every member is listed with name, email, and GitHub handle where available.

This project is currently a **single-entrant** submission.

## 4. What counts as a new project

Section 6, verbatim points:

- The application must be **started and developed during the building period**. Previously built
  applications, earlier hackathon entries, and existing products with Clocked added are not eligible,
  even with substantial changes.
- Standard libraries, frameworks, SDKs, generic starter templates and **AI coding tools are allowed**.
  The application's core functionality and implementation must be created for this challenge.
- Third-party code and assets must be credited, and their licences respected. The repository's
  development history must be available so judges can see what was built and when.
- Use public, synthetic or appropriately authorized data. **Never publish API keys, credentials or
  private information.**
- Entries must not be unlawful, infringing, defamatory, hateful, sexually explicit or harmful.
- **AI-assisted development is welcome**; the entrant remains responsible for everything submitted.

**Implication for this repository:** the first commit must be dated inside the building window
(2026-10-21 → 2026-11-10) and the history must be honest. TrustRoute was created on 2026-10-30 with no
pre-existing code; no prior project was reused.

## 5. What must be submitted

Section 5 requires the entry form (submitted from a Clocked account) to contain:

- project name and overview — what it does, who it is for, what problem it solves;
- a demo — **a working application link, or a short video of the application in use**;
- a **public source repository** with setup instructions and its development history;
- which Clocked endpoints were used and **how their outputs affect the application**, including how
  multiple endpoints work together and what each contributes;
- optionally, what was learned;
- every team member's name, email and GitHub handle;
- the award categories to enter.

Additional obligations:

- The demo and repository must stay **publicly accessible through November 18, 2026**.
- An entry whose demo or repository cannot be reviewed may be scored on what remains accessible, or set
  aside.
- No post on any platform is required to enter. A LinkedIn post is needed **only** for People's Choice.
- No entry fee; no purchase necessary; spending on Clocked does not affect judging.

## 6. Judging criteria (scored out of 100, four judges, averaged)

### Best Overall App

| Criterion | Points |
| --- | --- |
| Practical usefulness | 25 |
| Quality of the core Clocked integration | 30 |
| Thoughtful use of additional Clocked endpoints | 15 |
| Implementation and user experience | 20 |
| Clear explanation and reproducibility | 10 |

### Group awards (including Best Use of Protect, Guard, or Inspect)

| Criterion | Points |
| --- | --- |
| Depth — how the group's endpoints shape what the application does | 40 |
| Breadth — endpoints of the group used meaningfully, **10 each** | 30 |
| Practical usefulness and execution | 20 |
| Clear explanation and reproducibility | 10 |

> "Meaningful use means the endpoint's output changes what the application does or shows; a call whose
> result is ignored earns nothing."

**Consequence for TrustRoute:** all three endpoints of the Protect/Guard/Inspect group must visibly change
the product, not merely be called. See `docs/IMPLEMENTATION_PLAN.md` §3 for how that is enforced
structurally: Guard and Protect both feed the policy engine, and Protect's spans drive the forwarded copy.

## 7. Intellectual property and publicity

- The entrant **keeps ownership** of the project and its code.
- By entering, the entrant grants Rezolve.ai a worldwide, royalty-free, **non-exclusive** licence to
  show, reproduce and distribute the project name, overview, screenshots, demo video, write-up link and
  team names/handles **in coverage of the challenge and of Clocked**.
- Winners agree to be named in the winners' announcement.
- Personal information is used to run the challenge, verify eligibility and pay prizes, and is shared
  with Wise as needed.

No clause requires the project to be open source beyond "a public source repository" being part of the
entry requirements.

## 8. Payment and tax

- Prizes are denominated in USD and paid **through Wise**, subject to Wise's supported destinations,
  recipient verification, and documentation the organizer requests (for example **IRS Form W-9 or
  W-8**).
- The organizer pays Wise's transfer fee; currency conversion is at Wise's rate; **any withholding
  required by law is deducted**.
- **Taxes on a prize are the winner's responsibility.**
- Payment is targeted within ~10 business days after eligibility is verified and all payment information
  is received.
- If a winner cannot be reached within 14 days, or does not provide the requested information within 14
  days, the prize is forfeited and may pass to the next eligible project.

## 9. Conduct and disqualification

The organizer may disqualify an entry for breaking the rules, providing false information, interfering
with the challenge or other entrants, abusive behaviour, or attempting to manipulate judging or People's
Choice. Decisions of the organizer and judges are final.

## 10. People's Choice mechanics (only if entered)

- One public LinkedIn post showing the application with a demo or video, tagging the official Clocked
  LinkedIn page with an active @mention and `#ClockedChallenge`.
- Scoring: 1 point per reaction, 3 per repost, 2 per comment from a unique person.
- Voting runs November 11–17; a baseline is recorded when voting opens, so earlier engagement does not
  count.
- Team self-engagement does not count. Paid boosting, bots and engagement exchanges are prohibited.
- Only one post per project, URL added to the entry form before the deadline.

## 11. Open items that block a submission

| # | Item | Owner | Blocks |
| --- | --- | --- | --- |
| 1 | Confirm Wise can pay a mainland-China recipient (ask on the LinkedIn announcement) | entrant | cash prize |
| 2 | Confirm the entrant is 18+ and of legal majority | entrant | eligibility |
| 3 | Create a Clocked account and redeem `CLOCKEDHACKATHON` (20,000 credits total) | entrant | live API testing |
| 4 | Provide `CLOCKED_API_KEY` for live integration evidence | entrant | judged "quality of integration" |
| 5 | Create and publish the public GitHub repository | entrant (authorization required) | entry requirement |
| 6 | Deploy a public demo URL | entrant (authorization required) | entry requirement |
| 7 | Complete the entry form before 2026-11-10 23:59 ET | entrant | submission |

## 12. Unverified items, explicitly

- Wise coverage for mainland China business payments (section 3.1).
- The entrant's age (section 3.2).
- The `Changes` section of the rules page — the page states that later changes are dated there; the
  change log itself was not captured in this pass and should be re-read before submitting.
- Whether a "short video" alone satisfies the demo requirement when no public deployment exists. The
  rules allow either "a working application link, or a short video of the application in use"; the
  safer reading is that both are better.
- Tax treatment for a non-US resident winner beyond "Wise may request W-8 documentation".
