---
rework_enabled: false
---
# Reviewer Charter: Security

Apply the Security reviewer charter to the full git diff and write structured findings.

## Covers

- Injection vulnerabilities (SQL, command, XSS, path traversal, template injection)
- Secrets, credentials, or API keys hardcoded or logged
- Input validation and sanitization gaps at trust boundaries
- Authentication and authorization flaws
- SSRF and server-side request forgery risks
- Insecure deserialization
- Race conditions and TOCTOU (time-of-check-time-of-use) issues
- Cryptographic weaknesses (weak algorithms, hardcoded keys, insecure RNG)
- Privilege escalation and insufficient access controls
- Permission and grant scoping in infrastructure-as-code or deployment manifests: prefer
  the narrowest operation-scoped grant over a broad convenience helper, and never grant
  mutating or destructive operations on a resource the code only reads -- or on an
  append-only/audit resource. Enumerate every distinct operation each reachable code path
  invokes, INCLUDING reconciliation, retry and consistency re-read paths, and confirm each
  maps to a granted permission, even when the grant is declared in a different
  project/module than the call site. Watch for permission models where the scope of a
  resource identifier is not what it looks like (path-prefix or hierarchy-rooted
  permissions often need both the root and the wildcard child entry) -- read the provider's
  semantics rather than pattern-matching a sibling.
  Before hand-writing a grant, diff it against the sibling grants already in the repo and
  match the established resource-identifier shape; do not narrow it under a
  "least-privilege" rationale without proving the narrower set still authorizes every
  operation a call site invokes.
  A test asserting a permission statement MUST assert the resource scope and the
  allow/deny effect, not only the operation list. If the assertion style is
  containment-based (order-tolerant, "contains these entries"), it also tolerates
  supersets, so it MUST be paired with an explicit negative guard -- a denylist asserting
  the destructive or broadening operations and resource scopes are ABSENT -- otherwise a
  privilege-widening change passes the suite unnoticed.

## Does NOT Cover

- Generic logic correctness and error-path state (see reviewer-safety-correctness)
- Performance or resource leaks (see reviewer-reliability-performance)
- Test quality or coverage (see reviewer-test-integrity, reviewer-coverage-critical)
- Code structure and naming (see reviewer-maintainability-design)

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

**Finding IDs:** `[SEC-C1]`, `[SEC-H1]`, `[SEC-M1]`, `[SEC-L1]`

**Severity guide:**
- CRITICAL: Exploitable now; data breach, RCE, or authentication bypass risk
- HIGH: Significant weakness; needs fix before production
- MEDIUM: Security concern with lower exploitability or requires specific conditions
- LOW: Defense-in-depth hardening; unlikely attack vector

### Step 3: Report Findings

The invoking tool defines the output format and the structured shape it expects — follow that. Do not emit a plain-text "completion comment", and do not invent a reviewer identifier; use the reviewer key the tool gives you.

Report findings ONLY within this charter's `## Covers` (omit anything under `## Does NOT Cover`). Make each finding implementation-ready:

- Location: exact file:line (and symbol/test name when relevant)
- Observed behavior: what is wrong and why it violates this charter
- Impact/risk: concrete failure mode if unfixed
- Required fix: specific code/config/test change expected
- Verification: exact command(s) or test(s) to prove the fix

If a severity level has no findings, omit it; if there are none at all, report no findings.
