#!/bin/bash
# Build locally with an ad-hoc signature. No Apple account, sudo, or security changes.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'Run this script in a native arm64 terminal on an Apple Silicon Mac.' >&2
  exit 1
fi
if [[ $# -gt 1 || (${1:-} != '' && ${1:-} != '--install') ]]; then
  echo 'Usage: bash scripts/build-macos.sh [--install]' >&2
  exit 1
fi
xcode-select -p >/dev/null
for tool in node npm cargo rustc; do
  command -v "$tool" >/dev/null || { echo "Missing $tool; see docs/macos-install.md" >&2; exit 1; }
done
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22 || a===22&&b<13 || process.arch!=="arm64") { console.error("Use native arm64 Node.js 22.13 or newer"); process.exit(1); }'
rust_details="$(rustc -vV)"
if [[ "$rust_details" != *'host: aarch64-apple-darwin'* ]]; then
  echo 'Use the native aarch64-apple-darwin Rust toolchain.' >&2
  exit 1
fi
npm ci
# Ignore signing/notarization credentials inherited from another project.
env -u APPLE_CERTIFICATE -u APPLE_CERTIFICATE_PASSWORD -u APPLE_ID \
  -u APPLE_PASSWORD -u APPLE_TEAM_ID -u APPLE_API_KEY -u APPLE_API_ISSUER \
  -u APPLE_API_KEY_PATH APPLE_SIGNING_IDENTITY=- \
  npm run tauri:build -- --target aarch64-apple-darwin --bundles app -- --locked
bundle="$PWD/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Vibe99.app"
codesign --verify --deep --strict "$bundle"
file "$bundle/Contents/MacOS/vibe99"
if [[ ${1:-} == '--install' ]]; then
  destination="$HOME/Applications/Vibe99.app"
  mkdir -p "$HOME/Applications"
  if [[ -e "$destination" ]]; then
    echo "Existing app at $destination; quit it and move it aside before reinstalling." >&2
    echo "New verified bundle: $bundle"
    exit 1
  fi
  ditto "$bundle" "$destination"
  codesign --verify --deep --strict "$destination"
  bundle="$destination"
fi
printf 'Built and verified: %s\nOpen this bundle in Finder.\n' "$bundle"
