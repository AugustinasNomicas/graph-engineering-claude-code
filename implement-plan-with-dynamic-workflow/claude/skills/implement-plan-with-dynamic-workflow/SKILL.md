---
name: implement-plan-with-dynamic-workflow
description: Autonomously implement an approved phase-based plan (the /create-plan format) as a background multi-agent workflow — a dedicated git worktree (or the current checkout in place with noWorktree), each phase implemented by a complexity-driven pass chain plus external reviewer/fixer rounds and independent criteria verification, then the canonical review board + Build/Test/QA gates over the diff. Use when the user wants to "run/execute this plan", "implement this plan autonomously", "turn this plan into a worktree and review it", run a plan "without a worktree" / "in place", or drive an approved plan end to end without supervision. This is the autonomous, multi-agent counterpart to the interactive /implement-plan command. Modes: delegate (default), expand (dry-run preview, mutates nothing), review (board + gates over an existing branch; commits fixes onto it), retrospect (mine human follow-up commits on past runs and propose convention/charter additions).
---

# implement-plan-with-dynamic-workflow

Thin wrapper around the background workflow at
`.claude/workflows/implement-plan-with-dynamic-workflow.js`. It is the **autonomous,
multi-agent** counterpart to the interactive `/implement-plan` command: it takes an
approved **phase-based plan** (what `/create-plan` produces) and drives it end to end —
worktree, per-phase implementation with external review and independent verification,
the review board, and Build/Test/QA gates — running in the background and notifying you on
completion.

It consumes the `## Phase N` / `**Complexity**:` / `### Success Criteria` format, runs phases
sequentially, and binds every implement/review agent to this repository's conventions doc.

**Stack-agnostic.** The workflow script contains no language, framework or cloud specifics and
is meant to stay byte-identical across repositories. Everything local lives in
`.claude/workflows/implement-plan-assets/`:

| File | Holds |
|---|---|
| `repo-profile.json` | toolchain commands, repo label, arch-doc path, domain-reviewer name, extra QA steps |
| `conventions.md` (path set by the profile) | the repo's binding coding rules, injected into every implement and review agent |
| `reviewers/reviewer-<domainReviewer>.md` | the repo-specific hazards charter |

A run **fails fast** if `repo-profile.json` is missing or has no `build_verify_cmd` /
`test_cmd`: gates that execute nothing would report green, which is worse than not starting.

## Preconditions
- The current directory is inside **the target git repo** (the workflow creates a worktree off
  the default branch — or, with `noWorktree`, runs in the current checkout, which then must
  have a **clean working tree**).
- `.claude/workflows/implement-plan-assets/repo-profile.json` **exists and is filled in**, and
  the conventions doc and domain-reviewer charter it names exist and are **committed** (agents
  read them inside a fresh worktree, so uncommitted files are invisible).
- `.claude/ai/` is **gitignored**. It is the pipeline's scratch directory: `/create-plan` writes
  plans there, `retrospect` writes its proposal doc there, and the workflow force-adds a plan
  snapshot onto the branch and strips it before the PR. The load-profile step warns if it is not
  ignored; the finalize step restores (rather than deletes) a plan that the base already tracks.
- An **approved phase-based plan** at a known path (e.g. `.claude/ai/plan-YYYY-MM-DD-*.md`)
  with `## Phase N` headings. Per-phase `**Complexity**: LOW|MEDIUM|HIGH` tags are honored
  (from the updated `/create-plan`); phases without a tag default to MEDIUM.
- The plan should carry an **issue tracker number** (Jira/Linear key, e.g. `PROJ-123`) in its
  frontmatter `issue:` field or `**Issue**:` header line (the updated `/create-plan` writes
  both and puts it in the filename). Every git commit the workflow makes is prefixed with it
  (e.g. `PROJ-456: Datalayer: Initial Implementation`), and the PR title gets the same
  prefix. Plans without an issue key fall back to the repo's `notask:` prefix. Workflow
  provenance is carried in an `Implplan: <stage>` git trailer on every commit (e.g.
  `Implplan: P1/initial`), not in the subject.
- The Test gate runs the profile's `toolchain.test_cmd`. Make that command the one your CI
  trusts, and use `testFilterNote` to record what it deliberately excludes and what the suite
  needs (a container runtime, a database, credentials) — that note is surfaced to the agent
  running the gate. Override per run with `toolchain.test_cmd` in the args.

