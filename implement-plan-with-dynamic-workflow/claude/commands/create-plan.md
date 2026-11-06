# Implementation Plan

You are tasked with creating detailed implementation plans through an interactive, iterative process. You should be skeptical, thorough, and work collaboratively with the user to produce high-quality technical specifications.

**Output**: Implementation plan will be saved to `.claude/ai/plan-YYYY-MM-DD-ISSUE-description.md`

## Required Reading

**IMPORTANT**: before starting any planning work you MUST read this repository's own context, named in `.claude/workflows/implement-plan-assets/repo-profile.json`:

1. `conventionsDoc` - the binding coding rules (test structure, logging, canonical helpers, layering, known pitfalls). A plan that contradicts these is not implementable.
2. `archDoc`, if the profile names one - structure, naming, and existing patterns to follow.

The profile's `toolchain` also gives you the exact build/test/format commands to put in the Automated Verification boxes; never invent them.

## Initial Response

When this command is invoked:

1. **Check if parameters were provided**:

   - If a file path or ticket reference was provided as a parameter, skip the default message
   - Immediately read any provided files FULLY
   - Begin the research process

2. **Determine the issue tracker number (required)**:

   - Every plan must be tied to an issue tracker number (Jira or Linear key, e.g. `PROJ-123`,
     `PROJ-456`)
   - Scan the provided parameters, referenced files, and conversation for an issue key
   - If none can be found, **ask the user for it** (research may continue in parallel, but the
     plan file cannot be written without it):

     ```
     Which issue tracker number (Jira/Linear) does this work belong to? (e.g. PROJ-123)
     ```

   - Validate the key before using it: it must match `<PROJECT>-<number>` (letters/digits +
     a single hyphen, e.g. `PROJ-123`); normalize to uppercase. If the user pastes a URL or
     free text, extract the bare key — confirm rather than guess if it's ambiguous
   - The issue number is stored in the plan frontmatter (`issue:`) and document header, becomes
     part of the plan filename, and is consumed by `/implement-plan-with-dynamic-workflow` to
     prefix all git commits and the PR title (e.g. `PROJ-456: Implement datalayer`) — a
     malformed key would corrupt filenames and commit subjects, which is why the shape check
     matters

3. **If no parameters provided**, respond with:

```
I'll help you create a detailed implementation plan for this repository. Let me start by understanding what we're building.

Please provide:
1. The issue tracker number for this work (Jira/Linear, e.g. PROJ-123)
2. Any relevant context, constraints, or specific requirements
3. Links to related research or previous implementations

I'll analyze this information and work with you to create a comprehensive plan.
```

Then wait for the user's input.

## Process Steps

### Step 1: Context Gathering & Initial Analysis

1. **Read the API overview and all mentioned files immediately and FULLY**:

   - **FIRST**: read the conventions doc named by `conventionsDoc` in the repo profile, and the `archDoc` if one is named
   - Research documents
   - Related implementation plans
   - Any JSON/data files mentioned
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: DO NOT spawn sub-tasks before reading these files yourself in the main context
   - **NEVER** read files partially - if a file is mentioned, read it completely

2. **Spawn initial research tasks to gather context**:
   Before asking the user any questions, use specialized agents to research in parallel:

   - Use the **codebase-locator** agent to find all files related to the task
   - Use the **codebase-analyzer** agent to understand how the current implementation works

   These agents will:

   - Find relevant source files, configs, and tests
   - Trace data flow and key functions
   - Return detailed explanations with file:line references

   **Also search prior art in `.claude/ai/`** (grep by component/feature name): earlier
   `plan-*.md` for the same or sibling components, related `research-*.md`, and any
   `retrospect-*.md` proposal docs. Read matches fully and carry their hazards and
   decisions into this plan — sibling plans often hold hard-won hazards that code
   research cannot surface (e.g. the free-form-discriminator colon escaping that the
   union-links plan missed but the car-links plan caught two days later).

3. **Read all files identified by research tasks**:

   - After research tasks complete, read ALL files they identified as relevant
   - Read them FULLY into the main context
   - This ensures you have complete understanding before proceeding

4. **Analyze and verify understanding**:

   - Cross-reference the requirements with actual code
   - Identify any discrepancies or misunderstandings
   - Note assumptions that need verification
   - Determine true scope based on codebase reality

