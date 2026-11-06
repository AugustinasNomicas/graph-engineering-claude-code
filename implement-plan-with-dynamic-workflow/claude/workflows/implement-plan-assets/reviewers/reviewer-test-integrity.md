---
rework_enabled: false
---
# Reviewer Charter: Test Integrity

Apply the Test Integrity reviewer charter to the full git diff and write structured findings.

## Covers

- Tests that always pass regardless of behavior (trivially true assertions)
- Assertions that test implementation details rather than observable behavior
- Tests that bypass the real code path (mocking too aggressively, testing mocks not behavior)
- Flaky tests relying on timing, ordering, or external state
- Test setup that makes tests pass in the wrong way (suppressing real errors)
- Missing assertions (test calls code but asserts nothing meaningful)
- Tests that would not catch the bug they appear to test
- Tautological / no-op-passing assertions: a test that would still pass if the SUT did
  nothing. Three forms to flag: (a) asserting a value equals a framework/library default
  the SUT does not set (e.g. HttpClient's 100s Timeout) -- seed a distinctive sentinel
  the default cannot produce and assert the sentinel survives; (b) a negative-inequality
  guard (`NotBe(someDefault)`) used to prove a value's provenance -- replace with
  positive equality against a controlled sentinel; (c) a test left asserting only a
  trivial return value (`result.Should().BeTrue()`) after a decommission/refactor
  stripped its behavioral assertion -- re-anchor to the surviving observable side-effects
  (repository `Received(n)`, persisted state, returned payload), uniformly across sibling
  tests in the file. A negative-path test must also include at least one input OUTSIDE
  the literals the implementation names, so it distinguishes default-deny from
  accidental default-allow.

## Does NOT Cover

- Missing test coverage for untested paths (see reviewer-coverage-critical)
- Redundant or low-value tests that can safely be removed (see reviewer-test-economy)
- Tests that are protected from removal (see reviewer-coverage-critical)
- Code correctness outside tests (see reviewer-safety-correctness)

## Instructions

### Step 1: Identify Changed Files and Read the Full Diff

Run the diff commands the invoking tool provides — it supplies the correct base ref, already
resolved, in the three-dot `<base>...HEAD` form that excludes commits which landed on the base
branch after this work started. Do NOT compose your own `git diff`: this charter deliberately
embeds no command, because a placeholder here cannot be substituted and a guessed branch name
diffs the wrong range.

If no files changed (`--name-only` returns empty), use `done` with comment "No files changed -- nothing to review."

### Step 2: Apply Your Charter

Read the diff in full before writing any findings. Apply your charter carefully and thoroughly.

Focus on test files changed in this diff. For each test, ask: "Would this test catch a realistic regression?"

Use the `## Covers` checklist above as the source of truth for findings.

**Finding IDs:** `[TI-C1]`, `[TI-H1]`, `[TI-M1]`, `[TI-L1]`

**Severity guide:**
- CRITICAL: Test provides false confidence; would pass even if feature is completely broken
- HIGH: Test would miss common regressions or is reliably flaky
- MEDIUM: Assertion is weak; test catches some but not the main failure modes
- LOW: Minor test quality improvement; current test still provides useful signal

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
