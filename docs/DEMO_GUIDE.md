# Demo guide — five screens, about four minutes

For judges of the **Clocked Build Challenge 2026**.

- Demo: <https://incomparable-swan-890023.netlify.app/>
- Repository: <https://github.com/AIcoder123-a/trustroute>

The public demo runs the **labelled simulator**, not the live API: the header badge reads *Simulated* and
every stage carries a `SIMULATED` tag. That is intentional — it lets a judge walk the entire flow without
consuming the deployment's Clocked credits. The live path is verified separately and is recorded in
`docs/TEST_REPORT.md` §4.4; no real Clocked call is made by the demo.

Nothing below needs an account, a key or an install.

---

## 0. Before you start

Open the demo. You should see:

- the header badge **Simulated**, and a thin amber strip reading *DEMO · SIMULATED RESULTS*;
- one input, four content-type tabs (*Ticket*, *Web page*, *Tool output*, *Script*);
- three sample chips, with *More examples (5)* behind them.

**What this proves:** the product tells you which transport produced the result before you read any
result. There is no state in which a simulated number can pass as Clocked output.

One budget note: this deployment allows **20 screenings per UTC day for the whole site**, and 10 per caller
per 5 minutes. The tour below spends three of them. If the day's allowance is already gone you will get a
`429` with *"This demo has used its screening allowance for today"* — nothing is screened and nothing is
released, and the sample cases still load so the interface remains inspectable. `/api/status` reports the
limits in force.

---

## 1. BLOCK — *Classic prompt injection*

Click **Classic prompt injection**, then **Screen content**.

Expected screen:

| Where | What you should see |
| --- | --- |
| Decision band | Red **BLOCK** badge, headline *Do not forward this content. Blocked at the gateway.* |
| Numbers row | Injection probability together with the threshold it crossed |
| **Why** (right) | *Guard* finding with the injected sentence quoted as evidence; the policy rule that fired |
| Content reader (left) | The injected span highlighted in the source |
| **Human checkpoint** | *Blocked by policy · no approval available* — and **no approve control at all** |

**What this proves:** the block comes from Guard's real probability crossing a documented threshold, not
from a keyword list; a human cannot approve it away — the control is absent rather than disabled, because
there is no permission that would enable it.

---

## 2. REVIEW — *Script needing review*

Go back with **New screening**, choose the **Script** content type, and pick **Script needing review**
(behind *More examples*).

Expected screen: an amber **REVIEW** badge, and Inspect's findings in **Why** — a *suspicious* verdict with
the flagged lines listed and numbered.

**What this proves:** Inspect is not a "block every script" filter. This script is plausible enough to run
and risky enough to need a person; the decision says exactly that, and the evidence points at the lines
that caused it.

---

## 3. Evidence drill-down

In the evidence panel, click any Guard or Inspect passage.

Expected: the source reader scrolls to that span and marks it, so the quoted evidence and the original text
are the same bytes in the same place. The mask map (`MASK MAP`) does the same for Protect's entity spans.

**What this proves:** the report is not a summary written after the fact — every claim is anchored to an
offset in the content that was screened.

---

## 4. REVIEW → human approval

Still on the script result, scroll to **Human checkpoint**, type one sentence in the note box and press
**Approve**.

Expected:

- the badge moves to **PASS**, and the small print under it says the reviewer overrode a policy REVIEW;
- the checkpoint records the action, the actor (`demo-reviewer`) and the time;
- the **Session trail** gains a row that keeps both facts: `REVIEW … reviewed → PASS`;
- **JSON report** and **Review sheet** show `decision.decision = REVIEW` (the policy's own verdict) next to
  the reviewer's `PASS`, with no "forwarded" wording anywhere.

**What this proves:** the review loop is real and the two facts are never merged. Approval changes an
internal routing label; the product has no send, execute or forward action to grant. Note that this is a
demo reviewer, not an authenticated one.

---

## 5. PII masking and the audit trail

Press **New screening**, then choose **Ticket with personal data** and screen it.

Expected:

- **PASS**, with Protect reporting four entities (person, email, phone, address);
- the content panel opens on the sanitized copy, with typed placeholders in place of the values;
- **Copy sanitized** copies the masked text; switching to *As received* shows the original, which is never
  the copy the product offers to send;
- **JSON report** contains the hash, the verdicts, the thresholds and the reasons — no raw text and no
  entity values.

Then open **Session trail**: a content-free list of the runs in this browser (time, length, verdict, stage
statuses). It is per browser and per server process, and it disappears on restart — see the limitations
section of the README.

**What this proves:** masking is built from Protect's spans and re-validated, and the export is defensible
without carrying the very data that had to be protected.

---

## Optional: the failure path

If you want to see the safety property that matters most, ask for the repository and run it locally with
`CLOCKED_MODE=live` and no key, or with the network blocked. A detection that does not complete produces
**Screening unavailable — manual review required**: no verdict, no sanitized copy, no approval, and an
export that says the run is not a risk assessment.

The demo deployment cannot show this, because it runs the simulator. That is why it is documented rather
than clicked: *a stage that failed can never become PASS.*

---

## If something looks wrong

| Symptom | Meaning |
| --- | --- |
| Header says *Simulated* | Expected on the public demo. It is a label, not an error. |
| A screen shows *Screening unavailable* | The live path could not reach Clocked; the product held the content instead of guessing. Not expected on the demo build. |
| No approve button on REVIEW | Check the decision badge: BLOCK and unavailable runs have no approval by design. |
| Review returns "no record of that run" | The run was screened by a different server instance (serverless) — screen it again; the decision is unchanged. |
