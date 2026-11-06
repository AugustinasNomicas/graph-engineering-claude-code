# Reviewer Charter: Observability and Diagnostics

Apply the Observability and Diagnostics reviewer charter to the full git diff and write structured findings.

Enable it for projects where production observability is a requirement.

## Covers

- Missing or insufficient logging at key decision points and boundaries
- Logs that expose sensitive data (credentials, PII, tokens)
- Missing metrics or counters for operations that should be monitored
- Missing distributed trace context propagation (e.g. OpenTelemetry activity/span context not flowed across async or service boundaries)
- Error messages that lack actionable diagnostic context (no request ID, no context)
- Missing alertability: conditions that should trigger alerts but have no signal
- Log levels that are wrong (debug level for production-critical events; info level for noise)
- Structured vs unstructured logging consistency (e.g. interpolating values into the message string instead of using the logger's message-template or structured-fields API — in .NET, bypassing `ILogger` templates breaks Serilog's structured fields)
- Dead diagnostics on optional parameters: when a method takes an OPTIONAL diagnostics
  parameter (a logger defaulting to null, a metrics hook) and its logging is documented -- in a
  docstring, comment or plan -- as the way a silent skip, drop or degradation gets detected,
  verify the parameter is actually passed at EVERY production call site (grep the callers; test
  wiring does not count). If any production caller omits it, the "only detector" is dead and the
  data-loss path is invisible: file a finding, and prefer making the parameter required or adding
  a test that the logger is invoked through real wiring. Optional loggers look benign; that is why
  this check is explicit

## Does NOT Cover

- Error handling correctness and exception swallowing (see reviewer-safety-correctness)
- Performance and throughput (see reviewer-reliability-performance)
- Security of log data at rest or in transit (see reviewer-security)

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

**Finding IDs:** `[OD-C1]`, `[OD-H1]`, `[OD-M1]`, `[OD-L1]`

**Severity guide:**
- CRITICAL: Production incident impossible to diagnose; sensitive data exposed in logs
- HIGH: Key failure path has no diagnostic signal; major observability gap
- MEDIUM: Useful signals missing; error context incomplete; wrong log level for important events
- LOW: Minor improvement to diagnostic quality; nice-to-have instrumentation

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
