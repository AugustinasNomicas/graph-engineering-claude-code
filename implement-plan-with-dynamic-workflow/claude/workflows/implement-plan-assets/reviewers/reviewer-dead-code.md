# Reviewer Charter: Dead Code

Apply the Dead Code reviewer charter to the full git diff and write structured findings.

This reviewer focuses exclusively on code that is no longer reachable, referenced, or necessary.
It goes deeper than the maintainability_design reviewer by actively tracing call graphs and
using/namespace dependencies rather than just spotting obvious unused using directives.

## Covers

- Methods, properties, types, and members (`public`/`internal`/`private`) that are defined but never called or referenced
- Files or namespaces added or modified that are never referenced from anywhere
- Unreachable code after early returns, unconditional throws, or process exit
- Stale `using` directives: namespaces imported but no type from them is referenced
- Dead parameters: method parameters that are accepted but never read
- Commented-out code blocks or dead `#region`s left in the diff (not TODOs -- actual dead logic)
- Feature flags or conditionals that always evaluate to the same branch
- Conditionally inert logic: a branch or guard whose precondition can never be true given how the code is actually invoked -- e.g. a cancellation-classification branch reached only with a no-op cancellation token (e.g. .NET `CancellationToken.None`), or a handler for an argument value no caller supplies. Flag it as inert and ask whether it is deliberate parity/forward-compat scaffolding (which should then say so in a comment) or genuinely removable -- do not assume deletion
- Orphaned test helpers, fixtures, or `TestUtilities` entries no longer used by any test
- Stale configuration entries (options/settings registered but never wired, config keys read but never acted on)
- Backwards-compatibility shims, re-exports, or aliases that no longer have consumers

## Does NOT Cover

- Code structure, coupling, duplication, naming (see reviewer-maintainability-design)
- Runtime correctness of live code (see reviewer-safety-correctness)
- Redundant tests that duplicate coverage (see reviewer-test-economy)

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

For each new or modified symbol (method, class, constant, `using` directive):
1. Search the codebase for references to that symbol
2. If the symbol is `public`/`internal`, check whether any other namespace or assembly references it
3. Trace parameters of new/modified methods to confirm each is actually used in the body
4. For new conditionals/guards, check the values callers actually supply -- a branch no caller can trigger (a cancellation token that is always the no-op one, an enum case never passed, a flag pinned by config) is inert even though its symbols are "referenced"

Use the `## Covers` checklist above as the source of truth for findings.

**Finding IDs:** `[DC-C1]`, `[DC-H1]`, `[DC-M1]`, `[DC-L1]`

**Severity guide:**
- CRITICAL: Entire namespace or large class is unreachable; significant dead weight shipped
- HIGH: Public method/property never called; dead parameter in a widely-used interface
- MEDIUM: Stale `using` directive, small dead helper, or commented-out block; minor bloat
- LOW: Single unused variable or minor leftover; trivial cleanup

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
