export const meta = {
  name: 'implement-plan-with-dynamic-workflow',
  description: 'Autonomously implement an approved phase-based plan (the /create-plan format) as a background multi-agent workflow: a dedicated git worktree (or the current checkout in place with noWorktree), each phase implemented by a complexity-driven pass chain plus external reviewer/fixer rounds and independent criteria verification, then a parallel review board + Sync/Build/Test/QA gates over the diff.',
  whenToUse: 'When you have an approved phase-based implementation plan (## Phase N + **Complexity** + ### Success Criteria, from /create-plan) and want it driven end to end without supervision. delegate (default): worktree + per-phase implementation (pass chain -> external review -> criteria verification) + review board + Sync/Build/Test/QA. expand: dry-run preview (phases, passes, board roster) — mutates nothing. review: board + gates over an existing branch — NOT read-only: it commits board fixes and QA formatting onto that branch, so it requires a clean tree and refuses the default branch. retrospect: mine human follow-up commits on past implement-plan branches and propose convention/charter additions (propose-only). Args: {plan, mode?, profile?, base?, reviewers?, testFirst?, noWorktree?, branches?, toolchain?, worktreePath?}.',
  phases: [
    { title: 'Load profile', detail: 'Read the repository profile (toolchain commands, conventions doc, domain reviewer) that localizes this run' },
    { title: 'Parse', detail: 'Read the plan (+ the architecture doc if the profile names one); extract phases, per-phase complexity, success criteria, issue tracker key (commit/PR prefix), shared context' },
    { title: 'Set up worktree', detail: 'git worktree add a fresh implement-plan/<slug> branch off the base (or, with noWorktree, prepare the current checkout in place: clean tree required); commit the plan snapshot; restore deps' },
    { title: 'Implement phases', detail: 'Sequentially: each phase runs its pass chain (optional spec-tests -> initial -> edge cases), then its external reviewers CONCURRENTLY with one merged conditional fixer, then an independent criteria-verify agent' },
    { title: 'Review board', detail: 'One parallel read-only specialist reviewer per selected charter over the cumulative diff (plan-conformance added automatically when the plan copy is available)' },
    { title: 'Synthesize', detail: 'Dedup + conflict-resolve findings across board reviewers' },
    { title: 'Triage & fix', detail: 'One triage agent per group verifies its findings against source in parallel; the script computes file-overlap wave order; fixes run in serialized waves' },
    { title: 'Quality gates', detail: 'Sync (merge the base) -> Build -> Test (test-runner agent, reusing the build) -> QA (format/lint, profile-defined extra checks, warning-clean build), sequential on the profile toolchain; a failed Sync or Build skips the rest' },
    { title: 'Finalize', detail: 'delegate: re-verify automated criteria over the post-board-fix HEAD, then strip the internal plan snapshot so the PR diff carries only product files' },
    { title: 'Discover cases', detail: 'retrospect: find implement-plan branches with human follow-up commits on top of workflow commits (Implplan trailer, or legacy [implplan] subjects)' },
    { title: 'Analyze feedback', detail: 'retrospect: classify what humans changed and where the pipeline should have caught it' },
  ],
}

// =====================================================================================
// Implement an approved PHASE-BASED plan autonomously, with a fleet of subagents.
//
// STACK-AGNOSTIC BY DESIGN. This file contains no language, framework, cloud or
// repository specifics and is meant to be copied VERBATIM into any repo. Everything
// local lives in two files next to it, both read by agents at run time:
//
//   implement-plan-assets/repo-profile.json    toolchain commands, repo label, arch-doc path,
//                                         domain-reviewer name, extra QA steps
//   implement-plan-assets/conventions.md  the repo's binding coding rules, injected into
//                                         every implement and review agent
//
// A workflow script has no filesystem access, so the profile is fetched by one cheap
// load-profile agent in the first phase rather than being read directly here. If you find
// yourself editing this file to make it fit your repo, the thing you need is almost
// certainly a profile field or a conventions rule instead.
//
// Design notes:
//   - Consumes "## Phase N" + "**Complexity**:" + "### Success Criteria" (NOT a Task Graph).
//   - Phases run STRICTLY SEQUENTIALLY (Phase N+1 builds on Phase N). Concurrency is in
//     the review board + fix waves.
//   - Per phase: a short mutation pass chain, then EXTERNAL REVIEWER rounds (read-only
//     critics framed as reviewing a colleague's PR against the phase spec; a fixer runs
//     only when a reviewer finds something), then an INDEPENDENT criteria-verify agent
//     (the implementer never grades its own homework). This replaced the old
//     correctness/simplicity/excellence self-review passes, which run-history showed
//     changed almost nothing (~±13 lines across 10 commits) — external framing is what
//     empirically yields fixes.
//   - Every implement and review agent is bound by the repo's conventions doc (named by the
//     profile) plus the workflow-mechanics rules in conventionsBlock() below.
//   - Reviewer charters are vendored files agents read, so a charter edit needs no code change.
//   - retrospect mode closes the loop: it mines "what humans still had to fix" on past
//     implement-plan branches and PROPOSES convention/charter additions (it edits nothing).
//   - RUNTIME: every agent pins its own effort/model via TIER, so a run does not inherit (and
//     multiply by ~30 SERIAL hops) whatever /effort the caller's session happens to be set to.
//     The per-phase reviewers run concurrently with ONE merged fixer, triage fans out one agent per
//     group, and per-pass self-checks are scoped (see the optional toolchain speed keys).
//   - readyForPr also requires that every VERIFIED finding actually got fixed, from BOTH review
//     layers. A fix agent that dies, reports applied=false, or names ids in unfixedFindingIds
//     records them in `unappliedFixes` (board) or `unappliedReviewFixes` (per-phase reviewers); a
//     group whose TRIAGE agent died lands in `unappliedFixes` too, since its findings were never
//     verified either way. CRITICAL/HIGH — or an unrecognised severity — blocks readyForPr;
//     MEDIUM/LOW is surfaced but non-blocking. `reviewIncomplete` blocks separately when the board
//     never reached a verdict, including a synthesis that returned zero groups for real findings.
//     Gates fail closed too: a dead gate agent is recorded as a FAILED gate, never omitted.
//   - FINALIZE (delegate only, after the QA gate): board-review fix waves are behavior-changing
//     commits made AFTER each phase's criteria verification, so when any board fix lands the run
//     re-verifies the automated criteria over the post-fix HEAD (catches fix-introduced
//     regressions); it then strips the internal plan snapshot (and its checkbox commits) so the
//     PR diff carries only product files, failing loudly if any other gitignored path leaked in.
//
// If a run dies mid-flight, resume it with Workflow({scriptPath, resumeFromRunId}) —
// completed agents replay from cache; do NOT relaunch from scratch.
// =====================================================================================

// ---------- profile: the ONLY place this pipeline learns about your repo ----------
// Localization lives in a JSON file that a load-profile agent reads at run start. Nothing
// below is stack-specific; see implement-plan-assets/repo-profile.example.json for the shape and
// the bundle README for per-stack command tables.
//
//   repoLabel       human name used in agent prompts ("the acme-api repo")
//   toolchain       restore_cmd (optional) / build_verify_cmd / test_cmd / format_cmd / lint_cmd
//                   plus three OPTIONAL speed keys, each falling back to its full-fat sibling:
//                   build_fast_cmd     inner-loop build that skips codegen/docs/packaging
//                   test_no_build_cmd  the test command without its implicit rebuild
//                   test_scoped_shape  template showing how to run ONE test project/file
//   conventionsDoc  repo-relative path to the binding conventions doc. Read by every agent that
//                   implements, fixes or reviews, and by the QA gate. NOT by parse, setup,
//                   criteria-verify, synthesis, triage, the other gates, finalize or the retro
//                   stages — a rule aimed at one of those does not reach it from here.
//   archDoc         optional architecture/overview doc agents read before coding
//   domainReviewer  charter name of the repo-specific hazards reviewer (always on the board)
//   qaExtraSteps    extra QA-gate commands/checks your build and formatter do NOT catch
//   testFilterNote  optional caveat appended wherever test_cmd is shown to an agent
const REPO_PROFILE_REL = '.claude/workflows/implement-plan-assets/repo-profile.json'
const FALLBACK_REPO_PROFILE = {
  repoLabel: 'this repository',
  toolchain: {
    restore_cmd: '',
    build_verify_cmd: '',
    test_cmd: '',
    format_cmd: '',
    lint_cmd: '',
    build_fast_cmd: '',
    test_no_build_cmd: '',
    test_scoped_shape: '',
  },
  conventionsDoc: '.claude/workflows/implement-plan-assets/conventions.md',
  archDoc: '',
  domainReviewer: 'domain-hazards',
  qaExtraSteps: [],
  testFilterNote: '',
}
// Mutable module state, set once by the load-profile phase before any prompt is built.
// (COMMIT_PREFIX below uses the same late-binding pattern for the issue key.)
let REPO_PROFILE = FALLBACK_REPO_PROFILE
let TOOLCHAIN = FALLBACK_REPO_PROFILE.toolchain
let REPO_LABEL = FALLBACK_REPO_PROFILE.repoLabel

// The three optional speed keys, resolved. Each degrades to its full-fat sibling, so a profile
// written before these existed keeps working unchanged and simply runs the slower command.
// MEASURED on one .NET repo, for a sense of the prize: the whole-solution test sweep was ~16-25x
// running the one affected test project, and dropping the implicit rebuild from the test command
// roughly halved it. The scoped-test win is the big one; a fast build is usually minor.
function fastBuildCmd() {
  return TOOLCHAIN.build_fast_cmd || TOOLCHAIN.build_verify_cmd
}
function noBuildTestCmd() {
  return TOOLCHAIN.test_no_build_cmd || TOOLCHAIN.test_cmd
}
// Empty when the profile does not describe one — callers then ask for a scoped run in prose
// instead of naming a shape, because guessing a stack's scoping syntax is worse than not trying.
function scopedTestShape() {
  return TOOLCHAIN.test_scoped_shape || ''
}
// A fast build only exists as a DISTINCT command when the profile supplied one.
function hasFastBuild() {
  return !!(TOOLCHAIN.build_fast_cmd && TOOLCHAIN.build_fast_cmd !== TOOLCHAIN.build_verify_cmd)
}

// ---------- implement pass chains per complexity ----------
// Mutation passes only. Review/verification is handled by REVIEW_ROUNDS + criteria-verify,
// not by same-agent self-review passes (empirically near-zero yield).
const PASS_CHAINS = {
  LOW: ['initial'],
  MEDIUM: ['initial', 'edge_cases'],
  HIGH: ['initial', 'edge_cases'],
}
// External reviewer rounds per complexity (read-only critic -> conditional fixer).
const REVIEW_ROUNDS = {
  LOW: [],
  MEDIUM: ['spec_review'],
  HIGH: ['spec_review', 'hardening_review'],
}
const PASS_LABEL = {
  spec_tests: 'Spec Tests',
  initial: 'Initial Implementation',
  edge_cases: 'Edge Case Review',
}
const PASS_INTENT = {
  edge_cases:
    'unhandled edge cases — null/empty/missing inputs, boundary values, concurrency, partial failure, resource cleanup, timeouts. Add handling and cover it with tests.',
}
const REVIEW_VANTAGE = {
  spec_review:
    'correctness (logic errors, wrong conditions, broken contracts, mishandled errors and return values), spec conformance (EVERY item under the phase spec implemented; no silent deviations; no scope creep beyond the spec), and simplicity (duplication or needless abstraction a human reviewer would insist on removing).',
  hardening_review:
    'production hardening — trust-boundary validation, observability of load-bearing paths (structured logging with parameters, never interpolation), failure modes (partial failure, retries, cancellation, timeouts), concurrency assumptions, resource cleanup, and client-facing error-message hygiene.',
}

// ---------- conventions injected into implement + review agents ----------
// Two layers, deliberately separated:
//   (a) YOUR repo's coding rules — NOT in this file. They live in the profile's conventionsDoc
//       and agents are ordered to read it in full and treat it as binding. Put language,
//       framework, testing and domain rules there; that file is where a retrospect run's
//       accepted proposals land, so it grows without ever touching this script.
//   (b) WORKFLOW-MECHANICS rules below — properties of this pipeline (who may fix what, when
//       verification is invalidated, gate ordering, branch hygiene), true regardless of stack.
// Built as single-quoted lines (no backticks/apostrophes) to avoid template-escaping noise.
// For the QA gate, which EDITS and COMMITS code (formatting, leftover cleanup, warning fixes) and is
// the LAST agent to touch it before finalize — yet used to receive no conventions at all. That is how
// a hygiene checklist comes to undo something a rule requires: "remove unused imports" is a safe
// instruction until the repo has an import that supplies extension methods and looks unused.
// It reads the conventions doc because here the rules are EXTERNAL — that file IS the rulebook — but
// not archDoc, which is per-finding context and this gate has no findings.
function conventionsBlockForGate() {
  return [
    'Repository conventions (MANDATORY — you are about to EDIT and COMMIT code):',
    '- BEFORE changing anything, READ ' +
      REPO_PROFILE.conventionsDoc +
      ' IN FULL and treat every rule in it as BINDING. It is committed in this worktree.',
    '- A rule in that file OUTRANKS any cleanup on your checklist. Where a step below would undo something a rule requires, the rule wins and you leave the code alone — say so in your output rather than "fixing" it.',
  ].join('\n')
}

function conventionsBlock() {
  const tc = TOOLCHAIN
  const lines = [
    'Repository conventions (MANDATORY):',
    '- BEFORE writing any code, READ ' +
      REPO_PROFILE.conventionsDoc +
      ' IN FULL and treat every rule in it as BINDING. It is this repository’s convention charter (language, framework, test structure, domain pitfalls) and it is committed in this worktree. If it contradicts your habits, the file wins.',
  ]
  if (REPO_PROFILE.archDoc)
    lines.push(
      '- Also read ' + REPO_PROFILE.archDoc + ' for architecture and context before changing code that interacts with it.'
    )
  lines.push(
    '- Follow the patterns already present in the code you are touching rather than introducing new ones; a change that reads like the surrounding code is worth more than a cleverer one.',
    '- Run the relevant tests through the test-runner discipline' +
      (tc.test_cmd ? ' (' + tc.test_cmd + ')' : '') +
      ', not ad-hoc; keep the build warning-clean.'
  )
  return lines.join('\n')
}

