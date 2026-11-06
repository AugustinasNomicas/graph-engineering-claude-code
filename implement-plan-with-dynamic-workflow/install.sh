#!/usr/bin/env bash
# Install the implement-plan-with-dynamic-workflow bundle into a repo's .claude/ directory.
#
#   ./install.sh /path/to/your/repo
#
# Never overwrites an existing file: anything already present is reported and skipped, so
# re-running after an upstream update is safe and shows you exactly what diverged.
set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "usage: $0 /path/to/target/repo" >&2
  exit 2
fi
if [[ ! -d "$TARGET" ]]; then
  echo "error: $TARGET is not a directory" >&2
  exit 2
fi
# .git is a directory in a normal clone and a FILE inside a git worktree -- accept both.
if [[ ! -e "$TARGET/.git" ]]; then
  echo "error: $TARGET is not a git repository (the workflow creates worktrees off it)" >&2
  exit 2
fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/claude"
DEST="$TARGET/.claude"
# Absolute, so the Next steps below are copy-pasteable from whatever directory the installer
# was run in -- $TARGET is frequently relative, and is not the caller's cwd.
ROOT="$(cd "$TARGET" && pwd)"
ASSETS="$ROOT/.claude/workflows/implement-plan-assets"

copied=0
skipped=0
skipped_list=()

while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  out="$DEST/$rel"
  if [[ -e "$out" ]]; then
    skipped=$((skipped + 1))
    skipped_list+=("$rel")
    continue
  fi
  mkdir -p "$(dirname "$out")"
  cp "$file" "$out"
  copied=$((copied + 1))
done < <(find "$SRC" -type f -print0)

echo "Installed into $DEST: $copied file(s) copied, $skipped skipped."
if (( skipped > 0 )); then
  echo
  echo "Already present (left untouched — diff them against this bundle if you expected an update):"
  printf '  %s\n' "${skipped_list[@]}"
fi

cat <<EOF

Next steps (the bundle does nothing until it is localized).
All of them run in the target repo, NOT in the directory you ran this installer from:

  cd "$ASSETS"

  1. cp repo-profile.example.json repo-profile.json
     Fill in toolchain.build_verify_cmd and toolchain.test_cmd (both REQUIRED — a run
     refuses to start without them), format/lint, repoLabel, and domainReviewer.
     Take the commands from what your CI actually runs.

  2. cp conventions.template.md conventions.md
     Your repo's binding rules. This is the file that decides output quality.

  3. Keep reviewers/reviewer-domain-hazards.md nearly EMPTY until a real defect
     escapes. Speculative rules cost you a false finding on every run.

  4. git add repo-profile.json conventions.md reviewers/
     They MUST be committed — agents read them inside a fresh git worktree.

  5. Dry run, mutating nothing. Paths here are repo-root-relative, so run this from
     the repo root ($ROOT), not from the assets directory you cd'd into above:
     Workflow({ scriptPath: ".claude/workflows/implement-plan-with-dynamic-workflow.js",
                args: { plan: ".claude/ai/plan-....md", mode: "expand" } })

See the bundle README for the per-stack command table and the full rationale.
EOF
