# Implement Plan

You are tasked with implementing an approved technical plan. These plans contain phases with specific changes and success criteria.

## Required Reading

**IMPORTANT**: before starting any implementation work you MUST read:

1. The repository conventions doc named by `conventionsDoc` in `.claude/workflows/implement-plan-assets/repo-profile.json` — the binding rules for this codebase (see "Repository Conventions" below).
2. The architecture doc named by `archDoc` in that same profile, if it names one — context on structure, naming and existing patterns.

Both are committed. Read them fully; they are the difference between code that fits this codebase and code that merely compiles.

## Getting Started

When given a plan path:

- **FIRST**: read the conventions doc, and the architecture doc if the profile names one
- Read the plan completely and check for any existing checkmarks (- [x])
- Read the original ticket and all files mentioned in the plan
- **Read files fully** - never use limit/offset parameters, you need complete context
- Think deeply about how the pieces fit together
- Create a todo list to track your progress
- Start implementing if you understand what needs to be done

If no plan path provided, ask for one.

## Implementation Philosophy

Plans are carefully designed, but reality can be messy. Your job is to:

- Follow the plan's intent while adapting to what you find
- Implement each phase fully before moving to the next
- Verify your work makes sense in the broader codebase context
- Update checkboxes in the plan as you complete sections

When things don't match the plan exactly, think about why and communicate clearly. The plan is your guide, but your judgment matters too.

If you encounter a mismatch:

- STOP and think deeply about why the plan can't be followed
- Present the issue clearly:

  ```
  Issue in Phase [N]:
  Expected: [what the plan says]
  Found: [actual situation]
  Why this matters: [explanation]

  How should I proceed?
  ```

## Verification Approach

After implementing a phase:

- **Use the test-runner agent** to run the success criteria checks (usually the `test_cmd` from the repo profile covers everything)
  - The test-runner agent will provide detailed results including full error messages and stack traces if tests fail
  - Never run tests directly with Bash - always use the test-runner agent for proper test execution and reporting
- Fix any issues before proceeding based on the detailed test-runner output
- Update your progress in both the plan and your todos
- Check off completed items in the plan file itself using Edit

Don't let verification interrupt your flow - batch it at natural stopping points.

## If You Get Stuck

When something isn't working as expected:

- First, make sure you've read and understood all the relevant code
- Consider if the codebase has evolved since the plan was written
- Present the mismatch clearly and ask for guidance

Use sub-tasks sparingly - mainly for targeted debugging or exploring unfamiliar territory.

## Resuming Work

If the plan has existing checkmarks:

- Trust that completed work is done
- Pick up from the first unchecked item
- Verify previous work only if something seems off

Remember: You're implementing a solution, not just checking boxes. Keep the end goal in mind and maintain forward momentum.

## Repository Conventions (MANDATORY)

The binding coding rules for this repository are **not** in this file — they live in the
conventions doc named by `conventionsDoc` in
`.claude/workflows/implement-plan-assets/repo-profile.json` (by default
`.claude/workflows/implement-plan-assets/conventions.md`).

- **Read it in full before writing code**, and treat every rule in it as binding: test
  structure, logging and error style, canonical helpers, layering, and the pitfalls this
  codebase has already paid for.
- It is the same file the autonomous workflow injects into every implement and review agent,
  so what you follow here is exactly what the review board will judge against.
- If a rule there contradicts the plan, say so rather than silently choosing one.
- If you hit a trap that is not written down, add it to the pitfalls section of that file as
  part of your change. That is how the file earns its value.

Keep this command's process (above) and the repository's rules (there) separate: the process
is portable, the rules are yours.
