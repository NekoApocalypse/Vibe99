# Code signing policy

Vibe99 is an open-source Windows-first terminal workspace maintained by
[NekoApocalypse](https://github.com/NekoApocalypse). This policy describes how
Windows release signatures will identify verified builds of this repository.
**SignPath onboarding is pending; v0.7.3 and earlier Windows releases are unsigned.**

## Provider and scope

We are applying for free code signing provided by
[SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org). This is a proposed integration, not
a claim of Foundation acceptance or an already-issued certificate.

The initial scope is the Windows x64 MSI installer and the Vibe99 executable
inside it. SignPath's MSI deep-signing operation signs the executable first,
then repackages and signs the installer. Third-party components are not signed
under Vibe99's identity. NSIS EXE installers are outside the initial signing
scope: signing their outer wrapper alone does not sign the installed program.

## Team and approval

- Committer, reviewer, and signing approver:
  [NekoApocalypse](https://github.com/NekoApocalypse).
- Contributions from other authors require a maintainer review before release.
- Maintainers must use multi-factor authentication on GitHub and SignPath before
  production signing is enabled.
- Every production signing request requires the maintainer's manual approval in
  SignPath. Possession of the CI submission token does not grant approval rights.

## Build provenance and verification

Signing requests must originate from the public GitHub Actions workflow in this
repository, on GitHub-hosted Windows runners. Production requests are restricted
to stable version tags whose commits are on `main`; tag and package versions
must match. Artifacts are uploaded to GitHub Actions before SignPath retrieves
them for origin verification.

The signing configuration restricts the application product name and version.
The workflow verifies trusted, timestamped Authenticode signatures on both the
returned MSI and its extracted application, including the expected publisher
subject. A missing signature, mismatched publisher, timeout, or rejected request
fails the signing run; it never produces a successful signed-release artifact.

The onboarding workflow produces a review artifact, not a public release. A
maintainer must review the first signed build before switching release
distribution to it. Existing releases are not silently replaced. Signing does
not guarantee immediate Microsoft SmartScreen reputation.

## Privacy

Vibe99 has no application telemetry or analytics endpoint. Terminal sessions,
shell profiles, and display preferences are stored locally. Shells, SSH sessions,
coding agents, and links opened by the user can communicate with services the
user chooses; those programs and services have their own privacy policies.

The Windows installer can download Microsoft WebView2 if it is missing.
WebView2 is a Microsoft system runtime with its own update and diagnostic
behavior, covered by the [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).
Downloading releases and signing build artifacts also involves GitHub and
SignPath; this does not transmit users' terminal contents to either service.

Maintainer setup instructions: [SignPath onboarding](scripts/signpath/README.md).