5. **Present informed understanding and focused questions**:

   ```
   Based on my research of the codebase, I understand we need to [accurate summary].

   I've found that:
   - [Current implementation detail with file:line reference]
   - [Relevant pattern or constraint discovered]
   - [Potential complexity or edge case identified]

   Questions that my research couldn't answer:
   - [Specific technical question that requires human judgment]
   - [Business logic clarification]
   - [Design preference that affects implementation]
   ```

   Only ask questions that you genuinely cannot answer through code investigation.

### Step 2: Research & Discovery

After getting initial clarifications:

1. **If the user corrects any misunderstanding**:

   - DO NOT just accept the correction
   - Spawn new research tasks to verify the correct information
   - Read the specific files/directories they mention
   - Only proceed once you've verified the facts yourself

2. **Create a research todo list** using TodoWrite to track exploration tasks

3. **Spawn parallel sub-tasks for comprehensive research**:

   - Create multiple Task agents to research different aspects concurrently
   - Use the right agent for each type of research:

   **For deeper investigation:**

   - **codebase-locator** - To find more specific files (e.g., "find all files that handle [specific component]")
   - **codebase-analyzer** - To understand implementation details (e.g., "analyze how [system] works")
   - **codebase-pattern-finder** - To find similar features we can model after

   Each agent knows how to:

   - Find the right files and code patterns
   - Identify conventions and patterns to follow
   - Look for integration points and dependencies
   - Return specific file:line references
   - Find tests and examples

4. **Wait for ALL sub-tasks to complete** before proceeding

5. **Present findings and design options**:

   ```
   Based on my research, here's what I found:

   **Current State:**
   - [Key discovery about existing code]
   - [Pattern or convention to follow]

   **Design Options:**
   1. [Option A] - [pros/cons]
   2. [Option B] - [pros/cons]

   **Open Questions:**
   - [Technical uncertainty]
   - [Design decision needed]

   Which approach aligns best with your vision?
   ```

### Step 3: Plan Structure Development

Once aligned on approach:

1. **Create initial plan outline**:

   ```
   Here's my proposed plan structure:

   ## Overview
   [1-2 sentence summary]

   ## Implementation Phases:
   1. [Phase name] (LOW|MEDIUM|HIGH) - [what it accomplishes]
   2. [Phase name] (LOW|MEDIUM|HIGH) - [what it accomplishes]
   3. [Phase name] (LOW|MEDIUM|HIGH) - [what it accomplishes]

   Does this phasing make sense? Should I adjust the order, granularity, or complexity tags?
   ```

2. **Get feedback on structure** before writing details

### Step 4: Detailed Plan Writing

After structure approval:

1. **Gather metadata for the plan document:**
   - Gather relevant metadata from git (commit hash, branch name, repository name, timestamps)
   - Confirm the issue tracker number is known (see "Initial Response" step 2) — if it is
     still missing, STOP and ask the user for it now
   - Filename: `.claude/ai/plan-YYYY-MM-DD-ISSUE-description.md`
     - Format: `plan-YYYY-MM-DD-ISSUE-description.md` where:
       - YYYY-MM-DD is today's date
       - ISSUE is the issue tracker key, uppercased and matching `<PROJECT>-<number>`
         (letters/digits + a single hyphen, e.g. PROJ-123, PROJ-456) — never embed a
         string that doesn't match this pattern in the filename; if what the user gave
         doesn't fit (extra punctuation, a URL, free text), extract or confirm the bare
         key first
       - description is a brief kebab-case description
     - Examples:
       - `plan-2025-10-03-PROJ-456-improve-error-handling.md`
       - `plan-2025-10-03-PROJ-88-add-authentication.md`

2. **Use this template structure with proper metadata:**

````markdown
---
date: [Current date and time with timezone in ISO format]
planner: Claude
issue: "[Issue tracker number, e.g. PROJ-123]"
git_commit: [Current commit hash]
branch: [Current branch name]
repository: [Current repository name]
plan_type: "implementation"
topic: "[Feature/Task Name]"
tags: [implementation, planning, relevant-component-names]
status: draft
last_updated: [Current date in YYYY-MM-DD format]
last_updated_by: Claude
---
# [Feature/Task Name] Implementation Plan

