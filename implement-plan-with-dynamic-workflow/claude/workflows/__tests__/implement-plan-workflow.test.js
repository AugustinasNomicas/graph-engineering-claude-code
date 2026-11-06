// Orchestration tests for .claude/workflows/implement-plan-with-dynamic-workflow.js.
//
//   node .claude/workflows/__tests__/implement-plan-workflow.test.js
//
// No dependencies and no test runner: it loads the REAL workflow script and drives it with
// stubbed agent()/parallel()/log()/phase(), so the control flow executes for real without a
// single model call or file change. A failed assertion does not stop the run: it is reported, the
// remaining scenarios still execute, and the process exits non-zero at the end. That is deliberate —
// one mutation can surface several independent failures, which a fail-fast harness would hide.
//
// What it is for: the script's decisions — which agents run, in what order, concurrently or not,
// and above all when `readyForPr` must be withheld — are pure orchestration, and every one of
// them is reachable from here. The fail-closed paths especially: they only ever fire when an
// agent dies mid-run, which is precisely the case you cannot reproduce by running the workflow.
//
// Adding a scenario: give `run()` a scenario object. `nullFor(label)` makes that agent return
// null (simulating a terminal API error or a mid-run skip); `failGate` makes one gate report
// passed:false. Stub any new agent label in `agent()` below or it throws — deliberately, so a
// new agent cannot slip into the pipeline untested.
//
// The stubbed repo profile below stands in for implement-plan-assets/repo-profile.json. It sets
// the three OPTIONAL speed keys so the scoped/no-rebuild paths are exercised; scenario 18 clears
// them to prove the fallbacks work for a profile that predates them.
const fs = require('fs')
const path = require('path')
const F = path.join(__dirname, '..', 'implement-plan-with-dynamic-workflow.js')
const src = fs.readFileSync(F, 'utf8').replace(/^export const meta/m, 'const meta')

// Distinct 40-hex SHAs per phase+pass, so an assertion can name which anchor an agent received.
const FAKE_SHA = {
  '1:initial': '1'.repeat(40),
  '1:edge_cases': 'a'.repeat(40),
  '1:spec_tests': 'c'.repeat(40),
  '2:initial': '2'.repeat(40),
  '2:edge_cases': 'b'.repeat(40),
  '2:spec_tests': 'd'.repeat(40),
}

function makeRunner() {
  return new Function(
    'agent',
    'parallel',
    'pipeline',
    'log',
    'phase',
    'args',
    'budget',
    'workflow',
    `return (async () => { ${src} })()`
  )
}

async function run(scenario) {
  const calls = []
  const logs = []
  let liveReviewers = 0
  let maxConcurrentReviewers = 0

  const agent = async (prompt, o) => {
    o = o || {}
    calls.push({ label: o.label, effort: o.effort, model: o.model, agentType: o.agentType, phase: o.phase })
    const L = String(o.label || '')
    if (scenario.capturePrompt) scenario.capturePrompt(L, String(prompt))
    if (scenario.nullFor && scenario.nullFor(L)) return null

    if (L === 'load-profile')
      return Object.assign(
        {
          found: true,
          repoLabel: 'the fixture repo',
          toolchain: {
            restore_cmd: 'fake install',
            build_verify_cmd: 'fake build',
            test_cmd: 'fake test-all',
            format_cmd: 'fake fmt',
            lint_cmd: 'fake fmt --check',
            build_fast_cmd: 'fake build --fast',
            test_no_build_cmd: 'fake test-all --no-build',
            test_scoped_shape: 'fake test <project> --filter <name>',
          },
          conventionsDoc: 'docs/conventions.md',
          archDoc: 'docs/architecture.md',
          domainReviewer: 'domain-hazards',
          qaExtraSteps: ['fake typecheck'],
          testFilterNote: 'unit suite only',
          warnings: [],
        },
        scenario.profile || {}
      )
    if (L === 'parse-plan')
      return {
        valid: true,
        errors: [],
        issue: 'PROJ-1234',
        planContext: 'ctx',
        phases: [
          { name: 'Datalayer', complexity: 'MEDIUM', spec: 's1', automatedCriteria: ['dotnet build'], manualCriteria: ['eyeball the UI'] },
          { name: 'Service', complexity: 'HIGH', spec: 's2', automatedCriteria: ['dotnet test'], manualCriteria: [] },
        ],
        // AFTER the literal so it wins. A scenario can hand back a different phase list — or none.
        ...(scenario.phasesOverride ? { phases: scenario.phasesOverride } : {}),
      }
    if (L === 'worktree' || L === 'in-place-setup')
      return { worktreePath: '/wt', branch: 'implement-plan/x', base: 'origin/main', repoRoot: '/repo', planInWorktree: '.claude/ai/p.md' }
    if (/^phase\d+:(initial|edge_cases|spec_tests)$/.test(L)) {
      const r = { pass: L.split(':')[1], applied: true, summary: 'did work', filesTouched: ['a.cs'], committed: true }
      // Production agents report the SHA they committed (PASS_SCHEMA.commitSha) and the phase's
      // FIRST one becomes the anchor every later pass and reviewer diffs against. A distinct fake
      // per phase+pass lets an assertion prove each agent got ITS OWN phase's anchor, and that a
      // later pass never overwrote it. `noCommitSha` simulates an agent that omits the field, which
      // is what drives the grep fallback.
      if (!scenario.noCommitSha) r.commitSha = FAKE_SHA[L.replace('phase', '')]
      return r
    }
    if (/^phase\d+:(spec_review|hardening_review)$/.test(L)) {
      liveReviewers = liveReviewers + 1
      maxConcurrentReviewers = Math.max(maxConcurrentReviewers, liveReviewers)
      await new Promise((r) => setTimeout(r, 20))
      liveReviewers = liveReviewers - 1
      const p = L.endsWith('hardening_review') ? 'HARD' : 'REV'
      return {
        reviewer: L.split(':')[1],
        findings: [
          { id: `${p}-1`, severity: scenario.reviewSeverity || 'HIGH', file: 'a.cs', observed: 'o', fix: 'f' },
        ],
      }
    }
    if (/^phase\d+:review-fix$/.test(L))
      return scenario.phaseFixResult || { applied: true, filesChanged: ['a.cs'], unfixedFindingIds: [] }
    if (/^phase\d+:criteria-verify$/.test(L)) return { results: [], allPassed: true, checkboxesTicked: true }
    if (/^board:/.test(L))
      return { reviewer: L.slice(6), findings: [{ id: 'SEC-C1', severity: 'HIGH', file: 'b.cs', observed: 'o', fix: 'f' }], protections: [] }
    if (L === 'synthesis')
      return scenario.emptySynth
        ? { counts: { critical: 0, high: 1, medium: 1, low: 0 }, groups: [] }
        : {
        counts: { critical: 0, high: 1, medium: 1, low: 0 },
        groups: [
          { files: ['b.cs'], maxSeverity: 'HIGH', findings: [{ id: 'SEC-C1', severity: 'HIGH', description: 'd', fix_instructions: 'fi' }] },
          { files: ['c.cs'], maxSeverity: 'MEDIUM', findings: [{ id: 'DC-1', severity: 'MEDIUM', description: 'd', fix_instructions: 'fi' }] },
        ],
      }
    if (/^triage:/.test(L)) {
      const file = L.slice(7)
      const sev = file === 'b.cs' ? 'HIGH' : 'MEDIUM'
      const id = file === 'b.cs' ? 'SEC-C1' : 'DC-1'
      return { files: [file], maxSeverity: sev, findings: [{ id, severity: sev, status: 'verified', description: 'd', fix_instructions: 'fi' }] }
    }
    if (/^fix:/.test(L)) return { applied: true, filesChanged: ['b.cs'], unfixedFindingIds: [] }
    if (/^gate:/.test(L)) {
      const g = L.slice(5)
      // scenario.gateResult lets a test return a malformed answer (e.g. a non-boolean `passed`),
      // which is what the fail-closed `passed !== true` predicates have to survive.
      if (scenario.gateResult && scenario.gateResult[g]) return scenario.gateResult[g]
      const passed = !(scenario.failGate && scenario.failGate === g)
      return { gate: g, passed, fixesApplied: false, output: 'ok' }
    }
    if (L === 'criteria-reverify')
      return { results: [], allPassed: scenario.reverifyAllPassed === undefined ? true : scenario.reverifyAllPassed, checkboxesTicked: false }
    if (L === 'branch-hygiene') return { stripped: true, cleanDiff: true, offendingPaths: [] }
    throw new Error(`unstubbed agent label: ${L}`)
  }

  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const result = await makeRunner()(agent, parallel, () => {}, (m) => logs.push(m), () => {}, scenario.args, { total: null }, () => {})
  return { result, calls, logs, maxConcurrentReviewers }
}

