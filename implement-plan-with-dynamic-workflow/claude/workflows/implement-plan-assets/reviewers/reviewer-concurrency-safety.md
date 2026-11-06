# Reviewer Charter: Concurrency Safety

Apply the Concurrency Safety reviewer charter to the full git diff and write structured findings.

Code that uses async/await or task-based concurrency, background services or hosted workers,
or shared state across concurrent requests is exposed to concurrency hazards. Examples below name
.NET constructs where a concrete one helps; read each as "or your stack's equivalent". This reviewer reviews
changes for race conditions, shared mutable state, and unsafe concurrent access patterns.

## Covers

- Race conditions: time-of-check-to-time-of-use (TOCTOU) on files, database rows, or in-memory state
- Shared mutable state: static fields, singleton service state, or in-process cache entries mutated from concurrent requests/tasks
- Resource coordination: concurrent writes to the same resource (cache entries, files, config) without lock or semaphore coordination
- Thread-affinity of non-thread-safe clients (database sessions/contexts, connections): shared across concurrent operations or registered with too broad a lifetime; long-held transactions blocking other writers
- Background task lifecycle (hosted services, background workers, scheduled jobs — e.g. .NET `IHostedService`): tasks that outlive their scope, missing cancellation-token propagation, resource leaks on task failure
- Atomic operations: non-atomic read-modify-write sequences on shared resources (static fields, cache entries, database rows)
- Async/await hazards: unawaited tasks or promises (fire-and-forget), async signatures a caller cannot await (e.g. .NET `async void`), synchronous blocking on an async result (e.g. .NET `.Result`/`.Wait()`) risking deadlock, captured-context assumptions
- Event ordering: assumptions about event processing order that break under concurrent handling
- Cache invalidation: stale cache reads when underlying data changes between check and use
- Lock discipline: missing or inconsistent lock ordering, locks held across `await`, a semaphore or lock not released on exception paths

## Does NOT Cover

- General correctness of sequential logic (see reviewer-safety-correctness)
- Performance under load (see reviewer-reliability-performance)

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

For each state mutation, shared-resource access, or background-task interaction in the diff, ask:
1. Can another concurrent request, task, or background service access this same state concurrently?
2. Is the read-modify-write sequence atomic, or could it be interrupted across an `await`?
3. If this operation throws midway, is shared state left consistent (and are locks released)?
4. Are there ordering assumptions that break if events arrive out of sequence?

Use the `## Covers` checklist above as the source of truth for findings.

**Finding IDs:** `[CY-C1]`, `[CY-H1]`, `[CY-M1]`, `[CY-L1]`

**Severity guide:**
- CRITICAL: Data corruption or lost writes under normal concurrent usage (e.g. a non-thread-safe client shared across concurrent operations)
- HIGH: Race condition that manifests under typical request load; fire-and-forget task leaking resources on failure
- MEDIUM: TOCTOU window that requires unlikely timing; stale cache with eventual self-correction
- LOW: Theoretical race under extreme conditions; defensive improvement for robustness

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