// Guardrail for agents that JUDGE or CHANGE code in response to a review finding. Appended to the
// reviewer and fixer prompts, and to the board reviewers that receive the conventions block.
function guardrailsRule() {
  return '- GUARDRAILS: a reviewer or fixer pass must never add throw-on-missing-configuration at startup or dependency registration unless the plan designates that key as required-at-startup; grep the config key across every entry point first and match any tolerant sibling registration (missing optional-integration config degrades to best-effort, it does not fault the process). A fixer test that pins a NEW behavioral contract (startup throw, required key, rejection path) must cite the plan section or sibling behavior mandating it — otherwise treat it as pinning a potential regression.'
}
// Fixer-only mandate, on top of the guardrail above.
function fixerRules() {
  return [
    '- FIXER ROUNDS: coverage findings from the review board are not advisory — a fixer round must implement each one as a real test, or record per finding why it is infeasible, before the run may finish.',
    // A sentence deleted as factually wrong survived verbatim elsewhere, ten stale references
    // outlived a member move, and a hard-coded bullet count drifted when a fix split a bullet.
    '- FIX PROPAGATION: a fix is not applied until its other occurrences are. When a fix deletes or corrects a sentence as factually wrong, grep the repo for the same and paraphrased sentence and fix ALL occurrences in the same commit, not only the flagged line. When a fix moves, renames or deletes a member, grep the WHOLE repo (docs, code comments, test names, test failure messages, operator messages) for the old qualified name and the behaviour phrase it implemented; test failure messages and operator guidance are documentation too. After repointing callers, grep for members left with zero references and delete them in the same change. Never leave a hard-coded count of an enumerated list ("the five paths below"): reword it without the count, or re-verify the count in the same edit that changes the list.',
    // A board fixer added a payload limit on five entities and a rejection the sibling field
    // tolerates, after criteria verification had already run; a human reverted both.
    '- FIX SCOPE: a fixer must not introduce a rejection, cap, limit or status code the plan does not list. Before adding any client-error refusal, cite by file:line the closest sibling that already refuses the same case (the same check on another field or entity, or the same limitation elsewhere in the codebase); if the sibling tolerates it, do not reject. If the fix changes a shared helper (a shared validator, base class or mapper), list every caller outside the scope of the plan first: any such caller turns the fix into a deferral, recorded per finding in unfixedFindingIds with the reason, with the code left alone. Turning a 500 into the 400 a sibling already returns for the same input is not new behaviour.',
    guardrailsRule(),
  ].join('\n')
}

// DELIBERATELY NOT in any agent prompt: the RE-VERIFICATION, FINAL QA GATE ORDER and FINALIZATION
// GATE rules that used to sit in the block above. Each is already enforced by a dedicated stage of
// this script (criteriaReverifyPrompt + criteriaReOk; the gate sequence + gatePrompt('qa'), which
// is also where qaExtraSteps reaches an agent; finalizePrompt + hygieneOk). Shipping them to every
// implement and fix agent made those agents ACT on them mid-run: on the repo this pipeline came
// from, branches carry three separate mid-run "Drop plan snapshot from branch" commits deleting the
// 800-1000 line plan snapshot that the next criteria-verify then had to re-add — which is how a
// phase ends up with no criteria-verified commit at all. A rule delivered to an agent that cannot
// act on it is not inert; it is a bug.

// ---------- per-role effort / model tiers ----------
// EVERY agent pins its own effort so total runtime does not scale with the CALLER's /effort
// setting. It used to: most agents passed no effort, so an interactive session set to high or max
// multiplied all ~30 SERIAL hops. Reconstructed from a real 4-phase run on the repo this pipeline
// came from (timestamps read off the Implplan commit trailers): 5.9h total, of which the per-phase
// reviewer+fixer rounds were 37% at 18-32 min PER ROUND — a reasoning-effort artifact, not work,
// since the entire build-and-test cost of that run was ~8%.
// Raise a tier here rather than at a call site. implement_initial is the only 'high' tier, and it
// covers both the `initial` pass and the `spec_tests` pass that `testFirst` prepends.
const TIER = {
  load_profile: { effort: 'low' },
  parse: { effort: 'low' },
  // git/shell, but with branch-naming and clean-tree safety logic: cheap effort, default model.
  setup: { effort: 'low' },
  implement_initial: { effort: 'high' },
  implement_refine: { effort: 'medium' },
  phase_review: { effort: 'medium' },
  phase_fix: { effort: 'low' },
  criteria_verify: { effort: 'low' },
  board_review: { effort: 'medium' },
  // Pure JSON dedup/grouping over findings already in the prompt — no file reads.
  synthesis: { effort: 'medium', model: 'sonnet' },
  triage: { effort: 'medium' },
  board_fix: { effort: 'low' },
  gate_sync: { effort: 'low' },
  gate_build: { effort: 'low', model: 'haiku' },
  gate_test: { effort: 'low' },
  gate_qa: { effort: 'low' },
  // Aggregates pass/fail across every phase over the final HEAD and is the last gate before
  // readyForPr — a wrong "allPassed" is costly, so this one stays at medium.
  reverify: { effort: 'medium' },
  hygiene: { effort: 'low' },
  review_ctx: { effort: 'low', model: 'haiku' },
  retro_discover: { effort: 'low' },
  retro_analyze: { effort: 'medium' },
  retro_synth: { effort: 'medium' },
}
// Merge a tier into an agent() options object.
function withTier(base, tier) {
  return Object.assign({}, base, tier || {})
}

// The reviewer-shaped conventions block, for EVERY read-only reviewer — the whole board and the
// per-phase reviewers alike. A subset of the board used to get it, and the
// omission is not a gap but a FALSE-FINDING generator, because rules in your conventions doc exist
// precisely to stop a reviewer raising something. Two examples that bite in any stack: a rule saying
// "this import looks unused but supplies an extension method, build before deleting it" is aimed
// squarely at a dead-code reviewer, and a rule saying "keep user-facing error text generic" is aimed
// at an error-message reviewer. Exclude those two and each files a confident finding a fixer acts on.
// Reviewers still READ the conventions doc in full — unlike an inline rule block, the rules here are
// EXTERNAL, so that file IS the rulebook and skipping it would leave a reviewer with nothing. What
// they are spared is the archDoc (consulted per finding, not up front) and the test-runner bullet,
// which a read-only agent cannot act on.
function conventionsBlockForReview() {
  const lines = [
    'Repository conventions (MANDATORY — these are the standard you judge against):',
    '- BEFORE you judge anything, READ ' +
      REPO_PROFILE.conventionsDoc +
      ' IN FULL. It is this repository’s convention charter (language, framework, test structure, domain pitfalls), it is committed in this worktree, and it outranks your own habits.',
    '- A finding that CONTRADICTS a rule in that file is a FALSE finding, and the rule wins — do not file it. If you believe a rule is itself wrong for this change, say so explicitly in the finding instead of quietly filing against it.',
    '- Judge the code against the patterns already present around it, not against the patterns you would have chosen.',
  ]
  if (REPO_PROFILE.archDoc)
    lines.push(
      '- Consult ' +
        REPO_PROFILE.archDoc +
        ' only when a specific finding depends on it. You are not implementing; do not read it up front.'
    )
  lines.push(guardrailsRule())
  return lines.join('\n')
}

// ---------- review-board catalog (selection mirrors plan-pipeline) ----------
const ACTIVE_BOARD_TAGS = ['core']
const PROFILE_ORDER = { LOW: 1, MEDIUM: 2, HIGH: 3 }
// The domain-hazards reviewer is named by the profile (`domainReviewer`) because its charter is
// repo-specific: the failure patterns this codebase has already paid for. Start it near-empty
// and let retrospect fill it — that charter is where the pipeline's local knowledge accumulates.
function boardCatalog() {
  return BOARD_CATALOG_BASE.map((l) =>
    l.reviewer === DOMAIN_REVIEWER_SLOT ? Object.assign({}, l, { reviewer: REPO_PROFILE.domainReviewer }) : l
  )
}
const DOMAIN_REVIEWER_SLOT = '__domain__'
const BOARD_CATALOG_BASE = [
  { reviewer: 'safety-correctness', risk: 'LOW', enabled: true, tags: ['core'] },
  { reviewer: 'security', risk: 'LOW', enabled: true, tags: ['core'] },
  { reviewer: 'test-integrity', risk: 'LOW', enabled: true, tags: ['core'] },
  { reviewer: 'coverage-critical', risk: 'LOW', enabled: true, tags: ['core'] },
  { reviewer: 'error-message-quality', risk: 'LOW', enabled: true, tags: ['core'] },
  { reviewer: 'code-simplification', risk: 'LOW', enabled: true, tags: ['core'] },
  { reviewer: DOMAIN_REVIEWER_SLOT, risk: 'LOW', enabled: true, tags: ['core'] },
  { reviewer: 'reliability-performance', risk: 'MEDIUM', enabled: true, tags: ['core'] },
  { reviewer: 'test-economy', risk: 'MEDIUM', enabled: true, tags: ['core'] },
  { reviewer: 'maintainability-design', risk: 'HIGH', enabled: true, tags: ['core'] },
  { reviewer: 'dead-code', risk: 'HIGH', enabled: true, tags: ['core'] },
  // plan-conformance is appended automatically in delegate mode when the plan copy exists
  // (it needs the plan file; not selectable by profile).
  { reviewer: 'plan-conformance', risk: 'LOW', enabled: false, tags: ['plan'] },
  // enterprise (off by default; request via the `reviewers` arg)
  { reviewer: 'observability-diagnostics', risk: 'MEDIUM', enabled: false, tags: ['enterprise'] },
  { reviewer: 'data-migration-safety', risk: 'HIGH', enabled: false, tags: ['enterprise'] },
  { reviewer: 'contract-compatibility', risk: 'MEDIUM', enabled: false, tags: ['enterprise'] },
  { reviewer: 'rollout-recovery', risk: 'HIGH', enabled: false, tags: ['enterprise'] },
  { reviewer: 'concurrency-safety', risk: 'MEDIUM', enabled: false, tags: ['enterprise'] },
]
// Board reviewers that judge against repo conventions get the conventions block. Keep this
// narrow: a charter that needs the conventions to do its job belongs here, the rest read
// cleaner without them.
// ---------- args ----------
// `args` normally arrives as an object, but tolerate a JSON-encoded string too
// (some invocations deliver it stringified) so {plan, mode, ...} are not silently lost.
let a = args || {}
if (typeof a === 'string') {
  try {
    a = JSON.parse(a)
  } catch (e) {
    a = {}
  }
}
const mode = a.mode || 'delegate' // delegate | expand | review | retrospect
const planRef = a.plan
const profileOverride = a.profile ? String(a.profile).toUpperCase() : null
const baseOverride = a.base || null
const reviewersOverride = Array.isArray(a.reviewers) ? a.reviewers : Array.isArray(a.lenses) ? a.lenses : null // `lenses` = legacy alias
const worktreePathArg = a.worktreePath || null
const testFirst = a.testFirst === true // trial flag: prepend a spec-tests (test-first) pass on MEDIUM/HIGH phases
const noWorktree = a.noWorktree === true || a.worktree === false // delegate: implement in the CURRENT checkout instead of a fresh worktree
const branchesArg = Array.isArray(a.branches) ? a.branches : null // retrospect: explicit branch list
// Per-run toolchain override; merged over the repo profile once it is loaded.
const toolchainOverride = a.toolchain || {}
// Relative path (from repo root) to the vendored, committed reviewer charters.
const BOARD_REL = '.claude/workflows/implement-plan-assets/reviewers'

// Commit-message prefix per repo convention: "<ISSUE>: ..." when the plan names a tracker
// issue (Jira/Linear key from /create-plan), "notask: ..." otherwise. Set right after the
// parse phase in delegate mode; review/retrospect modes keep the fallback.
// Workflow provenance lives in a MANDATORY "Implplan: <stage>" git trailer on every commit
// (second -m paragraph), not in the subject — retrospect discovery keys on the trailer
// (and still recognizes the legacy "[implplan]" subject marker on pre-trailer branches).
let COMMIT_PREFIX = 'notask: '

const slug =
  String(planRef || 'plan')
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'plan'

// ---------- pure helpers ----------
function maxComplexity(phases) {
  let best = 'LOW'
  for (const p of phases || []) {
    const c = (p.complexity || 'MEDIUM').toUpperCase()
    if ((PROFILE_ORDER[c] || 2) > (PROFILE_ORDER[best] || 1)) best = c
  }
  return best
}
function selectBoard(profile) {
  if (reviewersOverride) return reviewersOverride
  const cap = PROFILE_ORDER[profile] || PROFILE_ORDER.HIGH
  return boardCatalog()
    .filter((l) => l.enabled && (PROFILE_ORDER[l.risk] || 1) <= cap && l.tags.some((t) => ACTIVE_BOARD_TAGS.includes(t)))
    .map((l) => l.reviewer)
}
function passChainFor(complexity) {
  const c = (complexity || 'MEDIUM').toUpperCase()
  const chain = PASS_CHAINS[c] || PASS_CHAINS.MEDIUM
  return testFirst && c !== 'LOW' ? ['spec_tests'].concat(chain) : chain
}
function reviewersFor(complexity) {
  return REVIEW_ROUNDS[(complexity || 'MEDIUM').toUpperCase()] || REVIEW_ROUNDS.MEDIUM
}
// Highest severity across a set of findings, normalised to the CRITICAL/HIGH/MEDIUM/LOW vocabulary
// the readyForPr blocking filter understands. Anything unrecognised — or an empty set — becomes
// 'UNKNOWN', which that filter treats as BLOCKING, matching the board path's fail-closed choice.
function maxSeverityOf(findings) {
  const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
  let best = null
  for (const f of findings || []) {
    const i = order.indexOf(String((f && f.severity) || '').toUpperCase())
    if (i >= 0 && (best === null || i < best)) best = i
  }
  return best === null ? 'UNKNOWN' : order[best]
}
// File-overlap serialization for fix waves — deterministic script work, NOT an LLM task.
// Sort by maxSeverity desc (stable on input order), then blockers = indices of EARLIER
// groups (in the returned array) whose file set intersects this one's.
function computeBlockers(groups) {
  const sevOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
  const norm = (f) => String(f || '').replace(/^\.\//, '')
  const sorted = groups
    .map((g, i) => ({ g, i }))
    .sort(
      (x, y) =>
        (sevOrder[String(y.g.maxSeverity || '').toUpperCase()] || 0) -
          (sevOrder[String(x.g.maxSeverity || '').toUpperCase()] || 0) || x.i - y.i
    )
    .map((x) => x.g)
  const fileSets = sorted.map((g) => new Set((g.files || []).map(norm)))
  return sorted.map((g, i) => {
    const blockers = []
    for (let j = 0; j < i; j = j + 1) {
      let overlap = false
      for (const f of fileSets[i]) {
        if (fileSets[j].has(f)) {
          overlap = true
          break
        }
      }
      if (overlap) blockers.push(j)
    }
    return Object.assign({}, g, { blockers })
  })
}

// ---------- schemas ----------
const REPO_PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    repoLabel: { type: ['string', 'null'] },
    toolchain: {
      type: 'object',
      properties: {
        restore_cmd: { type: ['string', 'null'] },
        build_verify_cmd: { type: ['string', 'null'] },
        test_cmd: { type: ['string', 'null'] },
        format_cmd: { type: ['string', 'null'] },
        lint_cmd: { type: ['string', 'null'] },
        build_fast_cmd: { type: ['string', 'null'] },
        test_no_build_cmd: { type: ['string', 'null'] },
        test_scoped_shape: { type: ['string', 'null'] },
      },
    },
    conventionsDoc: { type: ['string', 'null'] },
    archDoc: { type: ['string', 'null'] },
    domainReviewer: { type: ['string', 'null'] },
    qaExtraSteps: { type: 'array', items: { type: 'string' } },
    testFilterNote: { type: ['string', 'null'] },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['found'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    valid: { type: 'boolean' },
    errors: { type: 'array', items: { type: 'string' } },
    issue: { type: ['string', 'null'] },
    planContext: { type: 'string' },
    phases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          complexity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          spec: { type: 'string' },
          automatedCriteria: { type: 'array', items: { type: 'string' } },
          manualCriteria: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'spec'],
      },
    },
  },
  required: ['valid', 'phases'],
}