let passPrompt = ''

function assert(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `   <-- ${extra || ''}`}`)
  if (!cond) process.exitCode = 1
}

;(async () => {
  const baseArgs = { plan: '.claude/ai/plan-2026-08-10-x.md', mode: 'delegate' }

  console.log('--- scenario 1: all green ---')
  const s1 = await run({ args: baseArgs })
  assert('every agent call pins an effort', s1.calls.every((c) => !!c.effort), JSON.stringify(s1.calls.filter((c) => !c.effort)))
  assert('phase reviewers ran concurrently (HIGH phase)', s1.maxConcurrentReviewers === 2, `max=${s1.maxConcurrentReviewers}`)
  assert('one merged fixer per phase, not one per reviewer', s1.calls.filter((c) => /review-fix$/.test(c.label || '')).length === 2)
  assert('triage fanned out per group', s1.calls.filter((c) => /^triage:/.test(c.label || '')).length === 2)
  assert('initial pass is the only high-effort role', s1.calls.filter((c) => c.effort === 'high').every((c) => /:(initial|spec_tests)$/.test(c.label)))
  assert('test gate uses the test-runner agent', s1.calls.some((c) => c.label === 'gate:test' && c.agentType === 'test-runner'))
  assert('all four gates ran', ['sync', 'build', 'test', 'qa'].every((g) => s1.calls.some((c) => c.label === `gate:${g}`)))
  assert('readyForPr = true', s1.result.readyForPr === true, JSON.stringify(s1.result.readyForPr))
  assert('issue prefix parsed', s1.result.issue === 'PROJ-1234')
  assert('reviewFix surfaced per phase', s1.result.phaseResults.every((p) => p.reviewFix && p.reviewFix.applied === true))
  assert('per-reviewer fixApplied mirrors merged fixer', s1.result.phaseResults[1].reviews.every((r) => r.fixApplied === true))
  assert('manual checklist preserved', s1.result.manualChecklist.length === 1)

  console.log('--- scenario 2: one triage agent dies (HIGH group) ---')
  const s2 = await run({ args: baseArgs, nullFor: (L) => L === 'triage:b.cs' })
  assert('untriaged HIGH group recorded in unappliedFixes', (s2.result.unappliedFixes || []).some((u) => u.maxSeverity === 'HIGH' && /never verified/.test(u.reason)))
  assert('surviving group still fixed', s2.calls.some((c) => /^fix:/.test(c.label || '')))
  assert('readyForPr blocked', s2.result.readyForPr === false)
  assert('blockingUnappliedFixes names it', (s2.result.blockingUnappliedFixes || []).length === 1)

  console.log('--- scenario 3: ALL triage agents die ---')
  const s3 = await run({ args: baseArgs, nullFor: (L) => /^triage:/.test(L) })
  assert('reviewIncomplete set', !!s3.result.reviewIncomplete, JSON.stringify(s3.result.reviewIncomplete))
  assert('no fixes attempted', !s3.calls.some((c) => /^fix:/.test(c.label || '')))
  assert('readyForPr blocked', s3.result.readyForPr === false)
  assert('gates still ran', s3.calls.some((c) => c.label === 'gate:build'))

  console.log('--- scenario 4: build gate fails -> test/qa skipped ---')
  const s4 = await run({ args: baseArgs, failGate: 'build' })
  assert('test gate skipped', !s4.calls.some((c) => c.label === 'gate:test'))
  assert('qa gate skipped', !s4.calls.some((c) => c.label === 'gate:qa'))
  assert('readyForPr blocked', s4.result.readyForPr === false)
  assert('short-circuit logged', s4.logs.some((m) => /Build gate did not pass/.test(m)))

  console.log('--- scenario 5: a phase reviewer dies ---')
  const s5 = await run({ args: baseArgs, nullFor: (L) => L === 'phase2:hardening_review' })
  assert('dead reviewer recorded with findings=null', s5.result.phaseResults[1].reviews.some((r) => r.reviewer === 'hardening_review' && r.findings === null))
  assert('surviving reviewer findings still fixed', s5.calls.some((c) => c.label === 'phase2:review-fix'))
  assert('run still completes', s5.result.readyForPr === true)

  console.log('--- scenario 6: expand mode mutates nothing ---')
  const s6 = await run({ args: { plan: baseArgs.plan, mode: 'expand' } })
  assert(
    'only load-profile + parse ran',
    s6.calls.length === 2 && s6.calls.map((c) => c.label).join(',') === 'load-profile,parse-plan',
    s6.calls.map((c) => c.label).join(',')
  )
  assert('expand returns the roster', Array.isArray(s6.result.board) && s6.result.phases.length === 2)

  console.log('--- scenario 7: toolchain test_cmd override derives --no-build ---')
  const s7 = await run({ args: Object.assign({}, baseArgs, { toolchain: { test_cmd: 'dotnet test MySln.sln --filter "X"' } }) })
  assert('run completed with override', s7.result.readyForPr === true)

  console.log('--- scenario 7b: setup builds, and the fast build has a recovery path ---')
  // A fast inner-loop build often assumes generated/derived sources the FULL build produces, so a
  // worktree that was only dependency-restored can fail the first implement pass on files it never
  // wrote. Setup must therefore build, and the pass prompt must carry the recovery step.
  const wfSrc = fs.readFileSync(F, 'utf8')
  const setupBlocks = wfSrc.match(/7\. Prepare dependencies[^\n]*/g) || []
  assert('both setup prompts exist', setupBlocks.length === 2, `found ${setupBlocks.length}`)
  assert(
    'both setup prompts build, not just restore',
    setupBlocks.every((b) => /BUILD IS REQUIRED/.test(b) && /build_verify_cmd/.test(b))
  )
  assert(
    'pass prompt carries the generated-source recovery step',
    /MISSING GENERATED OR DERIVED SOURCES/.test(wfSrc) && /Never hand-write or stub a generated file/.test(wfSrc)
  )
  assert('the recovery step is conditional on a distinct fast build', /hasFastBuild\(\)/.test(wfSrc))
  assert('no stack-specific command leaked into the script', !/dotnet |npm run |cargo |pytest/.test(wfSrc))

  console.log('--- scenario 8: EVERY gate agent dies (the old fail-open) ---')
  const s8 = await run({ args: baseArgs, nullFor: (L) => /^gate:/.test(L) })
  const g8 = s8.result.gates || []
  assert('readyForPr BLOCKED (was true before the fix)', s8.result.readyForPr === false, JSON.stringify(s8.result.readyForPr))
  assert('nothing dropped: every gate in the sequence is recorded', g8.length === 4, `got ${g8.length}`)
  assert('no gate reads as passed', g8.every((g) => g.passed === false))
  assert('the dead sync gate is marked agentDied', g8[0].gate === 'sync' && g8[0].agentDied === true)
  assert('sync death short-circuits the rest as skipped', g8.slice(1).every((g) => g.skipped === true && !g.agentDied))
  assert('only sync was actually invoked', s8.calls.filter((c) => /^gate:/.test(c.label || '')).length === 1)

  console.log('--- scenario 9: only the TEST gate agent dies (mid-sequence) ---')
  const s9 = await run({ args: baseArgs, nullFor: (L) => L === 'gate:test' })
  assert('all four gates present', (s9.result.gates || []).length === 4)
  assert('qa still ran after the dead test gate', s9.calls.some((c) => c.label === 'gate:qa'))
  assert('readyForPr BLOCKED', s9.result.readyForPr === false)
  assert('failed gate named in the log', s9.logs.some((m) => /Gate\(s\) not green: test/.test(m)))

  console.log('--- scenario 10: BUILD gate agent dies -> short-circuit like a build failure ---')
  const s10 = await run({ args: baseArgs, nullFor: (L) => L === 'gate:build' })
  assert('test gate not invoked', !s10.calls.some((c) => c.label === 'gate:test'))
  assert('qa gate not invoked', !s10.calls.some((c) => c.label === 'gate:qa'))
  assert('readyForPr BLOCKED', s10.result.readyForPr === false)
  assert('short-circuit log mentions the dead agent', s10.logs.some((m) => /Build gate did not pass .*agent died/.test(m)))

  console.log('--- scenario 11: skipped gates are RECORDED, not dropped ---')
  // A caller must be able to tell "test failed" from "test never ran" from "test was skipped
  // because build failed" — they need different follow-up. Dropping them loses that.
  const s11 = await run({ args: baseArgs, failGate: 'build' })
  const g11 = s11.result.gates || []
  assert('all four gates present in the result', g11.length === 4, `got ${g11.length}: ${g11.map((g) => g.gate).join(',')}`)
  assert('test+qa marked skipped with a reason', ['test', 'qa'].every((n) => {
    const e = g11.find((g) => g.gate === n)
    return e && e.skipped === true && e.passed === false && /build gate did not pass/.test(e.output || '')
  }))
  assert('skipped gates are not agentDied', g11.filter((g) => g.skipped).every((g) => !g.agentDied))
  assert('readyForPr BLOCKED', s11.result.readyForPr === false)

  console.log('--- scenario 12: non-boolean gate `passed` fails CLOSED ---')
  const s12 = await run({ args: baseArgs, gateResult: { build: { gate: 'build', output: 'malformed — no passed field' } } })
  assert('short-circuits on a non-boolean passed', !s12.calls.some((c) => c.label === 'gate:test'))
  assert('readyForPr BLOCKED', s12.result.readyForPr === false)

  console.log('--- scenario 12b: a broken phase STOPS the chain, and the skipped phases are recorded ---')
  // Phase N+1 is specified against phase N's committed work, so continuing past a phase whose pass
  // chain died spends a whole run building on and reviewing damage. The subtlety is the bookkeeping:
  // criteriaOk is an `.every()` over phaseResults, so the phases that never ran have to be PUSHED as
  // failures. Dropping them would shrink the list the check runs over — the same shape that once let
  // a run with no gate at all report itself ready.
  const s12b = await run({ args: baseArgs, nullFor: (L) => L === 'phase1:initial' })
  assert('phase 1 is recorded incomplete', s12b.result.phaseResults[0].complete === false)
  assert(
    'phase 2 never ran',
    !s12b.calls.some((c) => /^phase2:/.test(c.label || '')),
    s12b.calls.filter((c) => /^phase2:/.test(c.label || '')).map((c) => c.label).join(',')
  )
  assert(
    'but phase 2 IS recorded, as skipped and not criteria-met',
    s12b.result.phaseResults.length === 2 &&
      s12b.result.phaseResults[1].complete === false &&
      s12b.result.phaseResults[1].criteriaMet === false &&
      /did not complete/.test(s12b.result.phaseResults[1].skippedAfterFailure || ''),
    `${s12b.result.phaseResults.length} phase result(s)`
  )
  assert('readyForPr BLOCKED', s12b.result.readyForPr === false)
  assert(
    'and the log names what was skipped',
    s12b.logs.some((m) => /did not complete — stopping the phase chain/.test(m) && /Service/.test(m)),
    s12b.logs.filter((m) => /stopping the phase chain/.test(m)).join(' | ')
  )

  console.log('--- scenario 12c: a ZERO-phase plan cannot report itself ready ---')
  // PLAN_SCHEMA requires only {valid, phases}; the no-empty-plan rule lives in the parse PROMPT, so
  // it is agent-enforced rather than structural. A parse agent answering `{valid: true, phases: []}`
  // therefore leaves phaseResults empty, and an unguarded `.every()` over an empty list is TRUE —
  // a run that implemented nothing reporting itself ready.
  const s12c = await run({ args: baseArgs, phasesOverride: [] })
  assert('no phase agent ran', !s12c.calls.some((c) => /^phase\d+:/.test(c.label || '')))
  assert('readyForPr BLOCKED, not vacuously true', s12c.result.readyForPr === false, JSON.stringify(s12c.result.readyForPr))

  console.log('--- scenario 12d: the re-verifier is not asked to grade phases that never ran ---')
  // `phases` still holds every declared phase after an early stop, and it is `phases` that feeds the
  // re-verifier. Handing it the full list asks it to grade code that was never written — and because
  // its cheap short-circuit keys on a `criteria-verified` commit that a stopped run never made, it
  // pays for a full test suite to do it.
  let reverifyPrompt = ''
  const s12d = await run({
    args: baseArgs,
    nullFor: (L) => L === 'phase1:initial',
    // Phase 2 MUST carry manual criteria here or the checklist assertion below is vacuous — the
    // default fixture gives it none, so the filter would be indistinguishable from no filter.
    phasesOverride: [
      { name: 'Datalayer', complexity: 'MEDIUM', spec: 's1', automatedCriteria: ['dotnet build'], manualCriteria: ['eyeball the UI'] },
      { name: 'Service', complexity: 'HIGH', spec: 's2', automatedCriteria: ['dotnet test'], manualCriteria: ['click through the service'] },
    ],
    // The wording branch only exists when re-verification does NOT pass, which is the realistic
    // outcome after a stopped chain: criteria for un-written code cannot pass.
    reverifyAllPassed: false,
    capturePrompt: (L, p) => { if (L === 'criteria-reverify') reverifyPrompt = p },
  })
  assert('the stopped phase is still graded', /Datalayer/.test(reverifyPrompt))
  assert(
    'but the phase that never ran is NOT',
    !/Service/.test(reverifyPrompt),
    reverifyPrompt.split('\n').filter((l) => /Service/.test(l)).join(' | ')
  )
  assert(
    'and the log does not call it a REGRESSION',
    !s12d.logs.some((m) => /REGRESSION/.test(m)) && s12d.logs.some((m) => /this is not a regression/.test(m)),
    s12d.logs.filter((m) => /re-verification/.test(m)).join(' | ')
  )
  assert(
    'no manual checklist item for a phase that was never written',
    !(s12d.result.manualChecklist || []).some((x) => x.phase === 'Service'),
    JSON.stringify(s12d.result.manualChecklist)
  )

  console.log('--- scenario 13: dead PER-PHASE fixer blocks readyForPr ---')
  // Was a fail-open: `complete` covers only the pass chain, and the board's unappliedFixes gate
  // had no per-phase analogue, so a dead phase fixer was logged and then forgotten.
  const s13 = await run({ args: baseArgs, nullFor: (L) => /^phase\d+:review-fix$/.test(L) })
  const urf13 = s13.result.unappliedReviewFixes || []
  assert('unapplied reviewer findings recorded', urf13.length === 2, `got ${urf13.length}`)
  assert('severity taken from the findings', urf13.every((u) => u.maxSeverity === 'HIGH'))
  assert('reason names the phase', urf13.every((u) => /phase "/.test(u.reason)))
  assert('folded into blockingUnappliedFixes', (s13.result.blockingUnappliedFixes || []).length >= 2)
  assert('readyForPr BLOCKED', s13.result.readyForPr === false)

  console.log('--- scenario 14: PARTIAL per-phase fix (unfixedFindingIds) blocks too ---')
  const s14 = await run({
    args: baseArgs,
    phaseFixResult: { applied: true, filesChanged: ['a.cs'], unfixedFindingIds: ['HARD-1'], notes: 'could not do HARD-1' },
  })
  const urf14 = s14.result.unappliedReviewFixes || []
  assert('partial success recorded despite applied=true', urf14.length >= 1)
  assert('only the unfixed id is listed', urf14.every((u) => u.findingIds.join(',') === 'HARD-1'))
  assert(
    'hardening_review fixApplied=false, spec_review stays true',
    s14.result.phaseResults[1].reviews.find((r) => r.reviewer === 'hardening_review').fixApplied === false &&
      s14.result.phaseResults[1].reviews.find((r) => r.reviewer === 'spec_review').fixApplied === true
  )
  assert('readyForPr BLOCKED', s14.result.readyForPr === false)

  console.log('--- scenario 15: MEDIUM-only per-phase miss does NOT block ---')
  const s15 = await run({ args: baseArgs, reviewSeverity: 'MEDIUM', nullFor: (L) => /^phase\d+:review-fix$/.test(L) })
  assert('recorded in unappliedReviewFixes', (s15.result.unappliedReviewFixes || []).length === 2)
  assert('but NOT blocking', (s15.result.blockingUnappliedFixes || []).length === 0)
  assert('readyForPr still true', s15.result.readyForPr === true)

  console.log('--- scenario 16: zero-group synthesis with real findings fails CLOSED ---')
  const s16 = await run({ args: baseArgs, emptySynth: true })
  assert('reviewIncomplete set', /synthesis produced no groups/.test(s16.result.reviewIncomplete || ''))
  assert('no triage agent spawned', !s16.calls.some((c) => /^triage:/.test(c.label || '')))
  assert('no fix agent spawned', !s16.calls.some((c) => /^fix:/.test(c.label || '')))
  assert('gates still ran', s16.calls.some((c) => c.label === 'gate:build'))
  assert('readyForPr BLOCKED', s16.result.readyForPr === false)

  console.log('--- scenario 18: a profile with NO speed keys falls back cleanly ---')
  const s18 = await run({
    args: baseArgs,
    profile: { toolchain: { build_verify_cmd: 'fake build', test_cmd: 'fake test-all', format_cmd: 'fake fmt', lint_cmd: 'fake fmt --check' } },
    capturePrompt: (L, p) => { if (/^phase1:initial$/.test(L)) passPrompt = p },
  })
  assert('run completes without the optional keys', s18.result.readyForPr === true)
  assert('pass prompt falls back to the full build', /fake build/.test(passPrompt) && !/--fast/.test(passPrompt))
  assert('pass prompt still demands a scoped run in prose', /scope `fake test-all` down to the affected/.test(passPrompt))
  assert('no recovery step when there is no distinct fast build', !/MISSING GENERATED OR DERIVED SOURCES/.test(passPrompt))

  console.log('--- scenario 16b: phase agents diff against THEIR phase anchor SHA ---')
  // They used to be handed the CUMULATIVE diff and told to narrow by eye. Measured on a real branch
  // upstream, that is 31 files / 2608 insertions where the phase itself is 18 / 1758 — every phase
  // agent re-reading every earlier phase.
  const scoped = []
  const boardForContrast = []
  await run({
    args: baseArgs,
    capturePrompt: (L, p) => {
      if (/^phase\d+:(edge_cases|spec_review|hardening_review)$/.test(L)) scoped.push([L, p])
      if (/^board:/.test(L)) boardForContrast.push([L, p])
    },
  })
  // 2 refinement passes + 3 reviewer calls: phase 1 is MEDIUM so it has no hardening_review.
  assert(
    'both refinement passes and all three reviewer calls captured',
    scoped.length === 5,
    scoped.map(([L]) => L).join(',')
  )
  // Asserting the exact SHA per phase proves three things at once: the diff is scoped, it is scoped
  // to the RIGHT phase, and the `initial` pass's SHA was not overwritten by the later `edge_cases`
  // pass, which reports a different fake SHA.
  const anchorOf = (L) => FAKE_SHA[L.match(/^phase(\d+)/)[1] + ':initial']
  assert(
    'each diffs against its own phase anchor, not the cumulative range',
    scoped.every(([L, p]) => p.includes(`git diff ${anchorOf(L)}^...HEAD`) && !p.includes('git diff origin/main...HEAD')),
    scoped.filter(([L, p]) => !p.includes(`git diff ${anchorOf(L)}^...HEAD`)).map(([L]) => L).join(',')
  )
  assert(
    'and is told not to re-derive it by grepping',
    scoped.every(([, p]) => /do not re-derive it by grepping/.test(p) && !/PHASE_START/.test(p)),
    scoped.filter(([, p]) => /PHASE_START/.test(p)).map(([L]) => L).join(',')
  )
  // The contrast matters: scoping is right for a PHASE agent and WRONG for the board, which reviews
  // the whole change before a PR. A "consistency fix" that scoped the board too would be a
  // regression. The board's own count is asserted once, authoritatively, in scenario 17.
  assert(
    'the board still takes the cumulative diff, unscoped',
    boardForContrast.length > 0 &&
      boardForContrast.every(([, p]) => /git diff origin\/main\.\.\.HEAD/.test(p) && !/PHASE_START|\^\.\.\.HEAD/.test(p)),
    boardForContrast.filter(([, p]) => /PHASE_START|\^\.\.\.HEAD/.test(p)).map(([L]) => L).join(',') ||
      `${boardForContrast.length} board prompts captured`
  )

  console.log('--- scenario 16c: a pass that reports no SHA falls back, and says a trailer is missing ---')
  // The anchor SHA comes from the pass AGENT. Before it existed both prompts re-derived it with
  // `git log --grep='^Implplan: P<n>/' | tail -1`, which fails SILENTLY when the agent omits the
  // MANDATORY trailer: PHASE_START lands on the phase's SECOND commit, so the phase's whole initial
  // implementation drops out of the reviewed diff while PHASE_START stays non-empty, so no fallback
  // fires. The fallback path must therefore carry BOTH guards, not just the empty-string one.
  const noSha = []
  await run({
    args: baseArgs,
    noCommitSha: true,
    capturePrompt: (L, p) => {
      if (/^phase\d+:(edge_cases|spec_review|hardening_review)$/.test(L)) noSha.push([L, p])
    },
  })
  assert('same five phase agents captured', noSha.length === 5, noSha.map(([L]) => L).join(','))
  assert(
    'falls back to the trailer grep, oldest-match first',
    noSha.every(([, p]) => /PHASE_START=\$\(git log --format=%H --grep='\^Implplan: P\d+\/' \S+\.\.HEAD \| tail -1\)/.test(p)),
    noSha.filter(([, p]) => !/\| tail -1\)/.test(p)).map(([L]) => L).join(',')
  )
  assert(
    'the grep on the PHASE_START line names the agent own phase',
    noSha.every(([L, p]) =>
      new RegExp("PHASE_START=\\$\\(git log --format=%H --grep='\\^Implplan: P" + L.match(/^phase(\d+)/)[1] + "/'").test(p)
    ),
    noSha.map(([L]) => L).join(',')
  )
  assert(
    'the empty case actually falls back, as a command not a phrase',
    noSha.every(([, p]) => /if \[ -n "\$PHASE_START" \]; then git diff \$PHASE_START\^\.\.\.HEAD; else git diff origin\/main\.\.\.HEAD; fi/.test(p))
  )
  assert(
    'and a missing trailer is caught by a commit count, the silent case',
    noSha.every(([, p]) => /has committed \d+ pass\(es\)/.test(p) && /FEWER than \d+ commits/.test(p) && /MANDATORY Implplan trailer is missing/.test(p)),
    noSha.filter(([, p]) => !/MANDATORY Implplan trailer is missing/.test(p)).map(([L]) => L).join(',')
  )

  console.log('--- scenario 16d: the QA gate is write-capable, so it gets the conventions ---')
  // It formats, cleans leftovers and fixes warnings, committing as it goes, and it is the LAST agent
  // to touch code before finalize — but it received no conventions, so nothing stopped its hygiene
  // checklist undoing something a rule requires. The other three gates do not edit logic.
  const gatePrompts = {}
  await run({ args: baseArgs, capturePrompt: (L, p) => { if (/^gate:/.test(L)) gatePrompts[L.slice(5)] = p } })
  assert('all four gates captured', ['sync', 'build', 'test', 'qa'].every((g) => gatePrompts[g]), Object.keys(gatePrompts).join(','))
  assert(
    'the QA gate is pointed at the conventions doc',
    /READ docs\/conventions\.md IN FULL/.test(gatePrompts.qa) && /OUTRANKS any cleanup on your checklist/.test(gatePrompts.qa)
  )
  assert(
    'but not the arch doc, which is per-finding context it has no findings for',
    !/docs\/architecture\.md/.test(gatePrompts.qa)
  )
  assert(
    'and it must build before deleting an import a text search calls unused',
    /NEVER delete an import because a text search found no second use/.test(gatePrompts.qa) &&
      /restore it if the build breaks/.test(gatePrompts.qa)
  )
  assert(
    'the read-only gates stay conventionless',
    ['sync', 'build', 'test'].every((g) => !/Repository conventions/.test(gatePrompts[g])),
    ['sync', 'build', 'test'].filter((g) => /Repository conventions/.test(gatePrompts[g])).join(',')
  )

  console.log('--- scenario 17: EVERY board reviewer gets the conventions ---')
  // A subset used to. That is a false-finding generator: rules in the adopter's conventions doc
  // exist to stop a reviewer raising something, and the reviewer they are aimed at was excluded.
  const boardPrompts = []
  const phaseReviewerPrompts = []
  await run({
    args: baseArgs,
    capturePrompt: (L, p) => {
      if (/^board:/.test(L)) boardPrompts.push([L, p])
      if (/^phase\d+:(spec_review|hardening_review)$/.test(L)) phaseReviewerPrompts.push([L, p])
    },
  })
  assert('the whole board ran', boardPrompts.length === 12, `got ${boardPrompts.length}`)
  assert(
    'every reviewer is pointed at the conventions doc',
    boardPrompts.every(([, p]) => /READ docs\/conventions\.md IN FULL/.test(p)),
    boardPrompts.filter(([, p]) => !/conventions\.md IN FULL/.test(p)).map(([L]) => L).join(',')
  )
  // The whole guardrail body, not a prefix: proving 6 words let the rule be replaced with its
  // OPPOSITE ("SHOULD FREELY ADD throw-on-missing-configuration") with the suite still green.
  const GUARDRAIL_BODY = /GUARDRAILS: a reviewer or fixer pass must never add throw-on-missing-configuration/
  assert(
    'including the ones a subset would exclude',
    ['dead-code', 'error-message-quality', 'test-economy', 'maintainability-design'].every((n) => {
      const e = boardPrompts.find(([L]) => L === `board:${n}`)
      return e && GUARDRAIL_BODY.test(e[1])
    }),
    ['dead-code', 'error-message-quality', 'test-economy', 'maintainability-design']
      .filter((n) => {
        const e = boardPrompts.find(([L]) => L === `board:${n}`)
        return !e || !GUARDRAIL_BODY.test(e[1])
      })
      .join(',')
  )
  assert(
    'every reviewer is told the rule beats a contradicting finding',
    boardPrompts.every(([, p]) => /is a FALSE finding, and the rule wins/.test(p))
  )
  assert(
    'reviewers are not told to read the arch doc up front, nor to run tests',
    boardPrompts.every(([, p]) => /only when a specific finding depends on it/.test(p) && !/test-runner discipline/.test(p))
  )
  // The PER-PHASE reviewers are read-only too, and used to get the implementer block verbatim: told
  // to read the arch doc "before changing code" and to run the tests, three lines under "READ-ONLY -
  // do not modify any file", while missing the two rules written for reviewers (a rule beats a
  // finding that contradicts it; judge against the surrounding patterns). Same variant as the board.
  assert(
    'phase reviewers get the reviewer variant, not the implementer block',
    phaseReviewerPrompts.length > 0 &&
      phaseReviewerPrompts.every(
        ([, p]) =>
          /is a FALSE finding, and the rule wins/.test(p) &&
          /only when a specific finding depends on it/.test(p) &&
          GUARDRAIL_BODY.test(p) &&
          !/test-runner discipline/.test(p) &&
          !/BEFORE writing any code/.test(p)
      ),
    phaseReviewerPrompts.filter(([, p]) => /BEFORE writing any code/.test(p)).map(([L]) => L).join(',') ||
      `${phaseReviewerPrompts.length} captured`
  )

  // --- scenario 26: no charter composes its own diff command --------------------------------
  // Charters are read verbatim by a board reviewer (boardPrompt names reviewer-<name>.md as the
  // source of truth), and boardPrompt ALREADY supplies the fully-resolved `<base>...HEAD` commands.
  // Every charter that also embedded its own copy got it wrong twice: first as
  // `git diff {default_branch}` (not a valid revision), then as `git diff <base>...HEAD`, which is
  // WORSE -- bash reads `<base` as a stdin redirect and `>...HEAD` as a stdout redirect, so
  // `git diff` runs BARE. With no file named `base` that is loud but never mentions git; WITH one it
  // exits 0, prints nothing, and the empty diff routes the reviewer into the charter's own
  // "no files changed -- nothing to review", silently skipping a whole specialist review. The
  // placeholder at least failed loudly every time. So the charters embed no command at all now and
  // defer, the way reviewer-plan-conformance always did.
  console.log('--- scenario 26: charters compose no diff command of their own ---')
  const charterDir = path.join(__dirname, '..', 'implement-plan-assets', 'reviewers')
  const charters = fs
    .readdirSync(charterDir)
    .filter((f) => /^reviewer-.*\.md$/.test(f))
    .map((f) => [f, fs.readFileSync(path.join(charterDir, f), 'utf8')])
  // The floor is 12 against a true count of 17: loose enough that an adopter dropping a charter or
  // two does not fail the suite, tight enough that a mass rename off the `reviewer-*.md` prefix
  // trips it. Without it an empty list makes every assertion below vacuously true -- the
  // `.every()`-over-empty shape this file has already shipped three times.
  assert('charter files were found to check', charters.length >= 12, `found ${charters.length}`)
  // Per-LINE, not per-file. A per-file `.test()` only asks whether some correct form appears
  // somewhere, so a charter keeping its good lines and gaining one stray `git diff main` would pass.
  const cmdLines = ([, s]) => s.split('\n').filter((l) => /^\s*git\s/.test(l))
  const withCmds = charters.filter((c) => cmdLines(c).length)
  assert(
    'no charter embeds a runnable git command',
    withCmds.length === 0,
    withCmds.map(([f, s]) => `${f}: ${cmdLines([f, s])[0].trim()}`).join(' | ')
  )
  // The positive half, so the fix cannot be "delete the diff step entirely". Case-insensitive: some
  // charters open the sentence with "The invoking tool provides ...".
  const notDeferring = charters.filter(([, s]) => !/invoking tool provides/i.test(s))
  assert(
    'every charter defers its diff commands to the invoking tool',
    notDeferring.length === 0,
    notDeferring.map(([f]) => f).join(',')
  )

  // --- scenario 27: every sub-agent the commands name is actually shipped ---------------------
  // /create-plan spawns codebase-locator, codebase-analyzer, codebase-pattern-finder and
  // plan-reviewer. The bundle shipped only the last two, so an adopter installing it got a
  // command that spawns three agents their repo has never heard of — and Claude Code falls back
  // to a general-purpose agent rather than erroring, so the failure is quiet: the research phase
  // still "works", just without the focused agents the command was written around.
  console.log('--- scenario 27: commands reference only agents the bundle ships ---')
  const claudeDir = path.join(__dirname, '..', '..')
  const agentDir = path.join(claudeDir, 'agents')
  const shipped = fs
    .readdirSync(agentDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
  const docFiles = ['commands/create-plan.md', 'commands/implement-plan.md', 'skills/implement-plan-with-dynamic-workflow/SKILL.md']
  const docText = docFiles
    .map((rel) => fs.readFileSync(path.join(claudeDir, rel), 'utf8'))
    .join('\n')
  // A reference is a bold or backticked hyphenated lowercase name that either sits on a line
  // mentioning an agent, or belongs to one of the sub-agent families this bundle defines.
  // Matched delimiters only. The earlier `(?:\*\*|`)...(?:\*\*|`)` form accepted a mismatched pair
  // such as `**name``, and the orphan check below used a bare substring search — so the two
  // directions did not agree on what counted as a reference. One regex, used for both, now does.
  const REF = /\*\*([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\*\*|`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g
  const named = new Set()
  for (const line of docText.split('\n')) {
    for (const m of line.matchAll(REF)) {
      const name = m[1] || m[2]
      const family = /^codebase-|-reviewer$|-runner$|-researcher$/.test(name)
      if (family || /agent/i.test(line)) named.add(name)
    }
  }
  assert('agent references were found to check', named.size >= 4, `found ${named.size}: ${[...named].join(',')}`)
  const missing = [...named].filter((n) => !shipped.includes(n))
  assert('every agent the commands name is shipped', missing.length === 0, missing.join(','))
  // The other direction, so the bundle does not accumulate agents nothing invokes.
  // Same `named` set as the positive check, so both directions share one definition. A bare
  // docText.includes() was satisfied by any unformatted mention, including prose.
  const orphans = shipped.filter((a) => !named.has(a))
  assert('every shipped agent is referenced by a command or the skill', orphans.length === 0, orphans.join(','))

  // --- scenario 28: the two fixer rules reach every fixer, and no reviewer ------------------
  // Ported from the retrospects of the repo this bundle came from. Each pin is a token from the
  // ACTIONABLE clause of its rule, not its label: replacing a rule body with "see notes" must fail.
  console.log('--- scenario 28: fix-propagation and fix-scope reach the fixers only ---')
  const fixerPrompts = []
  const reviewerPrompts28 = []
  await run({
    args: baseArgs,
    capturePrompt: (L, p) => {
      if (/^phase\d+:review-fix$/.test(L) || /^fix:/.test(L)) fixerPrompts.push([L, p])
      if (/^board:/.test(L) || /^phase\d+:(spec_review|hardening_review)$/.test(L)) reviewerPrompts28.push([L, p])
    },
  })
  const FIXER_PINS = [
    ['FIX PROPAGATION fixes every occurrence', /fix ALL occurrences in the same commit/],
    ['FIX PROPAGATION covers moved members', /grep the WHOLE repo \(docs, code comments, test names/],
    ['FIX PROPAGATION deletes zero-reference members', /members left with zero references and delete them/],
    ['FIX PROPAGATION bans hard-coded list counts', /Never leave a hard-coded count of an enumerated list/],
    ['FIX SCOPE bans unplanned rejections', /must not introduce a rejection, cap, limit or status code the plan does not list/],
    ['FIX SCOPE requires a refusing sibling', /cite by file:line the closest sibling that already refuses the same case/],
    ['FIX SCOPE defers shared-helper changes', /any such caller turns the fix into a deferral/],
  ]
  assert('both fixer kinds ran', fixerPrompts.some(([L]) => /review-fix$/.test(L)) && fixerPrompts.some(([L]) => /^fix:/.test(L)),
    fixerPrompts.map(([L]) => L).join(','))
  for (const [name, re] of FIXER_PINS) {
    assert(`${name} — every fixer`, fixerPrompts.length > 0 && fixerPrompts.every(([, p]) => re.test(p)),
      fixerPrompts.filter(([, p]) => !re.test(p)).map(([L]) => L).join(','))
  }
  // Fixer-only: a reviewer told "do not reject" stops REPORTING rejections, which is the opposite
  // of what the board is for.
  assert('no reviewer gets the fixer rules', reviewerPrompts28.length > 0 &&
    reviewerPrompts28.every(([, p]) => !/FIX SCOPE:|FIX PROPAGATION:/.test(p)),
    reviewerPrompts28.filter(([, p]) => /FIX SCOPE:|FIX PROPAGATION:/.test(p)).map(([L]) => L).join(','))

  // --- scenario 29: the conventions template ships the ported code rules ---------------------
  console.log('--- scenario 29: the conventions template carries the rules worth keeping ---')
  const template = fs.readFileSync(path.join(__dirname, '..', 'implement-plan-assets', 'conventions.template.md'), 'utf8')
  const TEMPLATE_PINS = [
    ['shared-helper blast radius', /enumerate EVERY production call path transitively/],
    ['guards tested per call site', /at each one assert the refusal at BOTH edges of its window/],
    ['sentinels tested either side', /test each at the value, one below and one\s+above/],
    ['null-equals-null lookup case', /include a case where BOTH sides are absent/],
    ['write-back matrix', /give each cell a test or a written reason/],
    ['detached before-snapshots', /holds detached copies,\s+never references the write can mutate/],
    ['update paths from update siblings', /never on the read path of the same class/],
    ['client parse errors name the field', /rethrows a validation error naming the client-facing field/],
    ['validation doc audit: pipeline order', /check each documented status code against the REQUEST\s+PIPELINE ORDER/],
    ['allOf branches checked by hand', /only works when EVERY composed branch permits the new value/],
  ]
  for (const [name, re] of TEMPLATE_PINS) assert(`template: ${name}`, re.test(template))
  // The README's drafting prompt says no rule without evidence; without this carve-out an agent
  // following it either copies all eight rules or deletes all eight. Both are wrong.
  //
  // The README is the BUNDLE's, not the adopter's: three directories up is the bundle root in this
  // repo, but install.sh copies only claude/ into <repo>/.claude/, so after install the same path
  // is the adopter's own README. Running the check there failed every adopter's first test run on
  // a file they never wrote. Check it only when the file at that path is recognisably the bundle
  // README (it carries the conventions-drafting prompt); otherwise say so and skip.
  const readmePath = path.join(__dirname, '..', '..', '..', 'README.md')
  const bundleReadme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : ''
  if (/Draft this repository's conventions doc/.test(bundleReadme)) {
    assert('drafting prompt keeps a template rule only where its construct exists',
      /Keep one only when\s+this repo has the construct it guards/.test(bundleReadme) &&
        /Drop every rule whose construct is absent/.test(bundleReadme))
  } else {
    console.log('SKIP  drafting prompt keeps a template rule only where its construct exists (bundle README not present — installed copy)')
  }

  // --- scenario 30: the ported charter checks sit inside ## Covers -----------------------------
  // A rule under "Does NOT Cover" is an instruction to IGNORE it, so the section matters.
  console.log('--- scenario 30: ported charter checks are in scope, not out of it ---')
  const coversOf = (name) => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'implement-plan-assets', 'reviewers', name), 'utf8')
    const m = text.match(/## Covers\n([\s\S]*?)\n## Does NOT Cover/)
    return m ? m[1] : ''
  }
  const CHARTER_PINS = [
    ['reviewer-coverage-critical.md', 'reachable-code coverage exclusion', /An exclusion on code a\s+caller CAN reach is a finding/],
    ['reviewer-observability-diagnostics.md', 'optional diagnostics wired everywhere', /verify the parameter is actually passed at EVERY production call site/],
    ['reviewer-test-integrity.md', 'removed behavior must fail when it returns', /the suite must fail\s+if the removed behavior comes back/],
    ['reviewer-test-integrity.md', 'ordering needs distinct keys', /at\s+least two DISTINCT key values/],
    ['reviewer-test-integrity.md', 'null assertion needs a contrast case', /next to a contrast case expecting non-null/],
  ]
  for (const [file, name, re] of CHARTER_PINS) assert(`${file}: ${name}`, re.test(coversOf(file)))
})()
