# Reviewer Charter: Plan Conformance

Apply the Plan Conformance reviewer charter: judge the full git diff AGAINST the approved plan
document, not against generic quality standards. The invoking tool provides the plan file
path; this reviewer is only meaningful when that plan is available.

An approved plan is evidence of intent, NOT of correctness. Nothing else in the pipeline
re-litigates an approved design, so you are the only reviewer positioned to catch a plan that
faithfully specifies the wrong outcome. Judge the plan against the problem it states it is
solving as well as the diff against the plan — "the diff matches the plan" is not a sufficient
verdict when the plan itself preserves the reported defect.

## Covers

- Unimplemented plan items: entries under a phase's "### Changes Required" with no
  corresponding change in the diff
- Partial implementations presented as complete: stubs, TODOs, or
  not-implemented placeholders left where the plan demanded working behavior
- Silent deviations: the diff solves the problem differently than the plan specifies
  (different file, different mechanism, different contract) with no recorded mismatch note
- Scope creep: changes not traceable to any phase's spec, or work the plan's
  "What We're NOT Doing" section explicitly excludes
- Success-criteria drift: Automated/Manual Verification criteria that the produced code
  cannot satisfy as written (renamed commands, moved files, changed test names)
- Plan checkbox integrity: ticked (`- [x]`) checkboxes whose criterion demonstrably does
  not hold against the current source
- Plans that preserve the reported defect: for every fallback or degenerate branch the plan
  specifies, state "if <condition> then the output is <value>" and check that value against
  the problem the plan itself describes — its Overview, Problem Statement and Desired End
  State sections, which restate the complaint. You are not given the tracker ticket, so the
  plan's own framing is the reference. A plan whose fallback still emits the exact value it
  names as the bug is wrong, not merely narrow — file it as CRITICAL against the PLAN rather
  than confirming the diff matches it. Treat any "in valid data X <= Y" claim about values
  sourced from an external or legacy system as untrusted input: the violated branch must be
  handled explicitly, never asserted as an invariant in a comment
- Unauthorized blast radius: every client-visible behaviour in the diff (new status, new
  refusal, new cap, new required field) must trace to a numbered plan item; anything else is
  scope creep even when defensible, and belongs in a follow-up. A shared
  validator/extension/helper may only be edited when the plan NAMES it — a rule added to a
  shared composite must be accompanied by the caller inventory (grep the method name) and the
  list of entities and data sources it now binds; if any caller lies outside the plan's
  entity, the rule belongs in that entity's own rules file. Before a new refusal, check the
  sibling axes sharing the helper: if a comparable path tolerates the same limitation
  silently, matching the sibling and documenting the limitation is the conformant outcome

## Does NOT Cover

- Whether the code is correct or buggy in itself (see reviewer-safety-correctness)
- Test quality or coverage judged independently of the plan (see
  reviewer-coverage-critical, reviewer-test-integrity)
- Style, naming, structure (see reviewer-maintainability-design)
- Repo-specific convention violations (see the repo domain-hazards charter)

## Instructions

### Step 1: Read the Plan, Then the Diff

Read the plan file FULLY (the invoking tool provides its path) — every phase's
"Changes Required", its Success Criteria, and the plan's "What We're NOT Doing" section.
Then run the diff commands the invoking tool provides (it supplies the correct base) and
read the full output.

If no plan file is available, report no findings. If no files changed, report no findings.

### Step 2: Cross-Check in Three Directions

- Plan → diff: for EVERY "Changes Required" item, locate the implementing change in the
  diff. Missing or materially different = finding.
- Diff → plan: for every changed file/behavior, find its justification in a phase spec.
  Unjustified change = scope-creep finding, severity by the risk it introduces.
- Verify a sample of ticked Automated Verification checkboxes against the source: a
  ticked box whose criterion does not hold is the most severe finding this reviewer produces.
- Problem → plan: read the plan's own Overview / Problem Statement / Desired End State, then
  for each fallback or degenerate branch it specifies, write out the value that branch emits
  and compare it to the stated problem. A plan that specifies the complained-of value as its
  own outcome is a CRITICAL plan defect — report it even when the diff conforms perfectly.
  This direction is the one no other reviewer covers.

**Finding IDs:** `[PC-C1]`, `[PC-H1]`, `[PC-M1]`, `[PC-L1]`

**Severity guide:**
- CRITICAL: a "Changes Required" item is absent or faked (checkbox ticked, behavior
  missing or stubbed); or the plan itself specifies an outcome that preserves the defect the
  plan says it is fixing
- HIGH: material silent deviation from the specified approach, or scope creep touching
  production behavior; a rule added to a shared validator/helper the plan never named, so it
  binds entities or data sources outside the plan's scope
- MEDIUM: partial implementation whose mismatch was recorded in notes but never
  reconciled; test-only or docs-only scope creep
- LOW: cosmetic deviation from the plan; plan wording ambiguity worth flagging back to
  the plan author

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow
that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier;
use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under
`## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and the plan section/phase it traces to). For a finding against
  the PLAN itself, the location is the plan file and its section heading — quote the sentence
- Observed behavior: what the plan requires vs what the diff does. For a plan defect: what the
  plan specifies vs the problem the plan itself states it is solving
- Impact/risk: concrete consequence of the divergence
- Required fix: implement the missing item, reconcile the deviation, untick the box, or — for a
  plan defect — name the plan decision that must be revisited before this merges
- Verification: exact command(s), test(s), or grep that proves conformance

If a severity level has no findings, omit it; if there are none at all, report no
findings.
