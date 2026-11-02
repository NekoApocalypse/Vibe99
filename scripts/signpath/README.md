# SignPath onboarding

Vibe99's Windows signing pilot builds an MSI on GitHub-hosted runners, submits
it to SignPath, and verifies both the installer and its embedded application.
Foundation acceptance, account setup, and a successful signed-build review are
still required. The normal release workflow remains unchanged until then.

## Application

Apply at <https://signpath.org/apply> using:

- Project: Vibe99
- Repository: <https://github.com/NekoApocalypse/Vibe99>
- License: GPL-3.0-or-later
- Releases: <https://github.com/NekoApocalypse/Vibe99/releases>
- Code signing policy: <https://github.com/NekoApocalypse/Vibe99/blob/main/CODE_SIGNING.md>
- Build system: public GitHub Actions on GitHub-hosted `windows-latest` runners
- Initial artifacts: Windows x64 MSI installer and its embedded `vibe99.exe`
- Maintainer/reviewer/approver: NekoApocalypse

The maintainer must confirm MFA is enabled on GitHub and SignPath. Do not assert
that Foundation approval or a publicly trusted certificate already exists.
Application contact details belong in the application, not this repository.

## After acceptance

1. Set up the SignPath account with MFA. Follow the Foundation's onboarding
   instructions for linking the GitHub repository and granting the minimum
   required GitHub App permissions.
2. Create the project, a production signing policy requiring manual maintainer
   approval, and an artifact configuration based on
   [artifact-configuration.xml](artifact-configuration.xml). Confirm the MSI
   content path using SignPath's artifact explorer; `**/vibe99.exe` must match
   exactly one file. Enforce the product name and release version.
3. Restrict SignPath origin verification to this repository, GitHub-hosted
   runners, the reviewed workflow, and release tags. Do not accept local
   uploads as substitutes for verified builds.
4. Save the submitter-only token in the GitHub Actions secret `SIGNPATH_API_TOKEN`.
   Do not paste tokens into chat, commit them, or grant the submitter approval
   rights. Set these repository variables using the values actually assigned
   by SignPath:

   - `SIGNPATH_ORGANIZATION_ID`
   - `SIGNPATH_PROJECT_SLUG`
   - `SIGNPATH_POLICY_SLUG`
   - `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`
   - `SIGNPATH_CERTIFICATE_SUBJECT` (exact subject from the approved public-trust
     certificate; not a self-signed trial certificate)

5. Run **Windows SignPath onboarding** with `inspect` on `main`. This exercises
   building and extracting the MSI without requesting a signature.
6. Prepare a new stable release tag containing this workflow. Run it on that
   tag with `sign`, review the request's origin/version/artifacts in SignPath,
   and manually approve. Review the `verified-signed-windows-msi` artifact and
   test installation, shell launch, upgrade, and uninstall on a clean Windows
   machine before enabling signed release publication.

## What this pilot does not do

- It does not publish or replace release assets automatically.
- It does not sign NSIS EXE installers. Those require signing the executable
  after Tauri's bundle-type patch and before packaging, plus the uninstaller and
  final installer; outer-only signing is insufficient. This is a separate
  integration to validate after MSI signing works.
- It does not sign upstream third-party DLLs with the project's certificate.
- It does not eliminate SmartScreen reputation checks or Defender detections.

## Local verification

After a normal Windows MSI build:

```powershell
./scripts/signpath/verify-msi.ps1 -MsiPath 'src-tauri/target/release/bundle/msi/Vibe99_0.7.3_x64_en-US.msi' -Version 0.7.3 -InspectUnsigned
```

For signed artifacts, omit `-InspectUnsigned` and supply the approved certificate
subject using `-ExpectedSignerSubject`. Verification fails on unsigned files.
WiX `dark.exe`, downloaded by Tauri's MSI build, extracts files without installing
or running the application. Temporary extraction directories are left in the
runner's temporary directory for diagnosis and disappear with the hosted runner.

References: [SignPath GitHub integration](https://docs.signpath.io/trusted-build-systems/github),
[MSI deep signing](https://docs.signpath.io/artifact-configuration/examples),
[Foundation conditions](https://signpath.org/terms).