const SETUP_SCHEMA = {
  type: 'object',
  properties: {
    worktreePath: { type: ['string', 'null'] },
    branch: { type: ['string', 'null'] },
    base: { type: 'string' },
    repoRoot: { type: ['string', 'null'] },
    planInWorktree: { type: ['string', 'null'] },
    error: { type: 'string' },
  },
  required: ['worktreePath'],
}

const PASS_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'string' },
    applied: { type: 'boolean' },
    summary: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    committed: { type: 'boolean' },
    // The SHA this pass committed. The phase's FIRST pass reports the phase's anchor commit, which
    // is what the later passes and the phase reviewers diff against — see phaseDiffBlock().
    commitSha: { type: 'string' },
    testsRun: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['pass', 'applied'],
}

const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
    file: { type: 'string' },
    line: { type: ['integer', 'string', 'null'] },
    observed: { type: 'string' },
    impact: { type: 'string' },
    fix: { type: 'string' },
    verify: { type: 'string' },
  },
  required: ['id', 'severity', 'file', 'observed', 'fix'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    reviewer: { type: 'string' },
    findings: { type: 'array', items: FINDING },
  },
  required: ['reviewer', 'findings'],
}
const CRITERIA_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          passed: { type: 'boolean' },
          evidence: { type: 'string' },
        },
        required: ['criterion', 'passed'],
      },
    },
    allPassed: { type: 'boolean' },
    checkboxesTicked: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['allPassed'],
}
const BOARD_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    reviewer: { type: 'string' },
    findings: { type: 'array', items: FINDING },
    protections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, test: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
  required: ['reviewer', 'findings'],
}
const GROUP_FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    severity: { type: 'string' },
    description: { type: 'string' },
    fix_instructions: { type: 'string' },
  },
  required: ['id', 'severity', 'description', 'fix_instructions'],
}
const SYNTH_SCHEMA = {
  type: 'object',
  properties: {
    counts: {
      type: 'object',
      properties: {
        critical: { type: 'integer' },
        high: { type: 'integer' },
        medium: { type: 'integer' },
        low: { type: 'integer' },
      },
    },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          maxSeverity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          findings: { type: 'array', items: GROUP_FINDING },
        },
        required: ['files', 'findings'],
      },
    },
  },
  required: ['groups'],
}
// One triage agent per synthesis group, so this is the shape of ONE group after triage.
// maxSeverity is enum-constrained on purpose: left free, a triage agent may recompute it as
// "P1"/"Blocker"/"Major", which the CRITICAL/HIGH blocking check would not recognise.
const TRIAGE_GROUP_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    maxSeverity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string' },
          status: { type: 'string', enum: ['verified', 'resolved', 'unverifiable'] },
          description: { type: 'string' },
          fix_instructions: { type: 'string' },
        },
        required: ['id', 'status'],
      },
    },
  },
  required: ['files', 'maxSeverity', 'findings'],
}
// `applied` is group-level, so on its own it cannot distinguish "fixed all 3 findings" from
// "fixed 2 and mentioned the third in notes" — both return true. `unfixedFindingIds` restores the
// per-finding granularity the readyForPr gate needs; a non-empty array counts as unapplied.
const FIX_SCHEMA = {
  type: 'object',
  properties: {
    applied: { type: 'boolean' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    unfixedFindingIds: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['applied'],
}
const GATE_SCHEMA = {
  type: 'object',
  properties: {
    gate: { type: 'string' },
    passed: { type: 'boolean' },
    fixesApplied: { type: 'boolean' },
    output: { type: 'string' },
  },
  required: ['gate', 'passed'],
}
const FINALIZE_SCHEMA = {
  type: 'object',
  properties: {
    stripped: { type: 'boolean' },
    cleanDiff: { type: 'boolean' },
    offendingPaths: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['cleanDiff'],
}
const REVIEW_CTX_SCHEMA = {
  type: 'object',
  properties: {
    worktreePath: { type: ['string', 'null'] },
    base: { type: 'string' },
    repoRoot: { type: ['string', 'null'] },
    // Set with worktreePath=null when a safety gate refused the checkout (dirty tree, default branch).
    error: { type: 'string' },
  },
  required: ['worktreePath', 'base'],
}
const RETRO_DISCOVER_SCHEMA = {
  type: 'object',
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          branch: { type: 'string' },
          humanCommits: {
            type: 'array',
            items: {
              type: 'object',
              properties: { sha: { type: 'string' }, subject: { type: 'string' } },
              required: ['sha'],
            },
          },
        },
        required: ['branch', 'humanCommits'],
      },
    },
  },
  required: ['cases'],
}
const RETRO_CASE_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['missing-test', 'logic-fix', 'edge-case', 'docs-sync', 'convention-violation', 'style', 'other'],
          },
          description: { type: 'string' },
          shouldHaveCaught: { type: 'string' },
          candidateRule: { type: ['string', 'null'] },
        },
        required: ['category', 'description'],
      },
    },
  },
  required: ['branch', 'changes'],
}
const RETRO_PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    docPath: { type: ['string', 'null'] },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          target: { type: 'string' },
          suggestedText: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['rule', 'target'],
      },
    },
  },
  required: ['proposals'],
}

// ---------- prompt builders ----------
function repoProfilePrompt() {
  return `Load the repository profile that localizes an autonomous implementation run. READ-ONLY — create and modify nothing.

1. repoRoot = \`git rev-parse --show-toplevel\`. Read \`<repoRoot>/${REPO_PROFILE_REL}\`.
2. If that file does NOT exist, set found=false and return everything else null/empty — the workflow will stop and tell the operator to create it. Do NOT invent commands, and do NOT guess them from the repo contents: a wrong build or test command silently invalidates every gate in the run.
3. If it exists, parse the JSON and return its fields verbatim: repoLabel, toolchain{restore_cmd, build_verify_cmd, test_cmd, format_cmd, lint_cmd, and the three OPTIONAL speed keys build_fast_cmd, test_no_build_cmd, test_scoped_shape — return "" for any the profile omits, never a guess}, conventionsDoc, archDoc, domainReviewer, qaExtraSteps[], testFilterNote.
4. Sanity-check and report problems in warnings[] WITHOUT fixing them: a missing build_verify_cmd or test_cmd; a test_scoped_shape that is a runnable command rather than a template with a placeholder (it is shown to agents as a shape to fill in, not executed as-is); a conventionsDoc, archDoc or reviewer-<domainReviewer>.md charter path that does not exist on disk; a toolchain command naming a file or directory that is absent; and \`.claude/ai/\` NOT being gitignored (\`git check-ignore -q .claude/ai/probe.md\` exits non-zero) — the workflow treats that directory as internal scratch state (plan snapshots, retrospect proposals) and force-adds into it on the assumption that nothing there is tracked. These are the operator's mistakes to fix, not yours to paper over.

Return {found, repoLabel, toolchain{...}, conventionsDoc, archDoc, domainReviewer, qaExtraSteps[], testFilterNote, warnings[]}.`
}

function parsePrompt(planPath) {
  return `You are the PARSE phase of an autonomous implementation workflow for ${REPO_LABEL}. READ-ONLY — create nothing, modify nothing.

Plan file: ${planPath} (if relative, resolve it against the repo root from \`git rev-parse --show-toplevel\`).

1. Read the plan markdown FULLY.${REPO_PROFILE.archDoc ? ` Also read \`${REPO_PROFILE.archDoc}\` for repo context.` : ``}
2. Confirm this is a PHASE-BASED plan (the /create-plan format): it must contain one or more \`## Phase N: <name>\` headings. If it is instead a Task Graph (\`## Task Graph\` YAML) or has no phases, set valid=false with a clear error.
3. For EACH \`## Phase N: <name>\` section, extract:
   - name: the phase name.
   - complexity: from the \`**Complexity**: LOW|MEDIUM|HIGH\` line under the heading. ${
     profileOverride
       ? `OVERRIDE: force every phase to "${profileOverride}".`
       : 'If the line is absent or unparseable, default to "MEDIUM" and add a (non-fatal) note to errors. Plans without complexity tags are tolerated.'
   }
   - spec: the phase's \`### Overview\` + \`### Changes Required\` content, complete enough to implement from (keep file paths and code snippets verbatim).
   - automatedCriteria: the checkbox items under this phase's \`#### Automated Verification:\`.
   - manualCriteria: the checkbox items under this phase's \`#### Manual Verification:\`.
4. issue: the issue tracker key this plan is tied to (Jira/Linear or similar, e.g. PROJ-123 — the <PROJECT>-<number> shape is what the workflow validates). Look in order at: the YAML frontmatter \`issue:\` field, an \`**Issue**:\` line in the document header, then an issue-key pattern in the plan filename. Return the key verbatim (e.g. "PROJ-123"), or null if none is present — and add a (non-fatal) note to errors, since commits will fall back to the "notask:" prefix.
5. planContext: a compact synthesis of the plan's Overview, Implementation Approach, "What We're NOT Doing", and Testing Strategy — the shared context every phase needs. Keep it tight but faithful.

Return {valid, errors[], issue, planContext, phases:[{name, complexity, spec, automatedCriteria[], manualCriteria[]}]} in plan order. Return phases:[] if it cannot be parsed.`
}

function setupPrompt(planPath) {
  return `Create an isolated git worktree for an autonomous plan-implementation run in ${REPO_LABEL}. git/shell only; do NOT implement any plan phases here.

1. repoRoot = \`git rev-parse --show-toplevel\` (run from the current directory).
2. default branch = \`git -C <repoRoot> symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'\` (fallback "main"). base = "origin/<default>".${
    baseOverride ? ` OVERRIDE: use base = "${baseOverride}".` : ''
  }
3. \`git -C <repoRoot> fetch origin\` (best-effort; ignore failure).
4. Pick names: worktreePath = a SIBLING of repoRoot named "<repoBasename>-implplan-${slug}"; branch = "implement-plan/${slug}". If either exists, append "-2", "-3", ... to BOTH until free (check \`git -C <repoRoot> worktree list\` and \`git -C <repoRoot> branch --list\`).
5. Create it: \`git -C <repoRoot> worktree add -b <branch> <worktreePath> <base>\`. If <base> is unavailable, fall back to the local default branch, then HEAD.
6. Plan availability for checkbox updates: determine the plan's repo-relative path (e.g. .claude/ai/<file>.md). If that path does NOT already exist inside the worktree (e.g. the plan is uncommitted), copy ${planPath} into the worktree at that same relative path. If the plan file in the worktree is untracked or differs from HEAD, COMMIT the snapshot now so its later checkbox edits stay isolated from code commits: \`git -C <worktreePath> add -f <planRelPath> && git -C <worktreePath> commit -m "${COMMIT_PREFIX}Plan snapshot" -m "Implplan: plan-snapshot"\` (-f because .claude/ai/ is gitignored; without it the add is silently skipped; the second -m trailer paragraph is MANDATORY — tooling keys on it). Return the repo-relative path as planInWorktree (or null if you cannot place it).
7. Prepare dependencies IN <worktreePath>:${TOOLCHAIN.restore_cmd ? ` first run \`${TOOLCHAIN.restore_cmd}\`, then` : ''} run \`${TOOLCHAIN.build_verify_cmd}\`. The BUILD IS REQUIRED, not an optimisation: a fresh worktree holds no generated, derived or downloaded build outputs, and the implement passes use a faster inner-loop build that may assume those already exist — without this build the FIRST implement pass can fail on files it never wrote. It also warms the tree so later passes pay an incremental build instead of a cold one. Still return the worktree on failure, but record any failure in \`error\` verbatim: it means the branch was already broken at the base ref.

Return {worktreePath, branch, base, repoRoot, planInWorktree, error}. On hard failure return worktreePath=null and a plain \`error\`.`
}

// noWorktree variant: prepare the CURRENT checkout for an in-place run. Same return shape
// as setupPrompt (worktreePath = repoRoot) so the rest of the pipeline is untouched.
function setupInPlacePrompt(planPath) {
  return `Prepare the CURRENT ${REPO_LABEL} checkout for an autonomous plan-implementation run IN PLACE (the caller asked to skip worktree creation). git/shell only; do NOT implement any plan phases here. Do NOT create a git worktree.

1. repoRoot = \`git rev-parse --show-toplevel\` (run from the current directory).
2. SAFETY GATE: \`git -C <repoRoot> status --porcelain\` must be EMPTY. If it is not, STOP: return worktreePath=null and error="working tree not clean — the in-place run commits with git add -A, which would sweep uncommitted changes; commit/stash first or run without noWorktree". Do not stash or discard anything yourself.
3. default branch = \`git -C <repoRoot> symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'\` (fallback "main"). base = "origin/<default>".${
    baseOverride ? ` OVERRIDE: use base = "${baseOverride}".` : ''
  }
4. \`git -C <repoRoot> fetch origin\` (best-effort; ignore failure).
5. Branch: current = \`git -C <repoRoot> rev-parse --abbrev-ref HEAD\`. If current is the default branch, create and switch to a new branch IN PLACE, STARTING FROM <base>: \`git -C <repoRoot> switch -c implement-plan/${slug} <base>\` (append "-2", "-3", ... if taken — check \`git branch --list\`) so the run never commits directly to the default branch AND never builds on a stale local default (the tree is clean, so updating files to <base> is safe; if <base> is unavailable, fall back to the local default branch, then HEAD). Otherwise STAY on the current branch (the caller is continuing existing work). branch = the branch now checked out.
6. Plan availability for checkbox updates: determine the plan's repo-relative path (e.g. .claude/ai/<file>.md); the plan file ${planPath} normally already sits inside this checkout. If the file at that repo-relative path is untracked or differs from HEAD, COMMIT the snapshot now so its later checkbox edits stay isolated from code commits: \`git -C <repoRoot> add -f <planRelPath> && git -C <repoRoot> commit -m "${COMMIT_PREFIX}Plan snapshot" -m "Implplan: plan-snapshot"\` (-f because .claude/ai/ is gitignored; without it the add is silently skipped; the second -m trailer paragraph is MANDATORY — tooling keys on it). Return the repo-relative path as planInWorktree (or null if you cannot place it).
7. Prepare dependencies IN <repoRoot>:${TOOLCHAIN.restore_cmd ? ` first run \`${TOOLCHAIN.restore_cmd}\`, then` : ''} run \`${TOOLCHAIN.build_verify_cmd}\`. The BUILD IS REQUIRED, not an optimisation: a fresh checkout holds no generated, derived or downloaded build outputs, and the implement passes use a faster inner-loop build that may assume those already exist — without this build the FIRST implement pass can fail on files it never wrote. It also warms the tree so later passes pay an incremental build instead of a cold one. Still return the checkout on failure, but record any failure in \`error\` verbatim: it means the branch was already broken at the base ref.

Return {worktreePath: <repoRoot>, branch, base, repoRoot, planInWorktree, error}. On hard failure return worktreePath=null and a plain \`error\`.`
}

