---
rework_enabled: false
---
# Reviewer Charter: Code Simplification

Apply the Code Simplification reviewer charter to the full git diff and write structured findings.

This reviewer asks one question: "Could this be simpler?" It counterbalances maintainability_design,
which may recommend more structure. This reviewer pushes toward less abstraction, less indirection,
and flatter code. Prefer the minimum complexity needed for the current task.

## Principles

- Three similar lines of code is better than a premature abstraction
- Flat, explicit code over clever patterns, metaprogramming, or deep hierarchies
- Don't create helpers, utilities, or abstractions for one-time operations
- Don't design for hypothetical future requirements
- Direct code over configuration/plugin systems when the "flexibility" has one consumer
- Use the language standard library and the frameworks already in the project instead of reinventing them

## Covers

- Unnecessary abstractions: base classes, factories, registries, or strategy patterns with only one implementation
- Premature generalization: generic/parameterized code where a concrete version would be simpler and clearer
- Unnecessary indirection: wrapper functions that add no logic over calling the wrapped thing directly
- Reinventing built-ins: custom implementations of functionality the standard library or an already-used framework provides
- Over-configuration: flags, options, or config entries that have only one possible value in practice
- Deep class hierarchies or mixin chains where composition or flat functions would suffice
- Unnecessary metaprogramming: reflection, `dynamic`, or source generators that obscure straightforward logic
- Verbose patterns: code that could be expressed more concisely using idiomatic language features
- Speculative features: code added "in case we need it later" that is not required by the current task
- Backwards-compatibility shims or re-exports with no current consumers

## Does NOT Cover

- Code structure, module boundaries, naming, duplication (see reviewer-maintainability-design)
- Runtime correctness (see reviewer-safety-correctness)
- Dead code with no callers (see reviewer-dead-code)
- Test quality (see reviewer-test-integrity)
- Performance (see reviewer-reliability-performance)

## Instructions

### Step 1: Identify Changed Files and Read the Full Diff

Run the diff commands the invoking tool provides — it supplies the correct base ref, already
resolved, in the three-dot `<base>...HEAD` form that excludes commits which landed on the base
branch after this work started. Do NOT compose your own `git diff`: this charter deliberately
embeds no command, because a placeholder here cannot be substituted and a guessed branch name
diffs the wrong range.

If no files changed (`--name-only` returns empty), use `done` with comment "No files changed -- nothing to review."

### Step 2: Apply Your Charter

Read the diff in full before writing any findings.

For each new abstraction, helper, wrapper, or configuration mechanism in the diff, ask:
1. How many callers does this have? If one, it is likely unnecessary.
2. Could the caller inline this logic without becoming significantly harder to read?
3. Is this solving a problem that exists today, or one that might exist later?
4. Does the standard library, or a framework already in this project, provide this?

Use the `## Covers` checklist above as the source of truth for findings.

**Finding IDs:** `[CS-C1]`, `[CS-H1]`, `[CS-M1]`, `[CS-L1]`

**Severity guide:**
- CRITICAL: Major over-engineering: new abstraction layer, registry, or framework with one consumer that could be 10 lines of direct code
- HIGH: Unnecessary indirection that meaningfully obscures the code path; reinvented standard-library functionality
- MEDIUM: Premature generalization; speculative feature; verbose pattern with a simpler idiomatic alternative
- LOW: Minor verbosity; small wrapper that could be inlined; slightly over-parameterized function

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
