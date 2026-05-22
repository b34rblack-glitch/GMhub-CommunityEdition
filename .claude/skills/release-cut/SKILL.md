---
name: release-cut
description: Cut a new Community Screen release — bump version in module.json + package.json in lockstep, generate the CHANGELOG.md entry from Conventional Commits since the last tag, commit as `chore(release): vX.Y.Z`, tag, and push branch + tag. Use when the user asks to "cut a release", "tag a release", "bump version", "ship vX.Y.Z", or "release the module".
---

# release-cut

Cut a new release of the Community Screen module.

## When to use

The user wants to publish a new version. Triggers:

- "Cut a release" / "tag a release" / "release v0.1.13"
- "Bump the version and push the tag"
- "Ship this as v0.1.x"

## Inputs to confirm

Ask once via `AskUserQuestion` if not specified in the request:

1. **Release type** — `patch` / `minor` / `major`, **or** an explicit version string.
   Default suggestion: `patch` (matches the cadence of v0.1.10 → v0.1.11 → v0.1.12).
2. **Target branch** — usually the current branch. If the user is on a feature
   branch (e.g. `claude/*`), confirm they want to release from it; releases
   typically go from `main` or a maintenance branch.

## Steps

Run these **sequentially** — each depends on the previous.

### 1. Verify clean working tree

```bash
git status --porcelain
```

If non-empty, stop and report. Don't `stash` — that's destructive of intent.

### 2. Read current version

Both files must agree. Read `module.json` `.version` and `package.json` `.version`.
If they diverge, stop and report — the release-cut process assumes they're in lockstep.

### 3. Compute next version

From the user's choice:
- `patch`: `0.1.12` → `0.1.13`
- `minor`: `0.1.12` → `0.2.0`
- `major`: `0.1.12` → `1.0.0`
- explicit: use as given (validate `vX.Y.Z` shape)

### 4. Update both manifests

Use `Edit` to change the `"version"` string in each file. **Do not** reformat
the rest of the file — Prettier owns formatting.

- `module.json` — top-level `"version": "X.Y.Z"`
- `package.json` — top-level `"version": "X.Y.Z"`

### 5. Generate CHANGELOG.md entry

Get commits since the last tag:

```bash
git log $(git describe --tags --abbrev=0)..HEAD --pretty=format:'%s'
```

Group by Conventional Commit prefix into these sections (omit any that have
no entries):

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- <body of each `feat:` commit, capitalized, no prefix>

### Fixed
- <body of each `fix:` commit>

### Changed
- <body of each `refactor:` or `chore:` commit that's user-visible>

### Documentation
- <body of each `docs:` commit>
```

Skip `chore(release):` and `chore: bump` style commits — those are the
previous release commits themselves.

Insert the new entry at the top of `CHANGELOG.md`, immediately under the
file's title heading and above the previous release entry. Match the
indentation and bullet style of existing entries.

### 6. Commit, tag, push

```bash
git add module.json package.json CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"
git tag vX.Y.Z
git push -u origin <branch>
git push origin vX.Y.Z
```

If push fails with a network error, retry up to 4 times with exponential
backoff (2s, 4s, 8s, 16s). On any other failure, stop and report.

### 7. Verify

```bash
git log --oneline -3
git tag --list 'v*' | tail -3
```

Confirm the new tag is present and the commit message matches.

## Output

Report back:

- Old version → new version
- Commit hash of the release commit
- Tag name
- Branch pushed
- Summary of CHANGELOG.md sections written

## Things to never do

- **Never amend or rewrite history** (per `CLAUDE.md`). If something's wrong,
  cut another release (`vX.Y.Z+1`) — never `--amend` or `push --force`.
- **Never desync `module.json` and `package.json` versions** — they must match.
- **Never tag without an accompanying release commit** — the tag should point
  at a commit whose message is `chore(release): vX.Y.Z`.
- **Never push the tag before the branch** — the tag refers to the commit on
  the branch; pushing it first leaves a dangling ref on the remote.
- **Never skip the CHANGELOG.md entry** — the running history is part of the
  release contract.
