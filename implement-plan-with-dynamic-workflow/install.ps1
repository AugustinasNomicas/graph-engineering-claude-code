<#
.SYNOPSIS
Install the implement-plan-with-dynamic-workflow bundle into a repo's .claude directory.

.DESCRIPTION
Windows equivalent of install.sh. Copies this bundle's claude\ payload into <repo>\.claude\.
Never overwrites an existing file: anything already present is reported and skipped, so
re-running after an upstream update is safe and shows you exactly what has diverged.

Targets Windows PowerShell 5.1 (shipped with Windows) as well as PowerShell 7+.

.PARAMETER TargetRepo
Path to the git repository to install into.

.EXAMPLE
.\install.ps1 C:\src\my-repo

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\install.ps1 C:\src\my-repo
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string] $TargetRepo
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Plain single-line stderr, matching install.sh. Write-Error would wrap the message in a
# multi-line red block with script/line context, and a caller running with
# $ErrorActionPreference='Stop' would see it as a terminating error rather than an exit code.
function Fail([string] $Message, [int] $Code) {
    [Console]::Error.WriteLine($Message)
    exit $Code
}

if ([string]::IsNullOrWhiteSpace($TargetRepo)) {
    Fail 'usage: .\install.ps1 <path-to-target-repo>' 2
}

if (-not (Test-Path -LiteralPath $TargetRepo -PathType Container)) {
    Fail "error: $TargetRepo is not a directory" 2
}

$target = (Resolve-Path -LiteralPath $TargetRepo).ProviderPath.TrimEnd('\', '/')

# .git is a directory in a normal clone and a FILE inside a git worktree -- accept both.
if (-not (Test-Path -LiteralPath (Join-Path $target '.git'))) {
    Fail "error: $target is not a git repository (the workflow creates worktrees off it)" 2
}

$src = (Join-Path $PSScriptRoot 'claude').TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath $src -PathType Container)) {
    Fail "error: bundle payload not found at $src" 1
}

$dest = Join-Path $target '.claude'

$copied = 0
$skippedList = New-Object System.Collections.Generic.List[string]

foreach ($file in Get-ChildItem -LiteralPath $src -Recurse -File) {
    $relative = $file.FullName.Substring($src.Length + 1)
    $outPath = Join-Path $dest $relative

    if (Test-Path -LiteralPath $outPath) {
        $skippedList.Add($relative)
        continue
    }

    $outDir = Split-Path -Path $outPath -Parent
    if (-not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $file.FullName -Destination $outPath
    $copied++
}

Write-Host "Installed into $dest`: $copied file(s) copied, $($skippedList.Count) skipped."

if ($skippedList.Count -gt 0) {
    Write-Host ""
    Write-Host "Already present (left untouched - diff them against this bundle if you expected an update):"
    foreach ($item in $skippedList) {
        Write-Host "  $item"
    }
}

# $target is already an absolute ProviderPath (Resolve-Path above), so the Next steps are
# copy-pasteable from whatever directory the installer was run in. Double-quoted here-string
# so $assets interpolates -- the body has no other $ or backtick to escape.
$assets = Join-Path $target '.claude\workflows\implement-plan-assets'

Write-Host @"

Next steps (the bundle does nothing until it is localized).
All of them run in the target repo, NOT in the directory you ran this installer from:

  cd "$assets"

  1. copy repo-profile.example.json repo-profile.json
     Fill in toolchain.build_verify_cmd and toolchain.test_cmd (both REQUIRED - a run
     refuses to start without them), format/lint, repoLabel, and domainReviewer.
     Take the commands from what your CI actually runs.

  2. copy conventions.template.md conventions.md
     Your repo's binding rules. This is the file that decides output quality.

  3. Keep reviewers\reviewer-domain-hazards.md nearly EMPTY until a real defect
     escapes. Speculative rules cost you a false finding on every run.

  4. Gitignore the pipeline's scratch directory, from the repo root ($target):
       Add-Content .gitignore '.claude/ai/'   (skip if the line is already there)
     /create-plan writes plans there and the workflow treats it as internal state: it
     force-adds a plan snapshot on the branch and strips it again before the PR. If the
     directory is tracked instead, a plan you committed earlier gets edited on the branch
     and the finalize step removes it from the PR diff rather than deleting it - but keep
     it ignored so plans stay local proposals, never accidental commits.

  5. git add .gitignore repo-profile.json conventions.md reviewers/
     They MUST be committed - agents read them inside a fresh git worktree.

  6. Dry run, mutating nothing. Paths here are repo-root-relative, so run this from
     the repo root ($target), not from the assets directory you cd'd into above:
     Workflow({ scriptPath: ".claude/workflows/implement-plan-with-dynamic-workflow.js",
                args: { plan: ".claude/ai/plan-....md", mode: "expand" } })

See the bundle README for the per-stack command table and the full rationale.
"@
