---
rework_enabled: false
---
# Reviewer Charter: Reliability and Performance

Apply the Reliability and Performance reviewer charter to the full git diff and write structured findings.

## Covers

- Algorithmic complexity regressions (O(n^2) where O(n) is feasible)
- N+1 query patterns in database or I/O access, including ORM lazy-loading in a loop
- Resource leaks on the SUCCESS path (database sessions and connections, file handles, locks not released after success)
- Blocking operations in async/await contexts (sync-over-async, `.Result`/`.Wait()` on a Task)
- Excessive or redundant I/O operations (reading same file repeatedly, unnecessary round trips)
- Scalability bottlenecks: unbounded memory growth, accumulation of state
- Negative/fallback caching that outlives the outage: an error fallback, empty result, or degraded-mode default cached with a TTL longer than the failure it papers over, so stale/degraded values keep being served after the dependency recovers (e.g. an "unresolved -> use the raw id" fallback cached for minutes past DB/HTTP recovery); missing or over-long negative-cache TTLs
- Throughput and latency regressions under normal load
- Over-wide cost predicates: when code pays a per-request cost (strongly-consistent read, extra query, extra publish, retry, lock acquisition) to enable a downstream behaviour, locate the guard that CONSUMES it, quote both predicates side by side in the finding, and require spend ⊆ consume. If the consumer allowlists a set (one action, one entity kind, one flag state), the spend must name that same set, not a proxy such as "the feature is configured on". The two predicates are typically far apart and in opposite polarity, so reading either hunk alone looks correct — go find the other one. Also flag the absence of a negative test pinning that the cost is NOT paid for the states that never reach the consumer: every test passes with the wider read, so no existing test can fail on this

## Does NOT Cover

- Resource cleanup on ERROR paths and exception handling (see reviewer-safety-correctness)
- Logging quality and diagnostic instrumentation (see reviewer-observability-diagnostics)
- Rollout strategy and blast-radius containment (see reviewer-rollout-recovery)
- Correctness bugs that happen to affect performance (see reviewer-safety-correctness)

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

**Finding IDs:** `[RP-C1]`, `[RP-H1]`, `[RP-M1]`, `[RP-L1]`

**Severity guide:**
- CRITICAL: Will cause timeouts, OOM errors, or cascade failure under expected load
- HIGH: Significant performance regression; noticeable degradation under common usage
- MEDIUM: Inefficiency that compounds at scale or causes measurable slowdown
- LOW: Minor optimization opportunity; unlikely to matter at current scale

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
