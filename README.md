# Graph engineering with Claude Code dynamic workflows

Run more than one agent and you already have a graph — drawn on purpose, or by accident. This repo
is a talk about drawing it on purpose, and the working example the talk is built on.

| | |
|---|---|
| [`talk/`](talk/) | The 30-minute deck: [`slides.html`](talk/slides.html) opens in any browser, speaker notes included |
| [`implement-plan-with-dynamic-workflow/`](implement-plan-with-dynamic-workflow/) | A stack-agnostic Claude Code dynamic workflow that implements an approved plan end to end |

## The workflow

Give it an approved, phased plan. It creates a git worktree, implements every phase, has each phase
reviewed by an agent that did not write the code, verifies the plan's success criteria with a
separate agent, puts the whole diff in front of a board of specialist reviewers in parallel, fixes
what they verifiably find, and runs your build and test gates. It reports whether the branch is
worth a PR — and never opens one itself.

```bash
git clone https://github.com/AugustinasNomicas/graph-engineering-claude-code
./graph-engineering-claude-code/implement-plan-with-dynamic-workflow/install.sh /path/to/your/repo
```

Then fill in two files — your build/test commands and your coding conventions — commit them, and
dry-run it. The [workflow README](implement-plan-with-dynamic-workflow/README.md) has the steps,
the per-stack command table and the design rationale.

**Claude Code only.** It is built on Claude Code dynamic workflows and its
skills/commands/agents layout.

## Where the numbers come from

Every figure in the talk comes from one team running this workflow on one .NET service, June to
November 2026: 76 unattended runs, each merged as a production PR. Treat them as a worked example
of how to measure your own graph, not as a benchmark.

## License

- **The workflow** — [`implement-plan-with-dynamic-workflow/`](implement-plan-with-dynamic-workflow/)
  is [MIT](implement-plan-with-dynamic-workflow/LICENSE). Use it, change it, ship it.
- **Everything else** — the talk, its slides, notes and diagram — is [CC BY 4.0](LICENSE): reuse
  and adapt it, with attribution.
