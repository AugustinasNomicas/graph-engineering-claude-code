# Reviewer Charter: Domain Hazards

<!--
  THIS FILE IS A TEMPLATE. It is the one charter that is meant to differ in every repository.
  Rename it if you like (set `domainReviewer` in repo-profile.json to match the filename
  suffix — `reviewer-<domainReviewer>.md`) and replace the examples below with YOUR repo's
  failure classes.

  START NEARLY EMPTY. Do not populate this from imagination or from generic best practice —
  everything generic is already covered by the other charters, and a speculative rule here
  costs you a false finding on every future run. Add a rule only when a real defect of that
  class has actually escaped: a PR review comment you had to make twice, a production
  incident, a rollback, a poisoned queue. `mode:"retrospect"` exists to mine exactly these
  from human follow-up commits and propose them; this file is where accepted proposals land.

  Delete this comment block once you have written your first real rule.
-->

Apply repo-specific hazard checks that the generic reviewers miss. Every rule here is a
failure class **this repository has already paid for** — in review cycles, production
incidents, or corrupted data. Treat each as a known defect pattern, not a style preference.

## Covers

Replace the placeholders below. Each rule should name (a) the concrete thing to look for,
(b) where it applies, and (c) what breaks when it is violated — the consequence is what
makes a reviewer treat it as a defect rather than a nit.

- **[Identity / correlation hazard]** — e.g. which of two similar identifiers must be used
  in a given context, and what downstream system breaks when they are swapped.
- **[Encoding / serialization hazard]** — e.g. free-form input that flows into a delimited,
  composite or hashed key and must be sanitized first, and what happens when it is not.
- **[Canonical-helper rule]** — e.g. a helper that is the ONLY sanctioned way to produce
  some value, so inlined or reimplemented equivalents are defects.
- **[Subsystem-specific test discipline]** — e.g. a family of files whose tests must mirror
  a particular data shape or cover a specific matrix of cases, because the naive arrangement
  passes while proving nothing.
- **[Lifetime / ownership rule]** — e.g. a class of dependency that must be registered or
  scoped a particular way, and the failure it produces when it is not.
- **[Ordering / gating rule]** — e.g. a validation or authorization layer that runs before
  another, which changes how a test for the later layer must be constructed.

## Does NOT Cover

- Generic logic correctness, null handling, error paths (see reviewer-safety-correctness)
- Generic security vulnerabilities (see reviewer-security)
- Test quality, coverage and redundancy (see reviewer-test-integrity,
  reviewer-coverage-critical, reviewer-test-economy)
- Structure, naming, coupling (see reviewer-maintainability-design)
- Duplication and needless abstraction (see reviewer-code-simplification)
- Whether the diff matches the approved plan (see reviewer-plan-conformance)

Anything a competent reviewer on any codebase would flag belongs in one of those charters,
not here. If a rule you are about to add would make sense in a repository you have never
seen, it does not belong in this file.

## Instructions

1. Read the repo conventions doc named by `repo-profile.json` (`conventionsDoc`) — several
   rules here will restate its hard requirements from an enforcement angle, and the
   conventions doc is authoritative on the details.
2. Read the full diff under review — run the diff commands the invoking tool provides, which
   supply the correct base ref already resolved; do not compose your own `git diff`. Then read
   the surrounding source for every file the diff touches. Hazards in this charter are usually about how new code *interacts with
   existing code*, which a diff alone does not show.
3. Report a finding only when you can point at the specific line and name the concrete
   consequence. "Does not follow repo conventions" is not a finding; "uses X where this
   context requires Y, which breaks Z" is.

## Severity Guide

- **CRITICAL** — data corruption, a poisoned queue or stream, a silent cross-tenant or
  cross-account leak.
- **HIGH** — the hazard will fire in normal operation: broken correlation or observability,
  a wrong value persisted, an event that cannot be processed.
- **MEDIUM** — the hazard fires only on an edge case, or the code is correct today but is
  written in the shape that has failed before.
- **LOW** — a near-miss worth noting; the code works but diverges from the sanctioned
  pattern in a way that invites the failure later.

Finding ID prefix: `DOM-`