// Implement passes run the affected tests directly (a fast inner-loop self-check, scoped to what
// changed). This is intentional and distinct from /implement-plan's "use the test-runner agent"
// mandate: the authoritative full suite runs later in the Test quality gate via the test-runner
// agent (see runGates). Keeping the per-pass check inline avoids an agent hop on every pass.
// How a phase-scoped agent is told to obtain ITS OWN diff. One function, because the refinement
// passes and the phase reviewers must not drift apart on it.
//
// Prefer the anchor SHA the first pass reported. Re-deriving it with
// `git log --grep='^Implplan: P<n>/' | tail -1` fails SILENTLY in two directions, and both leave
// PHASE_START non-empty so no fallback fires:
//   - the trailer is written by the pass AGENT, not by this script. An agent that omits it (or
//     folds it into the subject) shifts the anchor one commit later, so the phase's own first
//     commit — its whole initial implementation — drops out of the reviewed diff.
//   - on a re-run that stayed on a non-default branch (setupInPlacePrompt), a PREVIOUS run's
//     `P<n>` commits match the same grep and tail -1 picks the oldest of those, so the scoping
//     quietly evaporates while the prompt still claims the anchor is this phase's first commit.
// expectedCommits lets the fallback detect the first case: fewer commits listed than passes
// committed means a trailer is missing.
function phaseDiffBlock(ctx, expectedCommits, indent) {
  const pad = indent || ''
  const sha = /^[0-9a-f]{7,40}$/.test(String(ctx.phaseStartSha || '')) ? ctx.phaseStartSha : null
  if (sha)
    return `${pad}git diff ${sha}^...HEAD
${pad}${sha} is this phase's FIRST commit — the pass that made it reported the SHA, so do not re-derive it by grepping. Its parent is the tree as this phase found it.`
  const grep = `--grep='^Implplan: P${ctx.phaseNum}/' ${ctx.base}..HEAD`
  return `${pad}PHASE_START=$(git log --format=%H ${grep} | tail -1)
${pad}git log --oneline ${grep}
${pad}if [ -n "$PHASE_START" ]; then git diff $PHASE_START^...HEAD; else git diff ${ctx.base}...HEAD; fi
${pad}tail -1 takes the OLDEST match, i.e. this phase's first commit, so its parent is the tree as this phase found it. Two checks before you trust it: if PHASE_START comes back EMPTY the diff falls back to ${ctx.base}...HEAD, which includes earlier phases — focus only on your own and say so in your output. And this phase has committed ${expectedCommits} pass(es): if the listing shows FEWER than ${expectedCommits} commits then a MANDATORY Implplan trailer is missing, the anchor is one commit too late, and you must use \`git diff ${ctx.base}...HEAD\` instead and say so.`
}

function phasePassPrompt(phaseSpec, pass, prevSummary, ctx) {
  const tc = ctx.toolchain
  const criteria =
    (phaseSpec.automatedCriteria || []).map((c, i) => `  ${i + 1}. ${c}`).join('\n') ||
    '  (none listed — at minimum the solution must build and the affected tests must pass)'
  let body
  if (pass === 'spec_tests') {
    body = `This is the SPEC-TESTS (test-first) pass for the phase. Translate the phase specification and its Automated success criteria into concrete tests BEFORE any real implementation exists:
- Write the tests the finished phase must satisfy: the happy path plus the edge and boundary cases the conventions doc demands.
- Where tests reference types/members that do not exist yet, add MINIMAL compilable stubs (correct signatures; throw NotImplementedException or return defaults) — just enough that the solution builds and the new tests FAIL (red) for the right reason.
- Do NOT implement the real behavior — that is the next pass.`
  } else if (pass === 'initial') {
    body = `This is the INITIAL implementation pass for the phase. First read ${
      REPO_PROFILE.archDoc ? `\`${REPO_PROFILE.archDoc}\` and ` : ''
    }the existing code this phase touches. Then implement the phase's "Changes Required" to satisfy its Automated success criteria, following the conventions above.${
      ctx.testFirst
        ? ' A spec-tests pass may have committed failing tests plus stubs for this phase — make those tests pass, and extend them where the spec demands more.'
        : ''
    } Implement THIS phase only — earlier phases are already committed; do not redo them. Do not gold-plate; later review rounds harden the work.`
  } else {
    body = `This is the "${PASS_LABEL[pass]}" refinement pass for the phase, building on its prior passes (already committed). Examine ONLY this phase's work — take its diff directly instead of reading the cumulative one and narrowing by eye:
${phaseDiffBlock(ctx, ctx.passesCommitted, '  ')}
Prior pass summary: ${
      prevSummary || '(none — rely on the diff)'
    }
Apply THIS pass's focus: ${PASS_INTENT[pass]}`
  }

  // The self-check is an INNER LOOP: keep it scoped. The whole suite runs once, authoritatively,
  // in the Test gate; running it on every pass of every phase is the most common way these
  // pipelines waste wall-clock.
  const scopedRun = scopedTestShape()
    ? `run ONLY the affected tests: \`${scopedTestShape()}\``
    : `run ONLY the tests covering what you changed — scope \`${tc.test_cmd}\` down to the affected project, file or name pattern rather than running all of it`
  const fastBuildRecovery = hasFastBuild()
    ? ` If that build fails on MISSING GENERATED OR DERIVED SOURCES rather than on your own code, the fast build is missing a prerequisite that only the full build produces: run \`${tc.build_verify_cmd}\` ONCE, then carry on. Never hand-write or stub a generated file — a stub newer than its source keeps the generator skipped for the rest of the run.`
    : ''
  const selfCheck =
    pass === 'spec_tests'
      ? `- Confirm the solution BUILDS (\`${fastBuildCmd()}\`) and that the NEW tests fail for the right reason (missing behavior — not compile errors or bad arrange data). Keep it scoped: ${scopedRun}.${fastBuildRecovery}`
      : `- Self-check FAST and SCOPED. Build with \`${fastBuildCmd()}\`, then ${scopedRun}, and confirm they pass. Do NOT run the whole suite (\`${tc.test_cmd}\`) here — the Test gate re-runs it authoritatively later via the test-runner agent.${fastBuildRecovery}`

  return `You implement ONE pass of ONE phase of an APPROVED implementation plan, in a SHARED git worktree for ${REPO_LABEL}. cd ${ctx.worktree} first.

${conventionsBlock()}

Shared plan context:
${ctx.planContext || '(none provided)'}

Phase: ${phaseSpec.name}   (complexity: ${(phaseSpec.complexity || 'MEDIUM').toUpperCase()})
Phase specification:
${phaseSpec.spec}

Automated success criteria for this phase:
${criteria}

${body}

After your changes:
${selfCheck}
- Commit: \`git add -A && git commit -m "${COMMIT_PREFIX}${phaseSpec.name}: ${PASS_LABEL[pass]}" -m "Implplan: P${ctx.phaseNum}/${pass}"\`. Then run \`git rev-parse HEAD\` and return that SHA as commitSha — the phase's first pass supplies the anchor every later pass and reviewer diffs against, so an omitted commitSha costs them their scoping. The second -m (the "Implplan:" trailer paragraph) is MANDATORY — retrospect toolingkeys on it; never fold it into the subject.
- If you genuinely cannot satisfy the spec (the plan conflicts with the code), do your best partial implementation and explain the mismatch in notes — do NOT block.

Return {pass:"${pass}", applied, summary, filesTouched[], committed, testsRun, notes}. summary = 1-3 lines on what changed + any deferred concern for the next pass.`
}

function reviewerPrompt(phaseSpec, reviewer, ctx) {
  const criteria =
    (phaseSpec.automatedCriteria || []).map((c, i) => `  ${i + 1}. ${c}`).join('\n') || '  (none listed)'
  const prefix = reviewer === 'hardening_review' ? 'HARD' : 'REV'
  return `You are reviewing a COLLEAGUE's pull-request-in-progress: one phase of an approved plan, implemented in a git worktree for ${REPO_LABEL}. You did NOT write this code. READ-ONLY — do not modify any file.

${conventionsBlockForReview()}

Phase under review: ${phaseSpec.name}
Phase specification (the contract the change must satisfy):
${phaseSpec.spec}

Automated success criteria:
${criteria}

Your review vantage (report ONLY within it): ${REVIEW_VANTAGE[reviewer]}

1. cd ${ctx.worktree}. Review ONLY this phase's work, and take its diff directly rather than reading every earlier phase and narrowing by eye:
${phaseDiffBlock(ctx, ctx.passesCommitted, '     ')}
   Stay inside the files THIS phase's spec targets, and read the surrounding source — not just the diff — wherever the change interacts with existing code.
2. Judge the change as a demanding human reviewer would. Cross-check the spec both ways: every "Changes Required" item present? anything changed that the spec does not justify?
3. Report only findings a reviewer would insist on before merge — each must be actionable by a fixer. Per finding: id ("${prefix}-1", "${prefix}-2", ...); severity (CRITICAL|HIGH|MEDIUM|LOW); file; line; observed (what is wrong and why); impact (concrete failure mode); fix (the specific change to make); verify (exact command/test).

Return {reviewer:"${reviewer}", findings:[...]} — findings:[] if the change is genuinely clean. Do not invent findings to seem useful.`
}

// ONE fixer applies the union of every reviewer's findings for the phase (the reviewers run
// concurrently). Finding ids are prefixed per reviewer (REV-n / HARD-n) so they never collide.
function reviewFixPrompt(phaseSpec, reviewerLabel, findings, ctx) {
  const scopedRun = scopedTestShape()
    ? ` plus the affected tests (\`${scopedTestShape()}\`)`
    : ' plus the tests covering the files you touched (scoped, not the whole suite)'
  return `Apply external reviewers' findings for ONE phase of an approved plan, in a git worktree for ${REPO_LABEL}. cd ${ctx.worktree} first.

${conventionsBlock()}
${fixerRules()}

Phase: ${phaseSpec.name}
Findings from ${reviewerLabel} (JSON — these came from INDEPENDENT reviewers who did not see each other's work, so two findings may overlap or pull in opposite directions; reconcile them into ONE coherent edit rather than applying them blindly in sequence):
${JSON.stringify(findings)}

Address each finding with the specific change in its \`fix\` field — minimal edits, scoped to the findings; do not refactor beyond them. If a finding is factually wrong (the reviewer misread the code), skip it and explain why in notes. Re-run the tests named in each finding's \`verify\`${scopedRun}, and confirm they pass. Commit: \`git add -A && git commit -m "${COMMIT_PREFIX}${phaseSpec.name}: Review Fixes" -m "Implplan: P${ctx.phaseNum}/review-fix"\` — the second -m trailer paragraph is MANDATORY.

Return {applied, filesChanged[], unfixedFindingIds[], notes}. Set applied=true only if every finding you accepted was fixed and committed; list the \`id\` of anything you deliberately skipped or could not fix in unfixedFindingIds, with the reason in notes.`
}

function criteriaVerifyPrompt(phaseSpec, ctx) {
  const tc = ctx.toolchain
  const criteria =
    (phaseSpec.automatedCriteria || []).map((c, i) => `  ${i + 1}. ${c}`).join('\n') || '  (none listed)'
  return `You are an INDEPENDENT verifier for one phase of an autonomous implementation run. You did NOT write the code; your job is to grade it honestly. cd ${ctx.worktree} first. Do NOT fix or change any code.

Phase: ${phaseSpec.name}
Automated success criteria:
${criteria}

1. Execute each criterion: run the exact command it names (build/test/etc. — allow up to ~10 min for a test run); for a criterion with no command, perform the concrete check it describes (grep/read the code). Record passed=true/false per criterion with one line of evidence (command + observed result).
2. If NO criteria are listed, the minimum bar is: \`${tc.build_verify_cmd}\` succeeds — record that as the single criterion.
3. ${
    ctx.planInWorktree
      ? `Only if EVERY criterion passed: tick this phase's Automated Verification checkboxes (\`- [ ]\` -> \`- [x]\`) in ${ctx.planInWorktree}, then commit ONLY that file: \`git add -f ${ctx.planInWorktree} && git commit -m "${COMMIT_PREFIX}${phaseSpec.name}: Criteria verified" -m "Implplan: P${ctx.phaseNum}/criteria-verified"\` (-f: .claude/ai/ is gitignored; the second -m trailer paragraph is MANDATORY). If the checkboxes are ALREADY ticked (rerun/resume) or your edit changes nothing, skip the commit — do not fight "nothing to commit" — and return checkboxesTicked=false with a note.`
      : 'No plan copy is available in the worktree; skip checkbox updates.'
  }
4. Report failures faithfully — a failed criterion is a valid result, not a problem to work around or explain away.

Return {results:[{criterion, passed, evidence}], allPassed, checkboxesTicked, notes}.`
}

function boardPrompt(name, worktree, base, boardDir, planPath) {
  // Every reviewer, not a chosen few — see conventionsBlockForReview() for why a subset was a bug.
  const conventions = `\n${conventionsBlockForReview()}\n`
  const planStep =
    name === 'plan-conformance'
      ? `\n2b. This reviewer judges the diff AGAINST THE APPROVED PLAN. Read the plan file FULLY first: ${
          planPath || '(no plan path was provided — if you cannot locate the plan in the worktree, return findings:[])'
        }.`
      : ''
  return `You are ONE specialist reviewer on a review board examining a code change. Your charter: "${name}". READ-ONLY — do not modify files.
${conventions}
1. READ your canonical charter FIRST: ${boardDir}/reviewer-${name}.md — the source of truth for ## Covers, ## Does NOT Cover, the severity guide, and the finding-ID prefix. Do not paraphrase from memory.
2. Compute the diff under review:
     cd ${worktree}
     git fetch origin >/dev/null 2>&1 || true
     git diff ${base}...HEAD --stat   then   git diff ${base}...HEAD
   Read the full diff. For a large diff, use \`git diff ${base}...HEAD --name-only\` as a traversal plan and Read changed files individually — never silently skip a changed file.${planStep}
3. Report findings ONLY within your charter's ## Covers (omit anything under its ## Does NOT Cover). Per finding: id with the charter's prefix (e.g. [SEC-C1]); severity per the charter's guide; file; line; observed; impact; fix; verify (exact command/test or a concrete structural observation — never "by inspection"). Where the repository's conventions doc states a rule, a violation of it IS a real defect — judge against that file, not against generic best practice.
   If you are the coverage-critical reviewer, also return protections[] for sole-coverage tests that must NOT be removed.

Return {reviewer:"${name}", findings[], protections[]}.`
}

function synthPrompt(boardResults) {
  return `You are the SYNTHESIS step of a review-board review. Analysis only — modify nothing.

Per-reviewer findings (JSON):
${JSON.stringify(boardResults)}

Deduplicate and group:
- Merge findings targeting the same file/symbol into one item; keep every contributing finding id.
- Resolve policy conflicts: a coverage-critical PROTECTED test beats any test-economy/dead-code removal (never recommend removing sole coverage). Otherwise prefer the safety-first recommendation.
- Group actionable findings by target file(s) so each group owns a NON-overlapping set of files where possible (lets fixes run in parallel safely). Set maxSeverity per group (CRITICAL > HIGH > MEDIUM > LOW) and overall counts.

Return {counts:{critical,high,medium,low}, groups:[{files[], maxSeverity, findings:[{id,severity,description,fix_instructions}]}]}.`
}

