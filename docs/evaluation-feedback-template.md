# Private evaluation worksheet

Copy this worksheet outside the repository for your own notes. Use only the
synthetic local fixture and short sanitized descriptions, never raw logs,
environment values, tokens, confirmation URLs or personal data. See the
[evaluation guide](design-partner-evaluation.md) before starting. Leaving a
field blank or recording a blocked run is preferable to inventing evidence.

```text
Candidate commit:
Evaluation date (optional):
OS and version:
Node / npm / Docker / browser versions:
Transport chosen (HTTP / SDK / local stdio MCP):
Session (independent / assisted / maintainer or agent rehearsal):
Help or undocumented steps needed (sanitized; no names):

Timing (approximate wall-clock minutes):
- Prerequisite setup, if needed:
- Clone to first working app (include bootstrap):
- Working app to completed flow or stopping point:
- Time spent blocked, and at which step:

Stages (pass / fail / not attempted; add a short observation):
- Clone and bootstrap:
- Public page and availability discovery:
- Integration example preparation, notHeld=true and still-listed slot:
- Integration example refused create, CONFIRMATION_REQUIRED / 428:
- Guided MCP discovery and preparation:
- Guided pre-approval refusal:
- Explicit browser authority recorded:
- Confirmed database commit and identical replay:
- Exactly one persisted booking and authenticated host cancellation:
- Optional dashboard inspection:
Furthest completed stage:

First failure or friction:
- Exact command or UI step (without secrets or local paths):
- Expected:
- Actual (sanitized):
- Workaround, if any:

Understanding (answer before rereading):
- Does preparation hold a slot or authorize a booking?
- What does browser approval change; what remains for commit?
- What makes an exact replay safe?
- Who may cancel; what can the agent not do?
Authority clarity (immediate / after explanation / partly / unclear):
Smallest useful improvement:
Relevant missing capability for a hypothetical integration (no customer data):

Sharing choice:
- Keep private / submit selected sanitized sections publicly:
- Synthetic fixture only and redaction reviewed: yes / no
- Separate permission for attribution, quotes or recordings: not requested
```

If you choose to submit, transfer relevant fields to the
[Evaluation feedback form](https://github.com/EP2-Git/project-s/issues/new?template=evaluation_feedback.yml).
GitHub associates a public submission with your account. A worksheet is not a
consent record or permission to reuse your identity, quotes or recordings.

For a comparison across three to five evaluators, keep a separate summary:

```text
Candidate commit(s) and platform coverage:
Number of independent / assisted / rehearsal runs:
Number complete / partial / blocked (and stages not attempted):
Timing ranges and number of observations behind each range:
Recurring friction, including unsuccessful runs (no names or quotes):
Authority clarity counts:
Next proposed improvement and supporting observations:
Evidence gaps (platforms, browser versions, unattempted steps):
```

Do not treat a synthetic rehearsal or an empty template as evaluator feedback.
Do not publish raw worksheets or identifiable summaries without separate
permission. Report vulnerabilities through [SECURITY.md](../SECURITY.md).
