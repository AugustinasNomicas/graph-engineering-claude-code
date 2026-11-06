# <Repo> Conventions

<!--
  TEMPLATE. Copy to the path you set as `conventionsDoc` in repo-profile.json (by default
  .claude/workflows/implement-plan-assets/conventions.md), then replace every section below.
  COMMIT IT — agents read this file inside a fresh git worktree, so an uncommitted or
  gitignored file is invisible to them.

  This is the highest-leverage file in the bundle. Every implement agent, every phase
  reviewer, the fixers, and the conventions-aware board reviewers are all told to read it in
  full and treat it as BINDING. The pipeline's output quality tracks this file more than any
  other single input.

  Three rules for writing it well:

  1. WRITE ENFORCEABLE RULES, NOT VALUES. "Prefer clean code" is unusable. "Repository-
     dependent services are registered per-request, never as singletons" is checkable.
  2. SAY WHAT BREAKS. A rule with a consequence attached gets followed and gets reported as a
     defect by reviewers; a bare imperative gets rationalized away.
  3. LET IT GROW FROM EVIDENCE. Do not try to write it all up front. Seed it with what you
     already know breaks, then run `mode:"retrospect"` after a few runs: it mines the commits
     humans had to make on top of the agents' work and proposes additions in ready-to-paste
     form. That loop is how this file earns its length.

  Keep it dense. Agents read it in full on every pass, so prose that carries no rule is pure
  cost. Bullets beat paragraphs.

  Delete this comment block when you have replaced the sections.
-->

Rules below are MANDATORY for any change in this repository. Where a rule and your instinct
disagree, the rule wins; where a rule and the surrounding code disagree, raise it rather than
silently picking one.

## Architecture

- **Layering / dependency direction** — which modules may depend on which, and what an
  inward/outward violation looks like in this codebase.
- **Where new code goes** — the directory or module a new endpoint, job, migration or
  integration belongs in, and the existing example to copy.
- **Patterns to follow rather than reinvent** — name the sanctioned abstraction for the
  recurring shapes (request handling, persistence access, external calls, background work).

## Tests

- **Structure of a test class/file** — how the subject under test and its substitutes are
  held, whether state may be shared between cases, where helpers and fakes live. Include any
  convention your build actively enforces, and say that it fails the build, so an agent
  treats it as hard.
- **What a new behaviour must be covered by** — the minimum matrix (happy path plus which
  edge cases) for the kinds of change this repo sees most.
- **How to run tests** — the discipline (which command, which subset during development),
  and any suite that must NOT be run locally, with the reason.
- **Assertion quality bars** — e.g. no test may pass when the subject does nothing; assert
  the observable contract, not the implementation. Pin the discriminator rather than a bare
  exception type or status code, so a test cannot pass on the right failure for the wrong
  reason.
- **Coverage reach** — which suites the CI gate actually runs, and which it excludes. Name the
  excluded ones explicitly: a fact parked in a suite CI skips is not regression protection, and
  deleting the code under test will stay green. Where one contract is implemented on more than
  one backend or path, say that each side needs its own fact, and that symmetric siblings
  (create/update, read/write, two axes of one entity) get their test rosters diffed.

## Logging, errors and observability

- **Logging style** — structured vs interpolated, which fields are mandatory, which
  identifier belongs in a log scope when two similar ones exist.
- **Client-facing error content** — what may and may not appear in a response body or
  message, and where the detail goes instead.
- **Failure semantics** — what must fail loudly, what must degrade, and how to tell which is
  which for a new dependency.

## Data and persistence

- **Migration/schema-change rules** — ordering, backfills, backward compatibility windows.
- **Canonical helpers** — any value (id, hash, etag, key, timestamp) with exactly one
  sanctioned producer, so that inlining an equivalent is a defect.
- **Transaction and consistency expectations** for the code paths agents will touch.
- **External write semantics are evidence, not inference** — for any system whose merge, delete
  or field semantics live outside this repo, state what a write test MUST assert (the captured
  outbound payload, against literal expected values written out in the test) and what does not
  count: feeding the payload back through your own read mapper, an echoing mock, the response
  projection, or state seeded by the writer under test. The failure surface sits below the mock,
  and the mock returns what it was sent — so a write the external system rejects outright can
  ship with a fully green suite. Name the reference doc or captured sample that counts as
  evidence, and say that semantics verified for one field are not evidence for a sibling field.

## Pitfalls

The highest-value section, and the one retrospect grows. Each entry: the trap, the symptom it
produces, and the correct move. These are the things that have actually cost this team time —
an import that looks unused but is load-bearing, a validation layer that runs earlier than
expected and changes how error-path tests must be built, a helper whose obvious usage is
wrong, a config key that must stay optional.

- **[trap]** — [symptom] — [what to do instead]

A worked example of the shape, from a real defect, so the form is clear:

- **A cap on an external limit counted in the wrong unit** — a character-length check against a
  byte-measured quota (queue message, document size, column width) passes locally on ASCII and
  poison-loops non-ASCII payloads to the dead-letter queue in production; the constant reads as
  correct because the comment quotes the right limit — **count in the unit the external system
  measures, name the constant for that unit, truncate on character boundaries rather than mid
  sequence, and cover each guard with an ASCII fixture AND a multi-byte one.** A fixture built
  from a repeated ASCII character proves nothing about a byte limit.

## Definition of done

- The build is clean, including warnings the CI treats as errors.
- The relevant tests pass, run through the sanctioned command.
- Formatting and lint are clean.
- [Any repo-specific gate: docs regenerated, schema/contract updated, changelog entry,
  version bumped, generated files committed.]
