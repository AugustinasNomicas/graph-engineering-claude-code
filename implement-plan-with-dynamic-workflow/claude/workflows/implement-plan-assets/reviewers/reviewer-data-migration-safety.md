# Reviewer Charter: Data Migration Safety

Apply the Data Migration Safety reviewer charter to the full git diff and write structured findings.

Enable it when changes include schema migrations, data backfills, or stored-format version
upgrades.

## Covers

- Schema changes that break backward compatibility with deployed versions
- Migrations that are not idempotent (unsafe to re-run after partial failure)
- Missing rollback strategy for schema changes (e.g. an empty or incorrect `Down()` method)
- Backfill operations that could corrupt existing data or time out
- Data type coercions that silently truncate or alter values
- Missing null-handling for new NOT NULL columns added to existing tables
- Migrations that lock tables for extended periods
- Missing validation that migration succeeded before marking it done

## Does NOT Cover

- Application-level API or DTO contract compatibility (see reviewer-contract-compatibility)
- Feature flags and deployment rollout strategy (see reviewer-rollout-recovery)
- General correctness of application logic (see reviewer-safety-correctness)

## Instructions

### Step 1: Identify Changed Files and Read the Full Diff

Run the diff commands the invoking tool provides — it supplies the correct base ref, already
resolved, in the three-dot `<base>...HEAD` form that excludes commits which landed on the base
branch after this work started. Do NOT compose your own `git diff`: this charter deliberately
embeds no command, because a placeholder here cannot be substituted and a guessed branch name
diffs the wrong range.

If no files changed (`--name-only` returns empty), use `done` with comment "No files changed -- nothing to review."

### Step 2: Apply Your Charter

Read the diff in full. Focus on migration artifacts (the forward and rollback steps, and any
committed schema snapshot), the model/schema definitions they derive from, and any code that
rewrites stored data. Apply your charter carefully and thoroughly.

Use the `## Covers` checklist above as the source of truth for findings.

**Finding IDs:** `[DM-C1]`, `[DM-H1]`, `[DM-M1]`, `[DM-L1]`

**Severity guide:**
- CRITICAL: Migration will corrupt data, cannot be rolled back, or breaks deployed service
- HIGH: Migration is not idempotent or could fail silently leaving data in inconsistent state
- MEDIUM: Risky operation with partial mitigation; extended table lock; missing validation
- LOW: Best-practice improvement; minor safety gap; documentation missing

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