## Gather inputs (from the user's message)
- `plan` — **path** to the plan markdown (required for delegate/expand).
- `mode` — `delegate` (default) | `expand` | `review` | `retrospect`.
- `profile` — `LOW|MEDIUM|HIGH` override that forces **every** phase's pass depth (default:
  each phase's own `**Complexity**:`).
- `reviewers` — explicit board-reviewer list (hyphenated, e.g. `["security","dead-code"]`) overriding
  profile-based selection; use to request the enterprise reviewers that are off by default.
  (`lenses` is accepted as a legacy alias.)
    (An explicit list also suppresses the automatic `plan-conformance` reviewer — include it
  yourself if you want it.)
- `testFirst` — `true` to prepend a **spec-tests (test-first)** pass on MEDIUM/HIGH phases:
  failing tests + minimal stubs are written from the phase spec before the implementation
  pass. Trial flag, default off.
- `noWorktree` — `true` to **skip worktree creation** and implement in the **current
  checkout** instead (set it when the user says "no worktree" / "in place" / "in this
  checkout"; `worktree: false` is accepted as an alias). Requires a clean working tree
  (the run fails fast otherwise — implement passes commit with `git add -A`). If the
  default branch is checked out, the run creates `implement-plan/<slug>` in place first
  (starting from the base ref, so a stale local default is not built on); on any other
  branch it commits onto that branch as-is (note: the review board then diffs the
  branch's pre-existing commits too).
- `base` — diff base branch (default: `origin/<default>`).
- `worktreePath` — for `review` mode: the worktree/repo to review (default: current repo root).
  Review mode is **not read-only**: the board's fix waves and the QA gate commit onto the branch
  checked out there, so it requires a **clean working tree** and **refuses the default branch**
  (hard stop before any agent touches the tree; the reason is returned in `ctx.error`).
- `branches` — for `retrospect` mode: explicit `implement-plan/*` branches to analyze
  (default: auto-discover).

If no `plan` can be determined for delegate/expand, ask which plan file to run before invoking.

## Invoke
Launch the workflow (runs in the background; you are notified on completion):

```
Workflow({
  scriptPath: ".claude/workflows/implement-plan-with-dynamic-workflow.js",
  args: { plan: ".claude/ai/plan-YYYY-MM-DD-description.md", mode: "delegate" }
})
```

(Project-level — `Workflow({name:"implement-plan-with-dynamic-workflow"})` also resolves
from `.claude/workflows/`.)

**If a run dies or is stopped mid-flight, RESUME it** — do not relaunch from scratch:
`Workflow({scriptPath: "...", args: {...same args...}, resumeFromRunId: "<runId>"})`.
Completed agents (worktree setup, finished passes) replay instantly from cache and the
run continues where it stopped.

## Phases (delegate)
1. **Load profile** — read `repo-profile.json`; resolve toolchain, repo label, conventions and
   arch docs, domain-reviewer name and extra QA steps. Hard-stops on a missing profile or an
   incomplete toolchain.
2. **Parse** — read the plan (+ the profile's `archDoc`, if any); validate it's phase-based;
   extract each phase's name, `**Complexity**:`, spec (`### Overview` + `### Changes
   Required`), and Automated/Manual success criteria, plus shared plan context and the
   issue tracker key (frontmatter `issue:` / `**Issue**:` line / filename) that prefixes
   all commits and the PR.
3. **Set up worktree** — `git worktree add` a fresh `implement-plan/<slug>` branch off the
   base; copy the plan into the worktree and **commit the snapshot** (so later `git add -A`
   passes can't sweep it into a code commit); the profile's `restore_cmd`, if one is set, **then
   `build_verify_cmd`**. That build is required, not an optimisation: a fresh worktree holds no
   generated or derived build outputs, and the implement passes use a faster inner-loop build that
   may assume those exist — without it the first pass can fail on files it never wrote. It also
   warms the tree so later passes pay an incremental build. With `noWorktree`, this
   phase instead prepares the **current checkout in place**: verifies the working tree is
   clean (hard stop if not), branches off in place only when the default branch is checked
   out, and commits the plan snapshot the same way.
4. **Implement phases** — **strictly sequential** (Phase N+1 builds on Phase N). Per phase:
   - **Pass chain** (mutation): LOW → `initial`; MEDIUM/HIGH → `initial → edge_cases`
     (plus `spec_tests` first when `testFirst` is on). Commit subjects are
     `<ISSUE>: <phase>: <pass>` (issue key from the plan; `notask:` when absent), with an
     `Implplan: P<n>/<pass>` trailer marking provenance.
   - **External review rounds**: MEDIUM → one `spec_review`; HIGH → `spec_review` +
     `hardening_review`. Each is a read-only critic framed as reviewing a *colleague's*
     PR against the phase spec (correctness, spec conformance, simplicity / production
     hardening). On a HIGH phase the two reviewers run **concurrently** and a **single fixer**
     applies the union of their findings in one commit (`<phase>: Review Fixes`, trailer
     `Implplan: P<n>/review-fix`); it runs **only if some reviewer found something**.
     Trade-off: `hardening_review` no longer sees `spec_review`'s fixes, so a fix-introduced
     defect is caught later by the review board over the cumulative diff, not inside the phase.
   - **Independent criteria verification**: a separate low-effort agent runs each
     Automated criterion verbatim, records pass/fail with evidence, and ticks the plan
     checkboxes only when everything passed. The implementer never grades its own work.
5. **Review board** — one parallel read-only specialist reviewer per selected charter over the cumulative
   diff (charters vendored at `.claude/workflows/implement-plan-assets/reviewers/`). The
   repo-specific `domainReviewer` charter from the profile is always on; the `plan-conformance` reviewer
   (diff vs. the approved plan) is added automatically when the plan copy is available.
6. **Synthesize** — dedup + conflict-resolve (coverage-critical beats test-economy).
7. **Triage & fix** — **one triage agent per group, in parallel**, each verifying its own group's
   findings against real source; the **script** computes the file-overlap wave order
   deterministically; fixes run in serialized waves.
8. **Quality gates** — Sync → Build → Test → QA using the profile's toolchain, plus its
   `qaExtraSteps` in the QA gate; the Test gate runs via the `test-runner` agent (honoring
   `/implement-plan`'s mandate) on the profile's `test_no_build_cmd` when it has one, reusing
   what the Build gate just produced. A failed Sync **or Build** gate short-circuits the rest,
   and the Build gate fails on **errors only** — warnings are the QA gate's job, and it fixes
   what it safely can.

## Retrospect mode
`mode:"retrospect"` closes the improvement loop: it finds `implement-plan/*` branches
where humans committed on top of workflow commits — identified by the `Implplan:` trailer,
with the legacy `[implplan]` subject marker still recognized on older branches (e.g.
"Address PR review feedback" counts as human follow-up),
classifies what the humans had to change and which pipeline stage should have caught it,
and writes a **proposal document** to `.claude/ai/retrospect-<date>-implement-plan-feedback.md`
suggesting concrete additions to the CONVENTIONS block, the reviewer charters, or
`/implement-plan`'s pitfalls. **Propose-only** — it never edits conventions or charters
itself; a human reviews and applies. Run it after merged PRs from past runs accumulate.

## Notes & caveats
- `expand` is safe — returns the phase list with complexity + passes + reviewers + selected
  board roster; creates no worktree and changes nothing. Good for sanity-checking before a real run.
- **Runtime does not follow your `/effort`.** Every agent pins its own effort/model tier (`TIER`
  in the workflow), so an interactive session set to high or max no longer multiplies all ~30
  serial hops. The `implement_initial` tier is the only `high` one — it covers both the `initial`
  pass and the `spec_tests` pass `testFirst` prepends; reviewers, triage and re-verification are
  `medium`; gates, fixers and mechanical git/shell steps are `low`. Raise a tier in `TIER` rather
  than at a call site.
- **Per-pass self-checks are scoped on purpose.** An implement pass builds with the profile's
  `build_fast_cmd` and runs only the affected tests (its `test_scoped_shape`), rather than the
  whole suite, which the Test gate still runs once, authoritatively. All three speed keys are
  optional and fall back to their full-fat siblings, so a profile written before they existed
  keeps working and simply runs the slower command.
- **Phases run sequentially, never in parallel** — phases depend on prior phases. Concurrency is
  in the **per-phase reviewers**, the review board, the **triage fan-out** and the fix waves.
  (Within a phase, the passes are sequential.)
- **Autonomous, not interactive**: unlike `/implement-plan`, it does not stop to ask on a
  plan/code mismatch — an implement agent does its best partial work and records the mismatch
  in its `notes`; the `plan-conformance` reviewer cross-checks recorded and unrecorded deviations
  later; surface both when relaying the result.
- Implement passes and fix waves **commit to the worktree branch** (local only). The workflow
  itself does **not** push or open a PR — the caller offers that after a successful run (see
  "After completion" below).
- With `noWorktree`, those commits land **in the user's own checkout** (result carries
  `noWorktree: true` and `setup.worktreePath` = the repo root) — when relaying the result,
  say so and name the branch left checked out instead of pointing at a sibling worktree dir.
- **Manual success criteria can't be auto-verified** — they're returned as a per-phase
  `manualChecklist` for a human to confirm.
- **After completion**, relay the summary and point the user at the worktree/branch
  (`implement-plan/<slug>`, a sibling dir of the repo — unless the result says
  `noWorktree: true`, in which case the commits are on a branch in their own checkout and
  there is no sibling dir). The full structured result (phase
  results incl. per-phase review findings and criteria evidence, board findings, fixes, gate
  outcomes, manual checklist, and a `readyForPr` flag) is in the task result; surface any
  incomplete phases, unverified criteria, failed gates, and the `manualChecklist` the human
  still needs to verify.
- **When implementation is fully finished, ask the user whether to open a Pull Request.**
  `readyForPr` now requires all phases complete AND every phase's criteria **independently
  verified** (incl. the post-fix re-verification) AND **every reviewed finding actually fixed, at
  both review layers** AND **the review board reached a verdict** AND Sync/Build/Test/QA gates
  green AND branch hygiene clean. Findings that never got fixed land in one of two lists, and the
  blocking subset of both in a third — relay whichever applies:
  - `unappliedFixes` — **board** findings: a dead fix agent, one reporting `applied=false`, one
    that reported success while naming ids in `unfixedFindingIds`, **or a group whose triage agent
    died**, so its findings were never verified either way (`reason` says which).
  - `unappliedReviewFixes` — the same thing one layer up: **per-phase reviewer** findings whose
    single merged fixer died, reported `applied=false`, or skipped some. Each entry names its phase.
  - `blockingUnappliedFixes` — the readyForPr-blocking subset of **both**: anything not explicitly
    MEDIUM or LOW, so an unrecognised severity blocks rather than slips through. A MEDIUM/LOW miss
    does not block the flag but is still a verified finding nobody fixed.
  - `reviewIncomplete` — non-null when the board never reached a verdict at all: every reviewer
    returned null, the synthesis agent died, **every** group's triage died (a *partial* triage death
    lands in `unappliedFixes` instead), or **synthesis returned zero groups for real findings**.
    An empty `unappliedFixes` here means "nothing was attempted", not "nothing failed".

  Gates fail **closed**, and every gate in the sequence appears in `gates` whatever happened to it,
  so three states are distinguished — they need different follow-up: a normal failure
  (`passed: false`); `agentDied: true` (the gate agent returned null, so it **never ran**); and
  `skipped: true` (an earlier Sync or Build gate did not pass, so this one was deliberately not
  run, and `output` names which gate stopped it).
  If `readyForPr`, ask before creating one — do
  **not** open it automatically (it's outward-facing). On confirmation, push the worktree
  branch and open the PR (e.g. via `/push` then `gh pr create`, or a PR skill), deriving the
  title/body from the plan + phase results and noting the remaining `manualChecklist` in the
  body. **Prefix the PR title with the plan's issue number** (returned as `issue` in the
  workflow result), e.g. `PROJ-456: Implement datalayer`; if the plan has no issue key, use
  the `notask:` prefix per repo convention. If the result is **not** `readyForPr`, report
  what needs fixing first and do not offer the PR yet.
- Pairs with `/create-plan` (author the plan, with complexity tags + issue key) → this workflow (execute
  it) → `retrospect` after merge (harvest what human review still caught). For a quick,
  supervised, in-place run instead, use the `/implement-plan` command.
