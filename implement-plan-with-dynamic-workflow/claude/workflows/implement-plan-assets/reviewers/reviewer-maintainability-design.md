# Reviewer Charter: Maintainability and Design

Apply the Maintainability and Design reviewer charter to the full git diff and write structured findings.

## Covers

- Code structure: namespace/project boundaries, separation of concerns, Clean Architecture layer violations
- Coupling: unnecessary dependencies between layers/projects, circular dependencies
- Duplication: copy-pasted logic that should be shared
- Readability: overly complex control flow, deep nesting (>3 levels), long functions (>50 lines)
- Naming: misleading names, inconsistent conventions, non-descriptive identifiers
- Pattern consistency: new code that deviates from established patterns in the same codebase
- Feature creep: added features or decorative elements not required by the task

## Does NOT Cover

- Runtime correctness, logic errors, exception handling (see reviewer-safety-correctness)
- Security vulnerabilities (see reviewer-security)
- Performance and resource leaks (see reviewer-reliability-performance)
- Test quality and coverage (see reviewer-test-integrity, reviewer-coverage-critical)
- Redundant test removal (see reviewer-test-economy)
- Dead code: unused methods, unreachable code, unused `using` directives (see reviewer-dead-code)
- Error message quality and actionability (see reviewer-error-message-quality)
- Over-engineering, unnecessary abstractions, premature generalization (see reviewer-code-simplification)

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

Use the `## Covers` checklist above as the source of truth for findings.

**Finding IDs:** `[MD-C1]`, `[MD-H1]`, `[MD-M1]`, `[MD-L1]`

**Severity guide:**
- CRITICAL: Fundamental design flaw that blocks safe extension or causes immediate maintenance burden
- HIGH: Significant structural issue; layer violation; large duplication that diverges over time
- MEDIUM: Design smell worth improving; minor layer violation; moderate duplication
- LOW: Style suggestion; minor naming issue; small cleanup opportunity

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