**Date**: [Current date and time with timezone]
**Issue**: [Issue tracker number, e.g. PROJ-123]
**Planner**: Claude
**Git Commit**: [Current commit hash]
**Branch**: [Current branch name]
**Repository**: [Repository name]

## Overview

[Brief description of what we're implementing and why]

## Current State Analysis

[What exists now, what's missing, key constraints discovered]

## Desired End State

[A Specification of the desired end state after this plan is complete, and how to verify it]

### Key Discoveries:

- [Important finding with file:line reference]
- [Pattern to follow]
- [Constraint to work within]

## What We're NOT Doing

[Explicitly list out-of-scope items to prevent scope creep]

## Implementation Approach

[High-level strategy and reasoning]

## Phase 1: [Descriptive Name]

**Complexity**: [LOW | MEDIUM | HIGH] — [one-line justification: scope, blast radius, novelty — see "Phase Complexity" below]

### Overview

[What this phase accomplishes]

### Changes Required:

#### 1. [Component/File Group]

**File**: `path/to/file.ext`
**Changes**: [Summary of changes]

```[language]
// Specific code to add/modify
```

### Success Criteria:

#### Automated Verification:

- [ ] Project builds: `[the profile's toolchain.build_verify_cmd]`
- [ ] Tests pass: `[the profile's toolchain.test_cmd]`
- [ ] Phase-specific tests pass: `[toolchain.test_cmd narrowed to the test(s) this phase adds or changes]`
- [ ] No new build warnings: check the build output

#### Manual Verification:

- [ ] Feature works as expected when tested via UI
- [ ] Performance is acceptable under load
- [ ] Edge case handling verified manually
- [ ] No regressions in related features

---

## Phase 2: [Descriptive Name]

**Complexity**: [LOW | MEDIUM | HIGH] — [justification]

[Similar structure with both automated and manual success criteria...]

---

## Testing Strategy

> **Test conventions are repository-specific and MANDATORY.** Before writing the Testing Strategy, read the test-conventions section of the conventions doc named by `conventionsDoc` in `.claude/workflows/implement-plan-assets/repo-profile.json`, and plan tests that satisfy it — fixture/field structure, where helpers and fakes live, and any convention the build actively enforces. A plan whose tests violate those rules will fail the build no matter how good the design is.

### Unit Tests:

- [What to test]
- [Key edge cases]
- Plan the test fixture surface - name the collaborators (subject under test, substitutes) and the factory/builder helpers the tests will need, in whatever form the conventions doc prescribes, so the test author has a clear shopping list.
- Where the conventions doc demands a specific arrange shape or a matrix of null/edge cases for the subsystem being touched, enumerate those helpers and cases explicitly so they are not forgotten during implementation.

### Integration Tests:

- [End-to-end scenarios]

### Manual Testing Steps:

1. [Specific step to verify feature]
2. [Another verification step]
3. [Edge case to test manually]

## Performance Considerations

[Any performance implications or optimizations needed]

## Migration Notes

[If applicable, how to handle existing data/systems]

## References

- Related research: `[relevant documentation]`
- Similar implementation: `[file:line]`
````

### Step 5: Save and User Review

1. **Save the plan:**
   - Save the plan document to `.claude/ai/plan-YYYY-MM-DD-ISSUE-description.md`
   - Include the metadata from step 4.1 in the document

2. **Present the plan:**

   ```
   I've created the implementation plan at:
   `.claude/ai/plan-YYYY-MM-DD-ISSUE-description.md`

   Please review it and let me know:
   - Are the phases properly scoped?
   - Are the success criteria specific enough?
   - Any technical details that need adjustment?
   - Missing edge cases or considerations?
   ```

3. **Iterate based on feedback** - be ready to:

   - Add missing phases
   - Adjust technical approach
   - Clarify success criteria (both automated and manual)
   - Add/remove scope items
   - Update the plan file directly with the Edit/Write tool (preserve the YAML frontmatter)

4. **Continue refining** until the user approves the content direction.

5. **Once approved, automatically proceed to Step 6** (Automated Review Passes) — no additional confirmation needed.

### Step 6: Automated Review Passes (scaled to plan complexity)

After the user approves the content direction, automatically run progressive review passes using fresh sub-agents. Each pass reads the actual plan file at `.claude/ai/plan-YYYY-MM-DD-ISSUE-description.md` and has a different focus, escalating from tactical to existential.

**Scale the number of passes to the plan's MAX phase complexity** — the same principle
the dynamic workflow applies to its agent chains (review effort should match blast
radius):

- **All phases LOW** → Pass 1 (Tactical) only
- **Highest phase MEDIUM** → Passes 1–2 (Tactical + Architectural)
- **Any phase HIGH** → all 3 passes (+ Devil's Advocate)

The user can always request the full 3-pass board explicitly regardless of complexity.

**Why fresh agents per pass**: A single review, even a thorough one, misses things. Each fresh agent reads the plan without the prior reviewer's reasoning bias. The escalating focus ensures both in-the-small and in-the-large issues are caught before implementation.

Use the **plan-reviewer** agent for each pass. Run the passes **sequentially** — incorporate each pass's feedback into the plan file (via the Edit/Write tool, preserving the YAML frontmatter) before launching the next pass, so each reviewer sees the improved plan.

#### Step 6a: Review Pass 1 — Tactical Reviewer (narrow, in-the-small)

Spawn the **plan-reviewer** agent with a tactical focus:

```
Review the implementation plan at `.claude/ai/plan-YYYY-MM-DD-ISSUE-description.md`.

THIS PASS focuses ONLY on tactical execution quality:

1. **Can an agent implement each phase without asking questions?**
   - Are file paths specific and correct?
   - Are function signatures, code snippets, and patterns included?
   - Is every success criterion objectively testable, with exact
     commands (build/test/lint) rather than generic "run tests"?

2. **Is the phasing correct?**
   - Would executing phases in the specified order actually work?
   - Are there hidden dependencies between phases that aren't declared?
   - Is each phase a coherent, independently verifiable unit of work?
   - Is each phase tagged with a complexity (LOW/MEDIUM/HIGH) that
     honestly reflects its scope, blast radius, and novelty? Flag any
     under-tagged phase (e.g. a migration or strict-timeline change
     marked LOW).

3. **Are the test conventions honored?**
   - Do test plans follow the conventions doc's test rules (fixture
     structure, where helpers and fakes live, any convention the build
     enforces)?
   - Where that doc demands a specific arrange shape or a matrix of
     null/edge cases for the subsystem being touched, are they enumerated?

Do NOT evaluate whether this is the right approach. Only evaluate
whether the chosen approach is specified clearly enough to execute.

Read the plan fully and provide your structured review.
```

Wait for the review to complete, then incorporate tactical feedback by editing the plan file.

#### Step 6b: Review Pass 2 — Architectural Reviewer (broad, in-the-large)

Spawn the **plan-reviewer** agent with an architectural focus:

```
Review the implementation plan at `.claude/ai/plan-YYYY-MM-DD-ISSUE-description.md`.

THIS PASS focuses ONLY on architectural fitness:

1. **Pattern alignment**: does this plan follow the patterns already
   established in this repository (layering, validation, persistence
   access, the sanctioned abstractions for recurring shapes) or does it
   introduce new ones? If new, is the deviation justified? Check against
   the conventions doc and the architecture doc named in the repo profile.

2. **Scope creep**: Is every phase necessary for the stated goal?
   What could be removed while still achieving the objective?
   Is the "What We're NOT Doing" section honest and complete?

3. **Risk assessment**: Which phase is most likely to fail or need
   rework? What's the blast radius if a phase is implemented
   incorrectly?

4. **Integration concerns**: How will these changes interact with the
   rest of the system (other endpoints, timeline consistency, OpenAPI
   contracts, downstream consumers)? Are there side effects the plan
   doesn't address?

Do NOT evaluate clarity or formatting. Only evaluate whether this
is a sound engineering approach.

Read the plan fully and provide your structured review.
```

Wait for the review to complete, then incorporate architectural feedback by editing the plan file.

#### Step 6c: Review Pass 3 — Devil's Advocate (existential)

Spawn the **plan-reviewer** agent with an adversarial focus:

```
Review the implementation plan at `.claude/ai/plan-YYYY-MM-DD-ISSUE-description.md`.

THIS PASS challenges fundamental assumptions:

1. **Should we build this at all?** Is there a simpler alternative
   that achieves 80% of the value with 20% of the work?

2. **Are we solving the right problem?** Could the underlying need
   be addressed differently? What would a completely different
   approach look like?

3. **What will we regret?** Six months from now, what decision in
   this plan will we wish we'd made differently?

4. **What's the worst case?** If this plan goes wrong, what's the
   failure mode? Is it recoverable? Are migrations/rollback covered?

5. **Premature complexity**: Are we building infrastructure for
   hypothetical future needs? Can any of this be deferred?

Be genuinely adversarial. The plan has already passed tactical and
architectural review — your job is to find the things those reviews
were too polite to flag.

Read the plan fully and provide your structured review.
```

Wait for the review to complete. Only incorporate feedback that identifies genuine risks or oversights — the devil's advocate is meant to pressure-test, not derail.

### Step 7: Final Incorporation

1. **Incorporate the approved feedback** from all three passes:
   - Address critical issues identified by the reviewers
   - Apply clarity improvements and conciseness cuts
   - Add any missing pieces flagged
   - Update the plan file with the Edit/Write tool, preserving the YAML frontmatter

2. **Verify the final plan:**
   - Re-read the updated plan to ensure changes were applied correctly
   - Confirm all critical issues from the reviews are resolved
   - Ensure the plan remains coherent after edits
   - **Machine-validate the plan** by dry-running the dynamic workflow in expand mode
     (mutates nothing; one low-effort agent):

     ```text
     Workflow({ scriptPath: ".claude/workflows/implement-plan-with-dynamic-workflow.js",
                args: { plan: ".claude/ai/plan-YYYY-MM-DD-ISSUE-description.md", mode: "expand" } })
     ```

     Confirm the manifest shows every phase with its intended complexity and non-empty
     Automated criteria, and that parse notes report no errors. Fix the plan and re-run
     if not — a format problem is cheap now and expensive at delegate time.
   - Flip the frontmatter `status: draft` → `status: complete`

3. **Present the finalized plan:**

   ```
   The implementation plan has been finalized after user review and
   three automated review passes:

   - **Path**: `.claude/ai/plan-YYYY-MM-DD-ISSUE-description.md`

   **Review Summary:**
   - User Review: [Key adjustments made]
   - Tactical Review: [Execution clarity improvements]
   - Architectural Review: [Design fitness improvements]
   - Devil's Advocate: [Risks addressed or acknowledged]

   **Recommended next step** (overall complexity — highest phase = [LOW|MEDIUM|HIGH]):
   - **[recommended command]** — [one-line rationale]
   - Alternative: **[other command]** — [when to prefer it]
   ```

4. **Recommend an implementer based on plan complexity.** Fill the "Recommended next step" block above from the MAX phase complexity across the plan:
   - **All phases LOW** → recommend **`/implement-plan`** (interactive, in-place, supervised — the multi-agent worktree machinery is overkill for small, low-risk changes). Alternative: `/implement-plan-with-dynamic-workflow` if you still want the automated board/gate review.
   - **Highest phase MEDIUM** → recommend **`/implement-plan-with-dynamic-workflow`** (autonomous: dedicated worktree, complexity-sized pass chains, a parallel review board + Build/Test/QA gates). Alternative: `/implement-plan` to supervise step by step.
   - **Any phase HIGH** → recommend **`/implement-plan-with-dynamic-workflow`** (the deeper pass chains, review board, and gates earn their keep on high-blast-radius work). Alternative: `/implement-plan` if a HIGH phase needs close human judgment at each step.

   Both consume this exact plan; the dynamic workflow additionally reads each phase's `**Complexity**:` tag to size its agent chain (LOW: initial pass only; MEDIUM: initial + edge-case passes plus a spec reviewer; HIGH: the MEDIUM chain plus a hardening reviewer — every phase ends with an independent criteria-verify agent).

5. **Plan is complete** — no additional validation needed unless the user requests it.

## Important Guidelines

1. **Be Skeptical**:

   - Question vague requirements
   - Identify potential issues early
   - Ask "why" and "what about"
   - Don't assume - verify with code

2. **Be Interactive**:

   - Don't write the full plan in one shot
   - Get buy-in at each major step
   - Allow course corrections
   - Work collaboratively

3. **Be Thorough**:

   - Read all context files COMPLETELY before planning
   - Research actual code patterns using parallel sub-tasks
   - Include specific file paths and line numbers
   - Write measurable success criteria with clear automated vs manual distinction

4. **Be Practical**:

   - Focus on incremental, testable changes
   - Consider migration and rollback
   - Think about edge cases
   - Include "what we're NOT doing"

5. **Track Progress**:

   - Use TodoWrite to track planning tasks
   - Update todos as you complete research
   - Mark planning tasks complete when done

6. **No Open Questions in Final Plan**:
   - If you encounter open questions during planning, STOP
   - Research or ask for clarification immediately
   - Do NOT write the plan with unresolved questions
   - The implementation plan must be complete and actionable
   - Every decision must be made before finalizing the plan
   - This includes the issue tracker number — a plan without an `issue:` in its frontmatter
     is not complete (downstream tooling prefixes commits and the PR with it)

7. **Review Process** (1 user review + complexity-scaled automated passes):
   - User Review (Step 5): the user approves the content direction before automated review
   - After approval, progressive `plan-reviewer` passes run automatically and sequentially,
     scaled to the plan's max phase complexity (LOW → 1 pass, MEDIUM → 2, HIGH → 3):
     - Pass 1 (Tactical): execution clarity, correctness, test-convention compliance
     - Pass 2 (Architectural): design fitness, pattern alignment, scope discipline
     - Pass 3 (Devil's Advocate): fundamental assumptions and risks
   - Incorporate each pass's feedback into the plan file before launching the next pass
   - Only incorporate devil's-advocate feedback that identifies genuine risks — it pressure-tests, it does not derail

## Phase Complexity

Tag every phase with a complexity of **LOW**, **MEDIUM**, or **HIGH** on the `**Complexity**:` line under its heading. This is a first-class part of the plan: an automated implementer uses it to decide how many refinement passes to apply to the phase (more complex → more passes). Assign it from the phase's scope, blast radius, and novelty — when a phase straddles two bands, round **up** (under-tagging means under-review).

- **LOW** - a small, localized change that follows an existing pattern: add or adjust a field on a data-transfer type, a single mapping tweak, a config or dependency-registration change, a focused bug fix. Few files, one layer, low blast radius, no new patterns.
- **MEDIUM** - work spanning multiple files or layers (entry point -> service -> persistence), new validation or business logic, a new endpoint/handler that follows existing conventions, or a mapping change needing full null/edge coverage. Moderate blast radius; reuses established patterns.
- **HIGH** - cross-cutting or novel work: schema migrations or data backfills, concurrency-sensitive paths, security or tenant/permission-isolation changes, published-contract changes with downstream consumers, or anything introducing a new architectural pattern. High blast radius or hard to reverse.

When in doubt between two bands, choose the higher one.

## Success Criteria Guidelines

**Always separate success criteria into two categories:**

1. **Automated Verification** (can be run by execution agents):

   - Commands that can be run: the repo profile's `toolchain` commands (build, test, format/lint) and any narrowed test invocation; plus file-existence and grep checks
   - Specific files that should exist
   - Code compilation/type checking
   - Automated test suites

   **Every Automated criterion is an executable contract**: the dynamic workflow's
   independent criteria-verify agent runs each command VERBATIM in a fresh worktree and
   grades the phase on the result. Therefore every criterion must:

   - **Terminate on its own** - never a long-running process such as a dev server (use a
     health-check test, or a Manual criterion for "the app starts")
   - **Need no external services** the fresh worktree does not have - no containers,
     databases or cloud credentials unless the repo profile's `test_cmd` already provides
     them; if a criterion genuinely requires them, say so explicitly and expect it to be
     verified manually or via a `toolchain` override
   - **Be phase-specific where possible** - a criteria list that is only "build + full
     suite" makes independent verification near-vacuous; name the exact test or filter the
     phase adds or changes

2. **Manual Verification** (requires human testing):
   - UI/UX functionality
   - Performance under real conditions
   - Edge cases that are hard to automate
   - User acceptance criteria

**Format example:**

```markdown
### Success Criteria:

#### Automated Verification:

- [ ] Project builds: `[toolchain.build_verify_cmd]`
- [ ] Tests pass: `[toolchain.test_cmd]`
- [ ] New tests for this phase pass: `[toolchain.test_cmd narrowed to the new test(s)]`
- [ ] Formatting clean: `[toolchain.lint_cmd]`

#### Manual Verification:

- [ ] New API endpoint returns expected response
- [ ] Performance is acceptable under load
- [ ] Error responses follow API conventions
- [ ] OpenAPI documentation is accurate
```

## Common Patterns

### For Persistence / Schema Changes:

- Start with the schema change or migration in whatever form this repo uses
- Add or update the data-access methods
- Update the service layer
- Expose through the entry point (endpoint, handler, command)
- Update the published contract or schema artifact
- **Update documentation** (see Documentation Updates below)

### For New Features:

- Research existing patterns in the codebase first, and copy the closest one
- Start at the core (domain type, value object) and work outward
- Build the service layer
- Add validation at the trust boundary
- Add the entry point
- Update the published contract and regenerate anything derived from it
- **Update documentation** (see Documentation Updates below)

### For Changes to a Subsystem with Its Own Rules:

- Re-read that subsystem's section in the conventions doc before planning the phases
- Name, in the plan, which of its rules the change has to satisfy
- Plan the test matrix that proves each of them

### Lessons Learned (Common Pitfalls):

> **Canonical source**: the pitfalls section of the conventions doc named by
> `conventionsDoc` in `.claude/workflows/implement-plan-assets/repo-profile.json` is the
> authoritative list - it is what implement agents read and what retrospect proposals
> target. Read it before planning and carry the planning-relevant entries into the plan's
> own phases (e.g. "error-path tests must use otherwise-valid payloads because validation
> runs first"). Do not maintain a second copy of that list here; a stale duplicate is worse
> than a pointer.


### For Refactoring:

- Document current behavior
- Plan incremental changes
- Maintain backwards compatibility
- Include migration strategy
- Ensure existing tests continue to pass
- **Update documentation** (see Documentation Updates below)

### Documentation Updates (Separate Phase):

When a plan involves code changes that affect the API surface (new/removed/modified endpoints, changed behavior, schema changes), **always include a final documentation update phase as a separate plan**. This keeps the code plan focused and the documentation plan independently reviewable.

The documentation plan should cover:

1. **User-facing documentation** - whatever this repo publishes for consumers: entity or
   resource docs, walkthroughs, integration and getting-started guides, error-code and
   reference pages, and the changelog entry.
2. **Internal documentation** - the architecture/overview doc named as `archDoc` in the repo
   profile, plus the conventions doc if the change establishes or changes a rule.
3. **Generated contract artifacts** - regenerate anything derived from a schema or spec you
   modified (bundled specs, client contracts, typed models) with the repo's own generation
   command, and commit the result.

**In the code plan**, add a note at the end:
```markdown
## Documentation

A separate documentation update plan should be created after this plan is implemented.
See the create-plan command's "Documentation Updates" pattern for scope.
```

## Sub-task Spawning Best Practices

When spawning research sub-tasks:

1. **Spawn multiple tasks in parallel** for efficiency
2. **Each task should be focused** on a specific area
3. **Provide detailed instructions** including:
   - Exactly what to search for
   - Which directories to focus on
   - What information to extract
   - Expected output format
4. **Be EXTREMELY specific about directories**:
   - Include the full path context in your prompts
5. **Specify read-only tools** to use
6. **Request specific file:line references** in responses
7. **Wait for all tasks to complete** before synthesizing
8. **Verify sub-task results**:
   - If a sub-task returns unexpected results, spawn follow-up tasks
   - Cross-check findings against the actual codebase
   - Don't accept results that seem incorrect

Example — issue these as multiple Agent tool calls in a single message so they run concurrently, each focused on one area:

- **codebase-locator** — "find all files related to the database schema for [feature]"
- **codebase-analyzer** — "analyze how the current [endpoint/service] is implemented"
- **codebase-pattern-finder** — "find a similar existing feature to model the new work after"
- **codebase-analyzer** — "examine the existing test patterns for [area]"

## Example Interaction Flow

```
User: /create-plan
Assistant: I'll help you create a detailed implementation plan...

User: We need to add a new endpoint for employee time-off requests.
Assistant: Let me research the codebase to understand the current implementation...

[Researches codebase]

Based on my research, I understand we need to add a time-off request endpoint following the existing controller → service → repository pattern. Before I start planning, I have some questions...

[Interactive process continues...]
```