// Triage is fanned out ONE AGENT PER GROUP. It used to be a single agent verifying every finding
// against source in turn, sitting on the critical path beside the whole board wave.
function triageGroupPrompt(group, worktree) {
  return `You are the TRIAGE step of a review-board review, responsible for ONE fix group only. cd ${worktree} and verify this group's findings against the REAL current source. Do NOT modify any file.

Fix group (JSON):
${JSON.stringify(group)}

Classify each finding: "verified" (real — keep), "resolved" (already handled in the current code — drop), or "unverifiable" (cannot confirm — drop). Return ONLY the verified findings, each carrying status:"verified". Keep files[] accurate for what survives, and recompute maxSeverity from the SURVIVING findings — it MUST be exactly one of CRITICAL, HIGH, MEDIUM, LOW (no other vocabulary, no annotations). If nothing in this group is real, return findings:[] with maxSeverity:"LOW" and files:[] — the workflow drops the group. ALL THREE fields are required in every answer, including that empty case.

Report honestly: dropping a finding that is genuinely already handled is a correct outcome, and so is keeping one that is real but awkward to fix.

Return {files[], maxSeverity, findings:[{id,severity,status,description,fix_instructions}]}. Do NOT compute any scheduling or ordering — the workflow serializes fixes itself.`
}

function fixPrompt(group, worktree) {
  return `Apply the fixes for ONE review-board fix group in the worktree. cd ${worktree}.

${conventionsBlock()}
${fixerRules()}

Files this group owns: ${(group.files || []).join(', ') || '(infer from findings)'}
Findings (JSON):
${JSON.stringify(group.findings)}

For each VERIFIED finding, make the specific change in fix_instructions. Keep edits minimal and scoped to this group's files only (other files may be handled by a parallel fix). Re-run any test named in a finding's verification. Stage ONLY this group's files (\`git add <file> ...\`, not \`git add -A\` — other fix groups may be editing different files concurrently) and \`git commit -m "${COMMIT_PREFIX}Board-review fix" -m "Implplan: board-review-fix"\` (the second -m trailer paragraph is MANDATORY; retry on .git/index.lock contention).

Return {applied, filesChanged[], unfixedFindingIds[], notes}. Set applied=true ONLY if EVERY verified finding in this group was fixed and committed; put the \`id\` of any finding you did not fix in unfixedFindingIds. An unfixed CRITICAL/HIGH finding blocks the whole run from being reported ready for a PR, so never report a partial fix as applied.`
}

function gatePrompt(gate, worktree, tc, opts) {
  const base = (opts && opts.base) || 'origin/main'
  const map = {
    // The sync gate runs BEFORE build/test (see runGates) so the recorded build AND test
    // results apply to the post-merge HEAD, not a pre-merge snapshot.
    sync: `SYNC-WITH-BASE gate (delegate finalization; runs FIRST, before build/test): \`git fetch origin\`, then merge the latest base into this branch: \`git merge --no-edit ${base}\`. A merge CONFLICT is a gate failure — run \`git merge --abort\` to restore a clean tree, then report passed=false naming the conflicting paths so it is surfaced HERE, never deferred to human merge time. Do NOT change product logic to resolve a conflict. Do NOT rebuild here: the BUILD gate runs next on this exact post-merge tree, so a post-merge break is caught there. Report passed=true on a clean merge (or already up to date).`,
    build: `BUILD gate: run \`${tc.build_verify_cmd}\` in the worktree and confirm it builds with no ERRORS. Warnings are not this gate's business — the QA gate runs the warning-clean build and fixes what it safely can, and failing here would skip it. Do NOT change logic — report pass/fail and the first errors only. Leave the tree built: the Test gate runs next and reuses these outputs.`,
    test: `TEST gate: the BUILD gate just ran on this exact tree and nothing has changed since, so run \`${noBuildTestCmd()}\`${
      TOOLCHAIN.test_no_build_cmd ? " (the profile's no-rebuild variant — it skips a redundant build)" : ''
    } (allow up to ~10 min).${REPO_PROFILE.testFilterNote ? ` NOTE: ${REPO_PROFILE.testFilterNote}` : ''} If it fails because build outputs are missing rather than because tests failed, fall back to \`${tc.test_cmd}\` once. Report pass/fail and name any failing tests. Do not modify code.`,
    qa: `QA gate — this runs STRICTLY AFTER the last fixer/reviewer edit (and after the sync gate, so the base is already merged). Perform these steps IN ORDER:
(1) FORMAT: run \`${tc.format_cmd}\` to auto-format, then \`${tc.lint_cmd}\` to confirm formatting is clean. Commit any changes with \`git commit -m "${COMMIT_PREFIX}QA: format" -m "Implplan: qa"\`.
(2) REPO-SPECIFIC QA CHECKS: ${
      (REPO_PROFILE.qaExtraSteps || []).filter(Boolean).length
        ? `run each of the following, which this repository's build and formatter do NOT flag, and fix or revert every offender:\n${(
            REPO_PROFILE.qaExtraSteps || []
          )
            .filter(Boolean)
            .map((s, i) => `    ${i + 1}. ${s}`)
            .join('\n')}`
        : `the repo profile lists none. Still sanity-check the changed files (\`git diff ${base}...HEAD --name-only\`) for leftovers the build ignores — unused imports, malformed doc comments, committed generated-file drift, stray debug output — and fix what you find.`
    }
   NEVER delete an import because a text search found no second use: in many languages an import can supply extension methods, implicit conversions or registrations, so it is required while looking unused. Remove one, re-run \`${tc.build_verify_cmd}\`, and restore it if the build breaks.
(3) WARNING-CLEAN BUILD: re-run \`${tc.build_verify_cmd}\` and treat NEW warnings introduced by this branch as defects. FIX what you safely can (formatting, simple warnings), committing as you go with \`git commit -m "${COMMIT_PREFIX}QA: <what was fixed>" -m "Implplan: qa"\` (the second -m trailer paragraph is MANDATORY), and re-run until clean or no further safe fix remains.`,
  }
  // Only the QA gate edits logic; sync/build/test report and must not change code, so they get none.
  const gateConventions = gate === 'qa' ? `\n${conventionsBlockForGate()}\n` : ''
  return `Run the "${gate}" quality gate in the worktree. cd ${worktree} first.
${gateConventions}
${map[gate]}

Return {gate:"${gate}", passed, fixesApplied, output} where output is a <=3-line summary.`
}

// Post-fix criteria re-verification (P4 RE-VERIFICATION). The review-board fix waves, the base-
// sync merge, and the QA gate's format/warning commits all change HEAD AFTER each phase's own
// criteria verification, so re-grade every phase's automated criteria over the FINAL HEAD.
// Read-only: never edits code or checkboxes.
function criteriaReverifyPrompt(allPhases, worktree, tc, base) {
  const lines = []
  ;(allPhases || []).forEach((p, i) => {
    const cs = p.automatedCriteria || []
    if (!cs.length) return
    lines.push(`Phase ${i + 1} — ${p.name}:`)
    cs.forEach((c, j) => lines.push(`  ${j + 1}. ${c}`))
  })
  const criteriaBlock = lines.join('\n') || '  (no automated criteria were listed across the phases)'
  return `You are an INDEPENDENT re-verifier for an autonomous implementation run. Changes may have landed AFTER each phase's criteria were first verified (review-board fix commits, the base-sync merge, QA format/warning commits), which can silently regress a criterion that previously passed. cd ${worktree} first. READ-ONLY — do NOT modify or fix any code, and do NOT edit plan checkboxes.

0. CHEAP SHORT-CIRCUIT (avoid a redundant full test run on a clean run): the per-phase verifier committed each phase with an \`Implplan: P<n>/criteria-verified\` trailer. Run:
     git log --format='%H %(trailers:key=Implplan,valueonly,separator=%x2C)' ${base}..HEAD
   Find the most recent \`criteria-verified\` commit. If it is HEAD — i.e. NO commit followed it (no board-review-fix, qa, sync-merge, or any other commit landed after the last phase was verified) — then nothing behavior-changing happened after verification: report every criterion below as passed=true with evidence "no post-verification commits; prior criteria verification still valid", set allPassed=true, and STOP WITHOUT running the suite. If you cannot find ANY \`criteria-verified\` commit (none were produced), do NOT short-circuit — run the full re-verification below.

Otherwise (any commit followed the last verification, INCLUDING a merge commit) re-run EVERY automated success criterion below against the CURRENT HEAD:
${criteriaBlock}

1. Execute each criterion: run the exact command it names (build/test/etc. — allow up to ~10 min for a full test run); for a criterion with no command, perform the concrete check it describes (grep/read the code). Record passed=true/false per criterion with one line of evidence (command + observed result).
2. A criterion that passed originally but fails now is a REGRESSION introduced by those post-verification changes — report it faithfully; do not work around or explain it away.
3. If no automated criteria are listed, the minimum bar is that \`${tc.build_verify_cmd}\` succeeds — record that as the single criterion.

Return {results:[{criterion, passed, evidence}], allPassed, checkboxesTicked:false, notes}.`
}

// Branch-hygiene finalization (P1 FINALIZATION GATE). Strips the internal plan snapshot (and
// its checkbox commits) from the branch so the PR diff carries only product files, and fails
// loudly if any other gitignored path leaked into the diff. Delegate mode only.
function finalizePrompt(worktree, base, planInWorktree, prefix) {
  return `You are the BRANCH-HYGIENE FINALIZATION step of an autonomous implement-plan run. cd ${worktree} first. git/shell only — do NOT modify product source.

The workflow force-added an internal plan snapshot (${planInWorktree || 'a .claude/ai/*.md file'}) at startup and may have committed checkbox updates to it during the run. That file is internal workflow state, NOT a deliverable, and .claude/ai/ is gitignored by design. Before the branch can be declared ready:

1. If a plan snapshot path is known (${planInWorktree || 'none — scan `git diff ' + base + '...HEAD --name-only` for a .claude/ai/*.md path'}) AND it appears in \`git diff ${base}...HEAD --name-only\`, take it out of the diff. HOW depends on whether the BASE already tracks the file — check first with \`git cat-file -e ${base}:${planInWorktree || '<planRelPath>'}\` (exit 0 = tracked at base):
   - Base does NOT track it (the normal case — .claude/ai/ is gitignored and the snapshot was force-added by this run): untrack it and commit the removal (do NOT delete the working file from disk — \`git rm --cached\` only):
     git rm --cached ${planInWorktree || '<planRelPath>'}
     git commit -m "${prefix}Drop plan snapshot from branch" -m "Implplan: finalize"
   - Base DOES track it (the repo does not gitignore .claude/ai/ and the plan was committed before this run): \`git rm --cached\` here would turn the PR into a DELETION of a file the repo keeps on purpose. Instead restore the base's version so the diff no longer touches it, and record in notes that the directory is not gitignored:
     git checkout ${base} -- ${planInWorktree || '<planRelPath>'}
     git commit -m "${prefix}Restore plan to base version" -m "Implplan: finalize"
   Use EXACTLY these commit subject prefixes — do NOT infer one from the last commit, which after a base merge may be an unprefixed merge commit.
2. Re-check in ONE pass — \`git check-ignore\` reads paths from stdin, so do NOT loop per path:
     git diff ${base}...HEAD --name-only | git check-ignore --stdin --verbose
   Exit status 0 with output means gitignored paths are still in the diff — list exactly those in offendingPaths. Exit status 1 with NO output means the diff is clean (a PASS, not an error). The diff MUST contain ONLY product files. Any remaining path under .claude/ai/ or matched by git check-ignore is a FAILURE: list it in offendingPaths. Do NOT force-strip paths you did not create — surface unexpected ones for a human instead.

Return {stripped, cleanDiff, offendingPaths:[...], notes}. cleanDiff=true ONLY when the ${base}...HEAD diff has zero .claude/ai/ or git-check-ignored paths.`
}

// Review mode is NOT read-only, and this prompt is where that is enforced: the board's fix waves
// and the QA gate both COMMIT onto whatever branch is checked out at worktreePath. The delegate
// path gets the same protection from setupInPlacePrompt (clean tree, never the default branch);
// review mode used to get neither, so pointing it at a dirty checkout or at main committed into it.
function reviewCtxPrompt() {
  return `Resolve the review context for a board-and-gates run on ${REPO_LABEL}. Use git READ commands only — but the run you are preparing is NOT read-only: its fix waves and QA gate COMMIT onto the branch checked out at worktreePath, so your job includes REFUSING a checkout that is unsafe to commit into.

1. repoRoot = \`git rev-parse --show-toplevel\`.
2. worktreePath = ${
    worktreePathArg ? `"${worktreePathArg}"` : 'repoRoot (review the current checkout)'
  }.
3. default = \`git -C <worktreePath> symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'\` (fallback "main"); base = ${
    baseOverride ? `"${baseOverride}"` : '"origin/<default>"'
  }. Compute base BEFORE the gates below and return it even when you stop.
4. SAFETY GATE — clean tree: \`git -C <worktreePath> status --porcelain\` must be EMPTY. If it is not, STOP: return worktreePath=null and error="working tree not clean — review mode commits board fixes and QA formatting onto the current branch; commit or stash first". Do not stash or discard anything yourself.
5. SAFETY GATE — not the default branch: if \`git -C <worktreePath> rev-parse --abbrev-ref HEAD\` equals <default>, STOP: return worktreePath=null and error="<default> is checked out — review mode would commit fixes directly onto the default branch; check out the branch to review first". Do not create or switch branches yourself.

Return {worktreePath, base, repoRoot, error}.`
}

function retroDiscoverPrompt() {
  return `Discover RETROSPECT cases for the implement-plan workflow in ${REPO_LABEL}. READ-ONLY git only.

1. repoRoot = \`git rev-parse --show-toplevel\`; run all git commands with -C <repoRoot>. \`git fetch origin\` best-effort.
2. Candidate branches: ${
    branchesArg
      ? `exactly these: ${branchesArg.join(', ')}.`
      : `\`git branch --list 'implement-plan/*' --format='%(refname:short)'\` plus \`git branch -r --list 'origin/implement-plan/*' --format='%(refname:short)'\` (dedup local vs remote).`
  }
3. For each candidate: BASE=\`git merge-base origin/main <branch>\` (if origin/main is absent, use the branch from \`git symbolic-ref --short refs/remotes/origin/HEAD\`), then inspect \`git log --format="%H|%s|%(trailers:key=Implplan,valueonly,separator=%x2C)" $BASE..<branch>\`. A commit is WORKFLOW-MADE when it has an \`Implplan:\` trailer (third field non-empty) OR its subject contains the legacy \`[implplan]\` marker (pre-trailer branches). A CASE is a branch whose log contains BOTH workflow-made commits AND at least one HUMAN commit on top of them (any non-workflow, non-merge commit — e.g. "Address PR review feedback"). Skip branches with no human follow-up.
4. Per case return: branch, humanCommits:[{sha, subject}] (newest first, ONLY the human commits).

Return {cases:[...]} — empty if none qualify.`
}

