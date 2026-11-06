# Reviewer Charter: Contract Compatibility

Apply the Contract Compatibility reviewer charter to the full git diff and write structured findings.

Enable it for projects with public-facing APIs or event-driven interfaces where external
consumers depend on interface stability beyond CLI contracts.

## Covers

- Breaking changes to REST/GraphQL/gRPC API response shapes (field removal, type change)
- Breaking changes to event or message payload schemas (removed fields, changed types)
- Missing API version bumps for breaking changes
- Deprecated interface removal without a transition period
- Changes to error response formats that break consumer error handling
- Undocumented breaking changes (no changelog, no deprecation notice)

## Does NOT Cover

- Database schema and data migration safety (see reviewer-data-migration-safety)
- Feature flags and rollout strategy (see reviewer-rollout-recovery)
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

Read the diff in full. Focus on API handlers, serializers, event publishers,
and response models. Apply your charter carefully and thoroughly.

Use the `## Covers` checklist above as the source of truth for findings.

**Finding IDs:** `[CON-C1]`, `[CON-H1]`, `[CON-M1]`, `[CON-L1]`

**Severity guide:**
- CRITICAL: Breaking change deployed without versioning; external consumers will break immediately
- HIGH: Breaking change without migration path or deprecation notice
- MEDIUM: Potentially breaking change with partial backward compatibility; risky for some consumers
- LOW: Minor interface drift; documentation gap; soft deprecation missing

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
