# Reviewer Charter: Safety and Correctness

Apply the Safety and Correctness reviewer charter to the full git diff and write structured findings.

## Covers

- Logic errors and incorrect conditionals
- Off-by-one errors and boundary conditions
- Null handling and NullReferenceException risks (nullable reference types ignored)
- Unhandled edge cases that produce incorrect results
- Type coercion problems
- State management bugs
- Silent failures: exceptions swallowed with no logging or fallback
- Fault-handling symmetry: a fault (parse/deserialize/validation/I/O) guarded at one boundary but unguarded at an analogous one in the same flow -- classically an outer guard (the message body) with a missing inner counterpart (a second decode of an embedded payload), so the inner fault bubbles to a catch-all that mishandles it
- Permanent-vs-transient fault routing: a permanent, non-retryable fault (malformed/empty payload, schema/type mismatch, null after deserialize) routed onto a retry/redelivery path -- rethrown to a redelivering consumer, added to a queue failure set (e.g. SQS `BatchItemFailures`), or left to a retrying catch-all -- so it is redelivered until a DLQ fires; or the inverse, a transient fault (DB/HTTP timeout) dropped as if permanent
- Error-path state integrity: data left in corrupt/partial state after a failure
- Resource cleanup on error paths (file handles, connections, locks not released on exception)
- Incorrect assumptions in comments vs actual code behavior
- Sibling/read-write parity: a newly added write path (PATCH/PUT/POST handler) or a
  new variant of an existing method MUST reproduce the guards and shape of the sibling
  read path or method it parallels. Enumerate the sibling's guards and response
  assembly and diff the new code against them: (a) every base-shape (non-embed-gated)
  slot the GET returns must be present in the write 200 body; (b) every id/null guard a
  sibling applies (e.g. `Id == Guid.Empty` -> 404, null-object filtering) must be
  applied identically on the new path; (c) a logical field's read side and write side
  must target the SAME storage location; (d) a new DI/registration variant must mirror
  the sibling's startup/failure semantics. A write path assembled independently of its
  read sibling is a defect even when it compiles and its own tests pass.

## Does NOT Cover

- Exploitability and security vulnerabilities (see reviewer-security)
- Success-path throughput, latency, N+1 queries (see reviewer-reliability-performance)
- Test assertion quality, test bypass, or flakiness (see reviewer-test-integrity)
- Missing test coverage (see reviewer-coverage-critical)
- Code structure, naming, coupling (see reviewer-maintainability-design)
- Dead code: unused functions, unreachable code, stale imports (see reviewer-dead-code)
- Error message quality and actionability (see reviewer-error-message-quality)

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

When the diff handles a fault at one point (catch, skip, retry, fall back), scan the rest of that same flow for every other point the same class of fault can arise, and confirm each is classified and handled consistently -- an outer guard with a missing inner counterpart, or a permanent fault left on a retry path, is a classic miss.

Use the `## Covers` checklist above as the source of truth for findings.

**Finding IDs:** `[SC-C1]`, `[SC-H1]`, `[SC-M1]`, `[SC-L1]`

**Severity guide:**
- CRITICAL: Will cause data corruption, crashes, or incorrect results in normal use
- HIGH: Bug that manifests under common conditions or corrupts state on error
- MEDIUM: Edge case that could cause issues; swallowed exception with no fallback
- LOW: Defensive improvements; unlikely scenarios; minor correctness hardening

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
