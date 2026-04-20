# Contributing To Vibe99

Vibe99 is a desktop terminal workspace for agentic coding. Contributions should preserve the product’s focus-first interaction model, keep the app buildable on current Electron tooling, and leave behind changelog notes that are clear enough for a human or an agent to review quickly.

## Local Setup

This repo currently builds and packages cleanly on Node 22, and local app/package commands enforce that requirement.

If you use `nvm`:

```bash
nvm use 22
```

Install dependencies:

```bash
npm install
```

Run the app in development:

```bash
npm start
```

Build packaged output for the current platform:

```bash
npm run package
npm run make
```

For Linux packaging on Debian or Ubuntu, install the required system tools first:

```bash
sudo apt install dpkg fakeroot
```

`npm run package` creates an unpackaged app bundle for the current platform.

`npm run make` creates installable artifacts for the current platform:

- macOS: local-only packaging output
- Windows: portable `.exe` and `.zip` output
- Linux: `.AppImage`, `.deb`, and `.zip`

RPM packaging is opt-in and only runs when `rpmbuild` is installed and `VIBE99_ENABLE_RPM=1` is set.

GitHub Releases currently target Linux and Windows. macOS release artifacts are paused until enough user demand justifies Apple signing and notarization costs.

## Changelog Rules

Vibe99 uses Towncrier with explicit fragment files. We do not use issue-numbered changelog fragments.

Every user-visible change should add exactly one fragment under `changes/` using this format:

- `+slug.feature.md`
- `+slug.bugfix.md`
- `+slug.doc.md`
- `+slug.removal.md`
- `+slug.misc.md`

Examples:

- `+mac-release.feature.md`
- `+pty-runtime.bugfix.md`

Fragment rules:

- Use a short stable slug after `+`. Keep it lowercase and use letters, numbers, `.`, `_`, or `-`.
- Write for end users, not for commit archaeology.
- Describe the visible outcome, not the implementation journey.
- Keep each fragment tight: usually one sentence, sometimes two.
- Do not paste commit messages, PR titles, stack traces, or internal refactor notes into fragments.
- If a change is purely internal and has no user-facing effect, do not add a release-note fragment just to satisfy process.

PRs are expected to contain at least one valid fragment file, and CI enforces that rule.

Good fragment:

```text
Packaged builds now spawn terminal sessions correctly on macOS.
```

Bad fragment:

```text
Refactor PTY bootstrap, fix helper path bug, update forge config, and try a different package because previous approach failed.
```

## Building The Changelog

Install Towncrier:

```bash
python3 -m pip install towncrier
```

Build the release notes into `CHANGELOG.md`:

```bash
python3 -m towncrier build --yes --version <version>
```

The release workflow extracts the matching section from `CHANGELOG.md`, so the generated entry should be readable on its own.

## Release Flow

The current GitHub release workflow is in `.github/workflows/release.yml`.

Important:

- Merging fragment files does not update `CHANGELOG.md` automatically.
- `CHANGELOG.md` only changes when someone explicitly runs `towncrier build --yes --version <version>` and commits the generated output.
- Do not cut a release tag until the generated changelog commit is already on `main`.

For a release:

1. Bump the version in `package.json`.
2. Add and review fragment files in `changes/`.
3. Build `CHANGELOG.md` with Towncrier.
4. Commit the release changes.
5. Create a matching tag such as `v0.2.0`.
6. Push the commit and tag.

Pushing a `v*` tag builds the Linux release artifacts and creates the GitHub release from them.

## Agentic Tools

Contributors are encouraged to use vibe-coding and agentic tools when they help move the project forward.

That is not a substitute for review. If you use an agent:

- read the diff before submitting it
- run the relevant build or packaging command yourself
- make sure the Towncrier fragment still reads like a product note, not generated sludge
- keep generated changes scoped to the task instead of mixing refactors into unrelated work

The acceptance bar is simple: another contributor should be able to review the diff and the changelog fragment quickly without reconstructing your prompting history.
