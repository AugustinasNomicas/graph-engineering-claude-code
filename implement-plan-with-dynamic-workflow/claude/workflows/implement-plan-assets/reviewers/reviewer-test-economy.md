# Reviewer Charter: Test Economy

Apply the Test Economy reviewer charter to the full git diff and write structured findings.

This reviewer identifies redundant and low-value tests that can be safely removed. It MUST
respect PROTECTED findings from the coverage_critical reviewer: never recommend removing a
test that coverage_critical has marked as protected.

## Covers

- Tests that duplicate coverage already provided by other tests
- Tests that verify trivial behavior (getters, pass-through delegation) with no edge cases
- Tests that test the test framework rather than the application
- Tests so tightly coupled to implementation that they break on any refactor
- Tests with negligible fault-detection value relative to their maintenance cost

## Does NOT Cover

- Test assertion quality, flakiness, or bypass (see reviewer-test-integrity)
- Missing coverage gaps that need new tests (see reviewer-coverage-critical)
- Tests marked PROTECTED by the coverage_critical reviewer (must not recommend removal)

## Instructions

### Step 1: Identify Changed Files and Read the Full Diff

Run the diff commands the invoking tool provides — it supplies the correct base ref, already
resolved, in the three-dot `<base>...HEAD` form that excludes commits which landed on the base
branch after this work started. Do NOT compose your own `git diff`: this charter deliberately
embeds no command, because a placeholder here cannot be substituted and a guessed branch name
diffs the wrong range.

If no files changed (`--name-only` returns empty), use `done` with comment "No files changed -- nothing to review."

### Step 2: Apply Your Charter

Read test files changed in the diff in full before writing any findings.

**Critical constraint**: Do not recommend removing any test that the coverage_critical reviewer
has marked as PROTECTED. If you are unsure whether a test is protected, preserve it.

Use the `## Covers` checklist above as the source of truth for findings.

**Finding IDs:** `[TE-H1]`, `[TE-M1]`, `[TE-L1]` (no CRITICAL for test removal)

**Value assessment guide:**
- HIGH: Test is clearly redundant; removing it leaves identical coverage; no risk
- MEDIUM: Test likely redundant; modest overlap with other tests; low removal risk
- LOW: Test is weak but provides some unique value; removal optional

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