function retroAnalyzePrompt(c) {
  return `Analyze ONE retrospect case: what did HUMANS have to change AFTER the autonomous implement-plan workflow finished? READ-ONLY — analysis only.

Branch: ${c.branch}
Human follow-up commits (JSON):
${JSON.stringify(c.humanCommits)}

1. For each human commit: \`git show <sha>\` (from the repo root). Break it into distinct changes.
2. Classify each change: category = missing-test | logic-fix | edge-case | docs-sync | convention-violation | style | other.
3. For each change, state shouldHaveCaught: WHICH pipeline stage should have produced it (initial pass, edge-case pass, spec_review, hardening_review, a NAMED board reviewer, criteria verification, or a quality gate) and why it plausibly slipped through.
4. Derive candidateRule: a concrete, GENERALIZABLE convention/charter bullet that would have caught this class of miss (null if it is a one-off with no generalizable rule). Write it as ready-to-paste text, not a vague theme.

Return {branch:"${c.branch}", changes:[{category, description, shouldHaveCaught, candidateRule}]}.`
}

function retroSynthPrompt(analyses) {
  return `Synthesize retrospect analyses into improvement PROPOSALS for the implement-plan workflow. You may WRITE ONE new proposal document, but do NOT edit any existing convention, charter, prompt, or code file — proposals are reviewed by a human first.

Case analyses (JSON):
${JSON.stringify(analyses)}

1. Deduplicate candidateRules across cases; keep the generalizable ones; rank by recurrence and severity of what was missed.
2. For each surviving proposal specify: rule (one line); target — one of: ${REPO_PROFILE.conventionsDoc} (the repo conventions doc, read by every agent that implements, fixes or reviews — the implement passes, both fixers, the per-phase reviewers, the whole board and the QA gate — but NOT by parse, setup, criteria-verify, synthesis, triage, the other three gates, finalize or the retro stages, so a rule aimed at one of those cannot be delivered here) | a named reviewer charter under .claude/workflows/implement-plan-assets/reviewers/ (say which — the repo-specific \`reviewer-${REPO_PROFILE.domainReviewer}.md\` is the right home for hazards peculiar to this codebase — or propose a new charter) | the pitfalls section of .claude/commands/implement-plan.md; suggestedText (exact ready-to-paste wording); evidence (branch + commit references). Do NOT propose edits to the workflow script itself for anything expressible as a convention or charter rule: the script is meant to stay identical across repos. Also pick the NARROWEST home that still reaches the agent which should have caught the miss: ${REPO_PROFILE.conventionsDoc} is read by EVERY implement, review and fix agent, so a rule that only applies to one stage (a quality gate, the finalization step, the fixer round) does NOT belong there — agents act on rules they cannot act on, and the resulting mid-run damage is worse than the missing rule. If a proposal is really about pipeline mechanics rather than code, say so plainly and leave placement to a human.
3. Write the full proposal document to .claude/ai/retrospect-<YYYY-MM-DD>-implement-plan-feedback.md in the MAIN repo checkout (repoRoot, not a worktree); get the date from \`date +%F\`. Include per-case summaries, the ranked proposals, and the evidence. Note: .claude/ai/ is gitignored BY DESIGN — the doc is a local proposal for a human to read, not something to commit; do not stage it.

Return {docPath, proposals:[{rule, target, suggestedText, evidence[]}]}.`
}

// ---------- per-phase execution: pass chain -> external reviews -> criteria verification ----------
async function runPhasePasses(phaseSpec, idx, worktree, base, planContext, planInWorktree) {
  const complexity = (phaseSpec.complexity || 'MEDIUM').toUpperCase()
  const passes = phaseSpec.passChain || passChainFor(complexity)
  const reviewers = phaseSpec.reviewers || reviewersFor(complexity)
  // phaseStartSha / passesCommitted are filled in as the pass chain runs and are read by
  // phaseDiffBlock() when it builds the later passes' and the reviewers' prompts.
  const ctx = {
    worktree,
    base,
    planContext,
    planInWorktree,
    toolchain: TOOLCHAIN,
    phaseNum: idx + 1,
    testFirst,
    phaseStartSha: null,
    passesCommitted: 0,
  }

  const passResults = []
  let prevSummary = null
  let chainComplete = true
  for (let i = 0; i < passes.length; i = i + 1) {
    const pass = passes[i]
    const r = await agent(
      phasePassPrompt(phaseSpec, pass, prevSummary, ctx),
      withTier(
        { schema: PASS_SCHEMA, label: `phase${idx + 1}:${pass}`, phase: 'Implement phases' },
        pass === 'initial' || pass === 'spec_tests' ? TIER.implement_initial : TIER.implement_refine
      )
    )
    if (!r) {
      chainComplete = false
      log(`Phase ${idx + 1} pass "${pass}" agent returned null — stopping this phase's chain.`)
      break
    }
    passResults.push(r)
    if (r.committed) {
      ctx.passesCommitted = ctx.passesCommitted + 1
      // First committed pass of the phase = the anchor. Never overwritten by a later pass.
      if (!ctx.phaseStartSha && /^[0-9a-f]{7,40}$/.test(String(r.commitSha || ''))) ctx.phaseStartSha = r.commitSha
    }
    prevSummary = r.summary || prevSummary
  }

  // External review rounds: read-only critics with fresh PR-reviewer framing, then a fixer ONLY
  // when there are findings (conditional hop — keeps the critical path short).
  //
  // The reviewers run CONCURRENTLY and a SINGLE fixer applies the union of their findings. They
  // used to run strictly serially (reviewer -> fixer -> reviewer -> fixer), which measured as the
  // largest single cost in a run: 37% of the wall-clock, 18-32 min per round. The vantages are
  // independent by construction (REVIEW_VANTAGE) and their finding ids are prefixed per reviewer,
  // so nothing about the critique needed the serialization. TRADE-OFF: hardening_review no longer
  // sees spec_review's fixes, so a fix-introduced defect is caught by the review board over the
  // cumulative diff rather than inside the phase.
  const reviews = []
  let reviewFix = null
  // Reviewer findings this phase's fixer did not land. Same entry shape as the board's
  // unappliedFixes so both feed one severity filter in the readyForPr conjunction.
  const unappliedReviewFixes = []
  if (chainComplete && reviewers.length) {
    const revResults = await parallel(
      reviewers.map((reviewer) => () =>
        agent(
          reviewerPrompt(phaseSpec, reviewer, ctx),
          withTier(
            { schema: REVIEW_SCHEMA, label: `phase${idx + 1}:${reviewer}`, phase: 'Implement phases' },
            TIER.phase_review
          )
        )
      )
    )
    const allFindings = []
    const contributors = []
    for (let k = 0; k < reviewers.length; k = k + 1) {
      const reviewer = reviewers[k]
      const rev = revResults[k]
      if (!rev) {
        log(`Phase ${idx + 1} reviewer "${reviewer}" returned null — its findings are absent from this phase's fix round.`)
        reviews.push({ reviewer, findings: null, fixApplied: false, fixNotes: null })
        continue
      }
      const findings = rev.findings || []
      reviews.push({ reviewer, findings, fixApplied: false, fixNotes: null })
      if (findings.length) contributors.push(reviewer)
      for (const f of findings) allFindings.push(f)
    }
    if (allFindings.length) {
      // Name only the reviewers that actually contributed, so the fixer is not told to reconcile
      // a vantage that returned nothing (or died).
      const label = contributors.join('+')
      reviewFix = await agent(
        reviewFixPrompt(phaseSpec, label, allFindings, ctx),
        withTier(
          { schema: FIX_SCHEMA, label: `phase${idx + 1}:review-fix`, phase: 'Implement phases' },
          TIER.phase_fix
        )
      )
      if (!reviewFix)
        log(`Phase ${idx + 1} fixer returned null — ${allFindings.length} review finding(s) across ${label} were NOT applied.`)
      const unfixedIds = new Set(
        (reviewFix && Array.isArray(reviewFix.unfixedFindingIds) ? reviewFix.unfixedFindingIds : []).filter(Boolean)
      )
      // One fixer now owns every reviewer's findings, so its outcome is what each contributing
      // reviewer's fixApplied reports — but only for the findings it did not skip.
      for (const r of reviews) {
        if (r.findings && r.findings.length) {
          r.fixApplied = !!(reviewFix && reviewFix.applied === true) && !r.findings.some((f) => unfixedIds.has(f.id))
          r.fixNotes = (reviewFix && reviewFix.notes) || null
        }
      }
      // A phase's reviewer findings are defects a critic asked to see fixed before merge, so a
      // fixer that died, reported applied=false, or named findings it skipped leaves them unfixed
      // exactly like an unapplied BOARD fix group — and must block readyForPr the same way. It did
      // not before: `complete` covers only the pass chain, and the board's unappliedFixes gate has
      // no per-phase analogue, so a dead fixer was logged and then forgotten. Running the reviewers
      // concurrently raised the stakes: one fixer death now drops the whole phase's critique.
      const missed = unfixedIds.size
        ? allFindings.filter((f) => unfixedIds.has(f.id))
        : reviewFix && reviewFix.applied === true
          ? []
          : allFindings
      if (missed.length) {
        const reason = !reviewFix
          ? 'phase review fixer returned null (terminal error or skip)'
          : reviewFix.applied !== true
            ? 'phase review fixer reported applied=false'
            : `phase review fixer left ${missed.length} finding(s) unfixed`
        unappliedReviewFixes.push({
          files: Array.from(new Set(missed.map((f) => String(f.file || '')).filter(Boolean))),
          maxSeverity: maxSeverityOf(missed),
          findingIds: missed.map((f) => f.id).filter(Boolean),
          reason: `${reason} — phase "${phaseSpec.name}"`,
          notes: (reviewFix && reviewFix.notes) || null,
        })
        log(
          `Phase ${idx + 1} review fixes NOT fully applied [${maxSeverityOf(missed)}] — ${reason}; ${missed.length} finding(s) remain.`
        )
      }
    }
  }

  // Independent criteria verification: a separate agent grades the phase against its
  // Automated criteria and ticks the plan checkboxes — never the implementer itself.
  let criteria = null
  if (chainComplete) {
    criteria = await agent(
      criteriaVerifyPrompt(phaseSpec, ctx),
      withTier(
        { schema: CRITERIA_SCHEMA, label: `phase${idx + 1}:criteria-verify`, phase: 'Implement phases' },
        TIER.criteria_verify
      )
    )
    if (!criteria) log(`Phase ${idx + 1} criteria-verify agent returned null — criteria treated as NOT met.`)
  }

  return {
    phase: phaseSpec.name,
    complexity,
    passesRun: passResults.length,
    passesTotal: passes.length,
    complete: chainComplete && passResults.length === passes.length,
    reviews,
    // The single merged fixer's own result (null when no reviewer found anything, or when the
    // fixer agent died). Per-reviewer `fixApplied` mirrors its `applied`, minus anything it named
    // in unfixedFindingIds.
    reviewFix,
    // Reviewer findings that never got fixed; blocks readyForPr unless every entry is MEDIUM/LOW.
    unappliedReviewFixes,
    criteria,
    criteriaMet: !!(criteria && criteria.allPassed === true),
    manualCriteria: phaseSpec.manualCriteria || [],
    passes: passResults,
  }
}

// ---------- fix scheduler: file-overlap-serialized waves ----------
// Returns {results, unapplied}. `unapplied` records every triaged group whose fixes did NOT
// land — a dead fix agent, or one reporting applied=false — because the run must NOT be able
// to report readyForPr while verified CRITICAL/HIGH findings sit unfixed (see the readyForPr
// conjunction below). A group is still marked done even when it failed, so groups blocked on
// it get their attempt rather than being dropped; the failure is recorded, not swallowed.
async function runFixWaves(groups, worktree) {
  const done = new Set()
  const results = []
  const unapplied = []
  let guard = 0
  while (done.size < groups.length && guard <= groups.length + 2) {
    guard = guard + 1
    const wave = []
    for (let i = 0; i < groups.length; i = i + 1) {
      if (done.has(i)) continue
      const blockers = groups[i].blockers || []
      if (blockers.every((b) => done.has(b))) wave.push(i)
    }
    if (wave.length === 0) break
    const waveRes = await parallel(
      wave.map((i) => () =>
        agent(
          fixPrompt(groups[i], worktree),
          withTier(
            { schema: FIX_SCHEMA, label: `fix:${(groups[i].files && groups[i].files[0]) || i}`, phase: 'Triage & fix' },
            TIER.board_fix
          )
        ).then((r) => ({ i, r }))
      )
    )
    for (let k = 0; k < wave.length; k = k + 1) {
      // waveRes[k] is null when the thunk threw; {i, r: null} when the agent itself
      // returned null — both mean the group's fixes were not applied.
      const gi = wave[k]
      const g = groups[gi]
      const files = (g.files || []).join(', ') || 'unknown files'
      const r = waveRes[k] && waveRes[k].r
      if (r) results.push(waveRes[k])
      // A group counts as unapplied on total failure OR on self-reported partial success:
      // `applied` is one boolean for a whole group, so an agent that fixes 2 of 3 findings and
      // names the third in unfixedFindingIds still returns applied=true.
      const unfixedIds = (r && Array.isArray(r.unfixedFindingIds) ? r.unfixedFindingIds : []).filter(Boolean)
      if (!r || r.applied !== true || unfixedIds.length) {
        const reason = !r
          ? 'fix agent returned null (terminal error or skip)'
          : r.applied !== true
            ? 'fix agent reported applied=false'
            : `fix agent left ${unfixedIds.length} finding(s) unfixed: ${unfixedIds.join(', ')}`
        unapplied.push({
          files: g.files || [],
          maxSeverity: String(g.maxSeverity || 'UNKNOWN').toUpperCase(),
          findingIds: unfixedIds.length ? unfixedIds : (g.findings || []).map((f) => f.id).filter(Boolean),
          reason,
          notes: (r && r.notes) || null,
        })
        log(`Fix group ${gi} (${files}) [${g.maxSeverity || 'UNKNOWN'}] NOT fully applied — ${reason}.`)
      }
      done.add(gi)
    }
  }
  return { results, unapplied }
}

