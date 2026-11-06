# Reviewer Charter: Rollout and Recovery

Apply the Rollout and Recovery reviewer charter to the full git diff and write structured findings.

Enable it for projects deployed to production where safe rollout and instant rollback are
critical availability requirements.

## Covers

- Missing feature flags for risky new behavior (changes that should be gated)
- Missing kill-switch for new integrations or external dependencies
- Changes that cannot be safely rolled back without data loss or downtime
- Missing canary or staged rollout strategy for high-blast-radius changes
- Blast-radius analysis: changes that affect all users vs. a subset
- Missing health check or readiness probe updates for new behavior
- Changes that require coordinated deployment order (deploy A before B)
- Missing documentation of rollout steps or operational runbook

## Does NOT Cover

- Database schema changes and migration idempotency (see reviewer-data-migration-safety)
- Performance under load (see reviewer-reliability-performance)
- General correctness of business logic (see reviewer-safety-correctness)

## Instructions

### Step 1: Identify Changed Files and Read the Full Diff

Run the diff commands the invoking tool provides — it supplies the correct base ref, already
resolved, in the three-dot `<base>...HEAD` form that excludes commits which landed on the base
branch after this work started. Do NOT compose your own `git diff`: this charter deliberately
embeds no command, because a placeholder here cannot be substituted and a guessed branch name
diffs the wrong range.

If no files changed (`--name-only` returns empty), use `done` with comment "No files changed -- nothing to review."

### Step 2: Apply Your Charter

Read the diff in full. Focus on changes to user-facing behavior, integrations, and
configuration. Apply your charter carefully and thoroughly.

Use the `## Covers` checklist above as the source of truth for findings.

**Finding IDs:** `[RR-C1]`, `[RR-H1]`, `[RR-M1]`, `[RR-L1]`

**Severity guide:**
- CRITICAL: Change cannot be rolled back; immediate blast radius is all users or all data
- HIGH: No kill-switch; staged rollout impossible; rollback requires data loss
- MEDIUM: Blast radius is large but rollback is possible; partial mitigation in place
- LOW: Best-practice improvement; runbook missing; flag recommended but not critical

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
