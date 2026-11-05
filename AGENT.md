# AGENT.md

Vibe99 uses explicit Towncrier fragment files and a manual release-prep commit. Agents should treat release notes as part of the product surface: add `changes/+slug.type.md` fragments in normal PRs, and only update `CHANGELOG.md` when explicitly preparing a release by running `towncrier build --yes --version <version>` and committing the generated result before tagging.

When preparing a production Windows release on the local workstation, also run `scripts/stage-local-release.ps1` against the verified production executable. This refreshes `artifacts/release/Vibe99.lnk` and its stable executable target so existing taskbar pins launch the new local release. Never stage a review build or stop existing user sessions to refresh it. See `docs/local-release-shortcut.md`.

## Document Writing Rule

All entry documents must open with a BLUF (bottom line up front) that requires no prior context.

The first paragraph should allow a zero-context reader to understand:

- what we are building or discussing
- who it is for, when relevant
- why it exists or what problem it solves

Do not assume the reader has read any other document first.

Exception:

Sub-documents may omit a cold-context BLUF only if they explicitly expect the reader to arrive from another document or are clearly framed as subordinate material.