// ---------- gates + review (shared by delegate + review) ----------
// `mergeMain` (delegate finalization) prepends a SYNC-WITH-BASE gate BEFORE build/test, so the
// merge with origin/main happens first and the recorded build AND test results apply to the
// final (post-merge) HEAD — surfacing a conflict or post-merge break as a gate failure here
// rather than deferring it to handoff.
async function runGates(worktree, base, gateOpts) {
  phase('Quality gates')
  const mergeMain = !!(gateOpts && gateOpts.mergeMain)
  const sequence = mergeMain ? ['sync', 'build', 'test', 'qa'] : ['build', 'test', 'qa']
  const GATE_TIER = { sync: TIER.gate_sync, build: TIER.gate_build, test: TIER.gate_test, qa: TIER.gate_qa }
  const gates = []
  for (let si = 0; si < sequence.length; si = si + 1) {
    const g = sequence[si]
    const gateOptions = withTier({ schema: GATE_SCHEMA, label: `gate:${g}`, phase: 'Quality gates' }, GATE_TIER[g])
    if (g === 'test') gateOptions.agentType = 'test-runner' // honor /implement-plan's test-runner mandate
    const r = await agent(gatePrompt(g, worktree, TOOLCHAIN, { base }), gateOptions)
    // A dead gate agent must NOT drop out of this array. `gatesPassed` is an .every() over it and
    // .every() on an EMPTY array is TRUE, so omitting a gate that never ran let a run whose gate
    // agents all died still report readyForPr. Record it as an explicit failure the caller can name.
    const rec = r || {
      gate: g,
      passed: false,
      agentDied: true,
      output: 'gate agent returned null (terminal error or skip) — this gate never ran',
    }
    gates.push(rec)
    if (!r) log(`Gate "${g}" agent returned null — recorded as a FAILED gate, because it never ran.`)
    // Stop on a sync or build gate that did not pass — including one whose agent died or answered
    // with a non-boolean, since then the merge state / build state is simply unknown. The predicate
    // is `!== true` to match gatesPassed's fail-closed test rather than the fail-open `=== false`.
    // The Test gate reuses the Build gate's outputs, and QA's format/warning loop over a tree that
    // may not build is pure noise.
    if ((g === 'sync' || g === 'build') && rec.passed !== true) {
      log(
        g === 'sync'
          ? 'Sync-with-base gate did not pass (merge conflict, or its agent died); skipping build/test/qa — resolve the merge before opening a PR.'
          : 'Build gate did not pass (build failure, or its agent died); skipping test/qa — their output would be noise on a tree that may not build.'
      )
      // Record the gates we are NOT running rather than leaving them out. Dropping them
      // reintroduces the ambiguity the synthetic agentDied entry exists to remove: a caller could
      // not tell "test failed" from "test never ran". gatesPassed is false either way — this is
      // reporting fidelity.
      for (let rest = si + 1; rest < sequence.length; rest = rest + 1) {
        gates.push({
          gate: sequence[rest],
          passed: false,
          skipped: true,
          output: `skipped — the ${g} gate did not pass`,
        })
      }
      break
    }
  }
  return gates
}

async function runReviewGate(board, worktree, base, boardDir, planPath, finalize) {
  const gateOpts = { mergeMain: !!finalize }
  phase('Review board')
  const boardResults = (
    await parallel(
      board.map((name) => () =>
        agent(
          boardPrompt(name, worktree, base, boardDir, planPath),
          withTier({ schema: BOARD_REVIEW_SCHEMA, label: `board:${name}`, phase: 'Review board' }, TIER.board_review)
        )
      )
    )
  ).filter(Boolean)
  const totalFindings = boardResults.reduce((n, r) => n + ((r.findings && r.findings.length) || 0), 0)
  log(`${boardResults.length}/${board.length} board reviewers returned; ${totalFindings} raw findings`)

  // `reviewIncomplete` distinguishes "the board ran and found nothing" from "the board never
  // reached a verdict". Without it every short-circuit below returns unappliedFixes: [], which
  // reads downstream as "nothing failed to apply" — so a dead synthesis or triage agent would grant
  // readyForPr with board findings never triaged or fixed, the exact failure the gate exists to
  // prevent, reached by a different route.
  if (totalFindings === 0) {
    const noReviewers = boardResults.length === 0
    log(
      noReviewers
        ? 'ALL board reviewers returned null (terminal error or skip) — the review never ran. Running gates only.'
        : 'No board findings. Skipping synthesis/triage/fix; running gates only.'
    )
    return {
      boardResults,
      synth: { groups: [] },
      triage: { groups: [] },
      fixes: [],
      unappliedFixes: [],
      reviewIncomplete: noReviewers ? 'all board reviewers returned null' : null,
      gates: await runGates(worktree, base, gateOpts),
    }
  }

  phase('Synthesize')
  const synth = await agent(
    synthPrompt(boardResults),
    withTier({ schema: SYNTH_SCHEMA, label: 'synthesis' }, TIER.synthesis)
  )
  // agent() returns null on a terminal API error or a mid-run skip. Degrade gracefully
  // (run gates only) instead of dereferencing synth/triage and crashing with a TypeError —
  // mirroring the zero-findings short-circuit above.
  if (!synth) {
    log(
      `Synthesis agent returned null (terminal error or skip); ${totalFindings} board finding(s) go untriaged and unfixed. Running gates only.`
    )
    return {
      boardResults,
      synth: null,
      triage: null,
      fixes: [],
      unappliedFixes: [],
      reviewIncomplete: `synthesis agent returned null with ${totalFindings} raw board finding(s) outstanding`,
      gates: await runGates(worktree, base, gateOpts),
    }
  }

  phase('Triage & fix')
  const synthGroups = synth.groups || []
  // SYNTH_SCHEMA only requires that `groups` be present, so `groups: []` is schema-valid. With zero
  // groups every downstream step no-ops (parallel([]) spawns nothing, runFixWaves returns empty) and
  // this would return reviewIncomplete: null — granting readyForPr with every board finding
  // untriaged. The old single-agent shape hit this only by accident; a fan-out makes it determinate.
  if (synthGroups.length === 0) {
    log(
      `Synthesis returned zero groups for ${totalFindings} raw board finding(s) — nothing was triaged or fixed. Running gates only.`
    )
    return {
      boardResults,
      synth,
      triage: { groups: [] },
      fixes: [],
      unappliedFixes: [],
      reviewIncomplete: `synthesis produced no groups for ${totalFindings} raw board finding(s)`,
      gates: await runGates(worktree, base, gateOpts),
    }
  }
  // Triage fans out ONE AGENT PER GROUP.
  const triaged = await parallel(
    synthGroups.map((g, gi) => () =>
      agent(
        triageGroupPrompt(g, worktree),
        withTier(
          { schema: TRIAGE_GROUP_SCHEMA, label: `triage:${(g.files && g.files[0]) || gi}`, phase: 'Triage & fix' },
          TIER.triage
        )
      )
    )
  )
  // A dead group-triage leaves that group's findings neither verified nor knowingly dropped, so it
  // must not silently vanish. Record it with the SAME blocking semantics as an unapplied fix rather
  // than dropping the group or handing unverified findings to a fixer.
  const untriaged = []
  const triagedGroups = []
  for (let k = 0; k < synthGroups.length; k = k + 1) {
    const g = synthGroups[k]
    const t = triaged[k]
    if (!t) {
      untriaged.push({
        files: g.files || [],
        maxSeverity: String(g.maxSeverity || 'UNKNOWN').toUpperCase(),
        findingIds: (g.findings || []).map((f) => f.id).filter(Boolean),
        reason: 'triage agent returned null (terminal error or skip) — findings were never verified or fixed',
        notes: null,
      })
      continue
    }
    const verified = (t.findings || []).filter((f) => f && f.status === 'verified')
    if (verified.length)
      triagedGroups.push({ files: t.files || g.files || [], maxSeverity: t.maxSeverity, findings: verified })
  }
  if (untriaged.length === synthGroups.length) {
    // Every group's triage died — the board never reached a verdict, exactly the old single-agent
    // null case, so it must block readyForPr rather than read as "nothing to fix".
    log(`All ${synthGroups.length} triage agent(s) returned null; ${totalFindings} board finding(s) go unfixed. Running gates only.`)
    return {
      boardResults,
      synth,
      triage: null,
      fixes: [],
      unappliedFixes: untriaged,
      reviewIncomplete: `all ${synthGroups.length} group triage agent(s) returned null`,
      gates: await runGates(worktree, base, gateOpts),
    }
  }
  if (untriaged.length)
    log(`${untriaged.length}/${synthGroups.length} group(s) could not be triaged — those findings were never verified or fixed.`)
  const fixGroups = computeBlockers(triagedGroups)
  log(`${fixGroups.length} verified fix group(s) after triage`)
  const { results: fixes, unapplied: waveUnapplied } = await runFixWaves(fixGroups, worktree)
  const unappliedFixes = untriaged.concat(waveUnapplied)
  if (unappliedFixes.length)
    log(
      `${unappliedFixes.length} fix group(s) did NOT land: ${unappliedFixes
        .map((u) => `[${u.maxSeverity}] ${(u.files || []).join(', ') || 'unknown files'}`)
        .join(' | ')}`
    )

  const gates = await runGates(worktree, base, gateOpts)
  return {
    boardResults,
    synth,
    triage: { groups: triagedGroups },
    fixes,
    unappliedFixes,
    reviewIncomplete: null,
    gates,
  }
}

// ---------- main ----------
// Validate operator inputs up front and fail fast with a clear message, rather than letting a
// bad value surface later as an opaque schema-validation error (profile) or silently run the
// mutating delegate path (an unrecognised mode).
if (!['delegate', 'expand', 'review', 'retrospect'].includes(mode)) {
  log(`Invalid mode "${mode}". Use one of: delegate, expand, review, retrospect.`)
  return { error: `invalid mode: ${mode}` }
}
if (profileOverride && !['LOW', 'MEDIUM', 'HIGH'].includes(profileOverride)) {
  log(`Invalid profile "${a.profile}". Use LOW, MEDIUM, or HIGH (or omit to use each phase's own complexity).`)
  return { error: `invalid profile: ${a.profile}` }
}
if (!planRef && !['review', 'retrospect'].includes(mode)) {
  log('No plan reference. Pass args:{plan:".claude/ai/plan-....md"} (or use mode:"review" / mode:"retrospect").')
  return { error: 'missing plan reference', mode }
}

// LOAD PROFILE: prompts interpolate the toolchain commands, so the profile must resolve before
// any prompt is built. Every mode loads it (retrospect needs the conventions-doc path to aim its
// proposals); only the modes that actually run gates require a complete toolchain. Missing
// build/test commands are a HARD stop — gates that execute nothing would report green, which is
// far worse than refusing to start.
phase('Load profile')
const gatingMode = mode !== 'retrospect'
const loadedProfile = await agent(
  repoProfilePrompt(),
  withTier({ schema: REPO_PROFILE_SCHEMA, label: 'load-profile', phase: 'Load profile' }, TIER.load_profile)
)
if (!loadedProfile || loadedProfile.found !== true) {
  const msg = `No repo profile at ${REPO_PROFILE_REL}. Copy repo-profile.example.json to that path, fill in your build/test/format/lint commands, conventions doc and domain-reviewer name, then re-run. The pipeline will not guess them.`
  if (gatingMode) {
    log(msg)
    return { error: 'missing repo profile', profilePath: REPO_PROFILE_REL, mode }
  }
  log(`${msg} Continuing in retrospect mode with defaults.`)
} else {
  const tc = Object.assign({}, FALLBACK_REPO_PROFILE.toolchain, loadedProfile.toolchain || {}, toolchainOverride)
  REPO_PROFILE = {
    repoLabel: loadedProfile.repoLabel || FALLBACK_REPO_PROFILE.repoLabel,
    toolchain: tc,
    conventionsDoc: loadedProfile.conventionsDoc || FALLBACK_REPO_PROFILE.conventionsDoc,
    archDoc: loadedProfile.archDoc || '',
    domainReviewer: loadedProfile.domainReviewer || FALLBACK_REPO_PROFILE.domainReviewer,
    qaExtraSteps: loadedProfile.qaExtraSteps || [],
    testFilterNote: loadedProfile.testFilterNote || '',
  }
  TOOLCHAIN = tc
  REPO_LABEL = REPO_PROFILE.repoLabel
  if (gatingMode && (!tc.build_verify_cmd || !tc.test_cmd)) {
    const missing = [!tc.build_verify_cmd ? 'toolchain.build_verify_cmd' : '', !tc.test_cmd ? 'toolchain.test_cmd' : '']
      .filter(Boolean)
      .join(' and ')
    log(`Repo profile is missing ${missing}. Those gates would pass vacuously — fix ${REPO_PROFILE_REL} and re-run.`)
    return { error: 'incomplete repo profile toolchain', profilePath: REPO_PROFILE_REL, mode, toolchain: tc }
  }
  ;(loadedProfile.warnings || []).forEach((w) => log(`Profile warning: ${w}`))
  log(
    `Profile: ${REPO_LABEL} | conventions ${REPO_PROFILE.conventionsDoc}${REPO_PROFILE.archDoc ? ` | arch ${REPO_PROFILE.archDoc}` : ''} | domain reviewer ${REPO_PROFILE.domainReviewer}${Object.keys(toolchainOverride).length ? ' | toolchain partly overridden by args' : ''}`
  )
}

if (mode === 'retrospect') {
  phase('Discover cases')
  const disco = await agent(
    retroDiscoverPrompt(),
    withTier({ schema: RETRO_DISCOVER_SCHEMA, label: 'retro-discover' }, TIER.retro_discover)
  )
  if (!disco || !(disco.cases || []).length) {
    log('No retrospect cases found (need implement-plan/* branches with human commits on top of [implplan] work).')
    return { mode, cases: [] }
  }
  log(`${disco.cases.length} retrospect case(s): ${disco.cases.map((c) => c.branch).join(', ')}`)
  phase('Analyze feedback')
  const analyses = (
    await parallel(
      disco.cases.map((c) => () =>
        agent(
          retroAnalyzePrompt(c),
          withTier(
            { schema: RETRO_CASE_SCHEMA, label: `retro:${c.branch.split('/').pop()}`, phase: 'Analyze feedback' },
            TIER.retro_analyze
          )
        )
      )
    )
  ).filter(Boolean)
  if (!analyses.length) {
    log('All case analysts returned null; nothing to synthesize.')
    return { mode, cases: disco.cases, analyses: [], proposals: null }
  }
  phase('Synthesize')
  const proposals = await agent(
    retroSynthPrompt(analyses),
    withTier({ schema: RETRO_PROPOSAL_SCHEMA, label: 'retro-proposals' }, TIER.retro_synth)
  )
  if (!proposals) {
    log('Proposal synthesis agent returned null; returning raw analyses.')
    return { mode, cases: disco.cases, analyses, proposals: null }
  }
  log(
    `${(proposals.proposals || []).length} proposal(s)${proposals.docPath ? ` — written to ${proposals.docPath}` : ''}. Propose-only: review before applying to CONVENTIONS/charters.`
  )
  return { mode, cases: disco.cases, analyses, proposals }
}

if (mode === 'review') {
  phase('Parse')
  const ctx = await agent(reviewCtxPrompt(), withTier({ schema: REVIEW_CTX_SCHEMA, label: 'resolve-ctx' }, TIER.review_ctx))
  if (!ctx || !ctx.worktreePath) {
    // A null worktreePath is either a dead agent or a safety-gate refusal; the latter carries the
    // reason in ctx.error (dirty tree, default branch checked out). Nothing has been touched yet.
    log('Could not resolve the review worktree' + (ctx && ctx.error ? ': ' + ctx.error : '.'))
    return { error: 'unresolved worktree', mode, ctx }
  }
  const board = selectBoard(profileOverride || 'HIGH')
  const boardDir = `${ctx.repoRoot || ctx.worktreePath}/${BOARD_REL}`
  log(`Review ${ctx.worktreePath} vs ${ctx.base} | board: ${board.join(', ')}`)
  const gate = await runReviewGate(board, ctx.worktreePath, ctx.base, boardDir, null)
  return { mode, ctx, board, ...gate }
}

// expand | delegate
phase('Parse')
const plan = await agent(parsePrompt(planRef), withTier({ schema: PLAN_SCHEMA, label: 'parse-plan' }, TIER.parse))
if (!plan) {
  log('Parse agent returned null (terminal error or skip); cannot continue.')
  return { mode, error: 'parse agent returned null' }
}
if (!plan.valid) {
  log(`Plan invalid: ${(plan.errors || ['unknown error']).join('; ')}`)
  return { mode, plan }
}
// The key lands verbatim in commit subjects and prompt-embedded shell commands, so gate it
// on the strict <PROJECT>-<number> shape (no colons/quotes/slashes) rather than trusting the
// parse agent's string; anything else falls back to the notask: prefix.
const issueRaw = typeof plan.issue === 'string' ? plan.issue.trim() : ''
const issue = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(issueRaw) ? issueRaw.toUpperCase() : null
if (issue) COMMIT_PREFIX = `${issue}: `
else if (issueRaw) log(`Plan issue key "${issueRaw}" does not match the <PROJECT>-<number> pattern — using the notask: prefix.`)
const phases = plan.phases || []
phases.forEach((p) => {
  if (profileOverride) p.complexity = profileOverride
  p.complexity = (p.complexity || 'MEDIUM').toUpperCase()
  p.passChain = passChainFor(p.complexity)
  p.reviewers = reviewersFor(p.complexity)
})
const profile = profileOverride || maxComplexity(phases)
const board = selectBoard(profile)
const totalPasses = phases.reduce((n, p) => n + p.passChain.length + p.reviewers.length + 1, 0) // +1 = criteria-verify
log(
  `${phases.length} phase(s) [${phases.map((p) => p.complexity[0]).join('')}] | ${totalPasses} implement/review/verify steps${testFirst ? ' (test-first ON)' : ''} | review profile ${profile} | commit prefix "${COMMIT_PREFIX.trim()}"${issue ? '' : ' (no issue key in plan)'} | board: ${board.join(', ')}${reviewersOverride ? '' : ' + plan-conformance (auto, when plan copy lands in worktree)'}`
)
if ((plan.errors || []).length) log(`Parse notes: ${plan.errors.join('; ')}`)

if (mode === 'expand') {
  log('expand mode: manifest only — nothing created, no code changed.')
  return {
    mode,
    profile,
    issue,
    commitPrefix: COMMIT_PREFIX.trim(),
    testFirst,
    noWorktree,
    board,
    // conditional: runs in delegate only if the plan copy lands in the worktree
    conditionalReviewers: reviewersOverride ? [] : ['plan-conformance'],
    phases: phases.map((p) => ({
      name: p.name,
      complexity: p.complexity,
      passes: p.passChain,
      reviewers: p.reviewers,
      manualCriteria: p.manualCriteria,
    })),
    planContext: plan.planContext,
  }
}

phase('Set up worktree')
const setup = await agent(
  noWorktree ? setupInPlacePrompt(planRef) : setupPrompt(planRef),
  withTier({ schema: SETUP_SCHEMA, label: noWorktree ? 'in-place-setup' : 'worktree' }, TIER.setup)
)
if (!setup || !setup.worktreePath) {
  log(`${noWorktree ? 'In-place setup' : 'Worktree setup'} failed: ${(setup && setup.error) || 'unknown'}`)
  return { mode, plan, setup }
}
const base = baseOverride || setup.base || 'origin/main'
const repoRoot = setup.repoRoot || setup.worktreePath
const boardDir = `${repoRoot}/${BOARD_REL}`
log(`${noWorktree ? 'In-place (no worktree)' : 'Worktree'} ${setup.worktreePath} @ ${setup.branch} vs ${base}`)

phase('Implement phases')
// STRICTLY SEQUENTIAL: each phase builds on the prior phase's committed work.
const phaseResults = []
for (let i = 0; i < phases.length; i = i + 1) {
  const r = await runPhasePasses(phases[i], i, setup.worktreePath, base, plan.planContext, setup.planInWorktree)
  phaseResults.push(r)
  const reviewFindings = (r.reviews || []).reduce((n, v) => n + ((v.findings && v.findings.length) || 0), 0)
  log(
    `Phase ${i + 1}/${phases.length} "${r.phase}" (${r.complexity}): ${r.passesRun}/${r.passesTotal} passes, ${reviewFindings} review finding(s), criteria ${r.criteriaMet ? 'VERIFIED' : 'NOT verified'}${r.complete ? '' : ' — INCOMPLETE'}`
  )
  // A phase whose pass chain did not finish leaves the branch in a state the plan does not
  // describe, and phase N+1 is specified against phase N's committed work. Continuing spends a
  // full run — every later phase, the 12-reviewer board, triage and the fix waves — building on
  // and reviewing damage, and readyForPr was already false the moment this phase came back
  // incomplete. Stop here instead.
  if (!r.complete) {
    const skipped = phases.slice(i + 1)
    log(
      `Phase ${i + 1} "${r.phase}" did not complete — stopping the phase chain. ${skipped.length} later phase(s) will NOT run: ${
        skipped.map((p) => p.name).join(', ') || '(none)'
      }`
    )
    // RECORD the phases that never ran; do not just drop them. criteriaOk below is an .every()
    // over this array, and .every() over a list that silently lost its failing members is the
    // exact shape that once let a run with no gate at all report itself ready.
    skipped.forEach((p) => {
      phaseResults.push({
        phase: p.name,
        complexity: (p.complexity || 'MEDIUM').toUpperCase(),
        passesRun: 0,
        passesTotal: (p.passChain || passChainFor((p.complexity || 'MEDIUM').toUpperCase())).length,
        complete: false,
        skippedAfterFailure: `phase ${i + 1} ("${r.phase}") did not complete`,
        reviews: [],
        reviewFix: null,
        unappliedReviewFixes: [],
        criteria: null,
        criteriaMet: false,
        manualCriteria: p.manualCriteria || [],
        passes: [],
      })
    })
    break
  }
}
const incomplete = phaseResults.filter((r) => !r.complete)
if (incomplete.length) log(`${incomplete.length} incomplete phase(s): ${incomplete.map((r) => r.phase).join(', ')}`)
// The phases whose work actually landed. `phases` still holds every phase the plan declared, and
// handing the full list to the re-verifier would ask it to grade criteria for code that was never
// written: it would report failures that are not regressions, and — because its cheap short-circuit
// keys on finding a `criteria-verified` commit, of which a stopped run has none — it would pay for a
// full test suite to do it. Same waste the early stop exists to avoid.
const ranPhases = phases.filter((p, idx) => !(phaseResults[idx] || {}).skippedAfterFailure)

// plan-conformance judges the diff against the plan itself — only possible when the plan
// copy landed in the worktree, and skipped when the caller pinned an explicit reviewer list.
const boardRoster = setup.planInWorktree && !reviewersOverride ? board.concat(['plan-conformance']) : board
// finalize=true: the QA gate syncs origin/main first, and the delegate run owns the branch, so
// the finalization steps below (re-verify + branch hygiene) are allowed to run.
const gate = await runReviewGate(boardRoster, setup.worktreePath, base, boardDir, setup.planInWorktree, true)

// P4 RE-VERIFICATION: the board-review fix waves AND the QA gate (base-sync merge + format/
// warning commits) are all behavior-changing changes to HEAD made AFTER each phase's own
// criteria verification, which invalidates it for the touched criteria. Invoked on every
// delegate run (deciding up front whether HEAD moved would require its own git hop), but the
// agent short-circuits cheaply via git log when nothing landed after the last criteria-verified
// commit — so a genuinely clean run pays a `git log`, not a second full ~10-min test suite.
phase('Finalize')
const reverify = await agent(
  criteriaReverifyPrompt(ranPhases, setup.worktreePath, TOOLCHAIN, base),
  // TIER.reverify is deliberately 'medium', not 'low': this aggregates and interprets pass/fail
  // across every phase's criteria over the final HEAD and is the last gate before readyForPr —
  // a wrong "allPassed" is costly.
  withTier({ schema: CRITERIA_SCHEMA, label: 'criteria-reverify', phase: 'Finalize' }, TIER.reverify)
)
if (!reverify) log('Post-fix criteria re-verification returned null — treating criteria as NOT re-verified.')
else
  log(
    reverify.allPassed === true
      ? 'Post-fix criteria re-verification: all automated criteria still pass over the final HEAD.'
      : incomplete.length
        ? 'Post-fix criteria re-verification: criteria NOT met. The phase chain stopped early, so these criteria never passed — this is not a regression.'
        : 'Post-fix criteria re-verification: REGRESSION — a post-verification change broke a previously-passing criterion; see reverify.results.'
  )
const criteriaReOk = !!(reverify && reverify.allPassed === true)

// P1 BRANCH HYGIENE: strip the internal plan snapshot (and its checkbox commits) so the PR diff
// carries only product files; fail loudly if any other gitignored path leaked into the diff.
// (Already inside the 'Finalize' phase from the re-verify step above — no re-announce needed.)
const hygiene = await agent(
  finalizePrompt(setup.worktreePath, base, setup.planInWorktree, COMMIT_PREFIX),
  withTier({ schema: FINALIZE_SCHEMA, label: 'branch-hygiene', phase: 'Finalize' }, TIER.hygiene)
)
if (!hygiene) log('Branch-hygiene finalization returned null — the plan snapshot may still be in the PR diff.')
else if (hygiene.cleanDiff === true) log('Branch hygiene: PR diff is free of .claude/ai/ and other gitignored paths.')
else
  log(
    `Branch hygiene: diff still contains ${(hygiene.offendingPaths || []).join(', ') || 'gitignored path(s)'} — human cleanup needed before opening a PR.`
  )
const hygieneOk = !!(hygiene && hygiene.cleanDiff === true)

// Manual success criteria can't be auto-verified — surface them as a human checklist.
const manualChecklist = phaseResults
  .filter((r) => !r.skippedAfterFailure && (r.manualCriteria || []).length)
  .map((r) => ({ phase: r.phase, items: r.manualCriteria }))

// Signal whether the run finished cleanly enough to open a PR. The workflow never opens one
// itself (it runs unattended); the caller uses this flag to ASK the user post-run.
// criteriaMet comes from the INDEPENDENT verifier, not the implementer.
// `g.passed === true` (not truthiness) is the load-bearing half: it is what stops a dead or
// non-boolean gate reading as green. The `length > 0` half is DEFENSIVE ONLY and cannot fire today —
// `sequence` is never empty and every iteration of runGates pushes something (a real result, a
// synthetic agentDied entry, or a skipped entry) — but it keeps the .every() safe if runGates ever
// gains an early return before the loop.
const gateResults = gate.gates || []
const gatesPassed = gateResults.length > 0 && gateResults.every((g) => g && g.passed === true)
const failedGates = gateResults.filter((g) => !g || g.passed !== true).map((g) => (g && g.gate) || 'unknown')
if (!gateResults.length) log('No quality gate produced a result at all — treating the gates as FAILED, not as green.')
else if (failedGates.length) log(`Gate(s) not green: ${failedGates.join(', ')}.`)
// `length > 0` mirrors gatesPassed above, and it is NOT defensive here: PLAN_SCHEMA requires only
// {valid, phases}, and the no-empty-plan rule lives in the parse prompt rather than the schema. A
// parse agent returning `{valid: true, phases: []}` therefore leaves phaseResults empty, and an
// unguarded .every() over it is vacuously true — a run that implemented nothing reporting itself
// ready.
const criteriaOk = phaseResults.length > 0 && phaseResults.every((r) => r.criteriaMet)
// A triaged group is a VERIFIED board finding, so one that never landed is an unfixed defect the run
// knows about. Gate readyForPr on the severities a human would refuse to merge past rather than on
// any unapplied group at all — a MEDIUM/LOW miss is surfaced without making the flag so pessimistic
// that it gets ignored. The filter is INVERTED (exclude MEDIUM/LOW) rather than an allow-list of
// CRITICAL/HIGH so it fails CLOSED: an unrecognised or missing severity blocks instead of slipping
// through.
const unappliedFixes = gate.unappliedFixes || []
// Per-phase reviewer findings whose merged fixer never landed them are the same class of defect as
// an unapplied board group — a critic asked for the change before merge and nobody made it — so
// they run through the SAME filter. Before this they were logged and then forgotten: `complete`
// covers only the pass chain, so a dead phase fixer could still yield readyForPr.
const unappliedReviewFixes = phaseResults.reduce((acc, r) => acc.concat(r.unappliedReviewFixes || []), [])
const blockingUnapplied = unappliedFixes
  .concat(unappliedReviewFixes)
  .filter((u) => u.maxSeverity !== 'MEDIUM' && u.maxSeverity !== 'LOW')
// A review that never reached a verdict (all reviewers dead, a dead synthesis/triage agent, or a
// synthesis that produced no groups for real findings) leaves unappliedFixes empty for the wrong
// reason — it must block just like an unapplied fix.
const fixesOk = blockingUnapplied.length === 0 && !gate.reviewIncomplete
if (gate.reviewIncomplete) log(`Review board did not reach a verdict — ${gate.reviewIncomplete}. Blocking readyForPr.`)
if (blockingUnapplied.length)
  log(
    `${blockingUnapplied.length} blocking fix group(s) (CRITICAL/HIGH, or an unrecognised severity) never landed — verified findings remain unfixed: ${blockingUnapplied
      .map((u) => `[${u.maxSeverity}] ${(u.files || []).join(', ') || 'unknown files'} (${u.reason})`)
      .join(' | ')}`
  )
else if (unappliedFixes.length + unappliedReviewFixes.length)
  log(
    `${unappliedFixes.length + unappliedReviewFixes.length} MEDIUM/LOW fix group(s) did not land — surfaced in unappliedFixes / unappliedReviewFixes, not blocking readyForPr.`
  )
const readyForPr = incomplete.length === 0 && criteriaOk && criteriaReOk && fixesOk && gatesPassed && hygieneOk
log(
  readyForPr
    ? `Implementation fully finished on branch ${setup.branch} — all phases complete, criteria independently verified (incl. post-fix re-verification), board fixes applied, gates green, plan snapshot stripped. Ready for a PR; the caller should ask the user whether to open one.`
    : `Run finished with open items (${incomplete.length} incomplete phase(s); criteria ${criteriaOk ? 'verified' : 'NOT all verified'}; post-fix re-verify ${criteriaReOk ? 'clean' : 'REGRESSED/absent'}; board review ${fixesOk ? 'complete and fixes applied' : gate.reviewIncomplete ? `INCOMPLETE (${gate.reviewIncomplete})` : `${blockingUnapplied.length} blocking group(s) UNAPPLIED`}; gates ${gatesPassed ? 'green' : `FAILED (${failedGates.join(', ') || 'none ran'})`}; branch hygiene ${hygieneOk ? 'clean' : 'NOT clean'}). Resolve before opening a PR.`
)
// `issue` is surfaced so the caller can prefix the PR title with it (e.g. "PROJ-123: ...").
// `noWorktree` tells the caller the commits landed in the main checkout, not a sibling worktree.
// `unappliedFixes` (from ...gate) lists every verified BOARD fix group that never fully landed;
// `unappliedReviewFixes` is the per-phase equivalent for reviewer findings; `blockingUnappliedFixes`
// is the subset of BOTH that held readyForPr back — relay all three. `reviewIncomplete` (also from
// ...gate) is non-null when the board never reached a verdict at all.
return { mode, profile, issue, noWorktree, planContext: plan.planContext, setup, branch: setup.branch, phaseResults, manualChecklist, reverify, hygiene, readyForPr, ...gate, unappliedReviewFixes, blockingUnappliedFixes: blockingUnapplied }
