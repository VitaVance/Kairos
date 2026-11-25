#!/usr/bin/env bash
# Build the Tauri desktop installers (.msi + NSIS -setup.exe) and list artifacts.
#
# Usage:
#   bash scripts/build-desktop.sh              # both msi + nsis (from tauri.conf.json)
#   bash scripts/build-desktop.sh msi
#   bash scripts/build-desktop.sh nsis
#
# Requires: node, pnpm, Rust (cargo/rustc, MSVC toolchain). See docs/PACKAGING.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUNDLE_TARGET="${1:-}"
BUNDLE_DIR="$ROOT/apps/desktop/src-tauri/target/release/bundle"

echo "==> repo: $ROOT"

echo "==> preflight (toolchain check)"
if ! node scripts/check-toolchain.mjs; then
  echo
  echo "Preflight failed. Install the missing tools (see output above) and re-run." >&2
  exit 1
fi

echo
echo "==> pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

# The updater signature.
#
# `bundle.createUpdaterArtifacts` is on, so every build must also produce a
# `.sig` over each installer. Without a private key Tauri produces the
# installers and *then* fails with "A public key has been found, but no private
# key" — which looks like a broken build even though the artifacts exist.
#
# Prefer an explicit env var (CI), else fall back to the default key location
# that `npx tauri signer generate` writes to.
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  DEFAULT_KEY="${HOME}/.tauri/todolist.key"
  if [ -f "$DEFAULT_KEY" ]; then
    export TAURI_SIGNING_PRIVATE_KEY="$(cat "$DEFAULT_KEY")"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
    echo "==> updater signing key: $DEFAULT_KEY"
  else
    echo
    echo "!! No updater signing key found." >&2
    echo "   Generate one once:  npx tauri signer generate -w \$HOME/.tauri/todolist.key" >&2
    echo "   Then put its PUBLIC key in tauri.conf.json -> plugins.updater.pubkey." >&2
    echo "   (Set TAURI_SIGNING_PRIVATE_KEY to use a different key.)" >&2
    exit 1
  fi
fi

echo
case "$BUNDLE_TARGET" in
  "")     echo "==> pnpm desktop:build (msi + nsis)"; pnpm desktop:build ;;
  msi)    echo "==> pnpm desktop:build:msi";         pnpm desktop:build:msi ;;
  nsis)   echo "==> pnpm desktop:build:nsis";        pnpm desktop:build:nsis ;;
  *)      echo "Unknown bundle target: $BUNDLE_TARGET (expected: msi | nsis | empty)" >&2; exit 2 ;;
esac

echo
echo "==> artifacts"
found=0
for dir in "$BUNDLE_DIR"/msi "$BUNDLE_DIR"/nsis; do
  [ -d "$dir" ] || continue
  while IFS= read -r -d '' f; do
    found=1
    size=$(du -h "$f" | cut -f1)
    printf '  %-10s %s\n' "$size" "$f"
  done < <(find "$dir" -maxdepth 1 -type f \( -name '*.msi' -o -name '*-setup.exe' \) -print0 2>/dev/null)
done

if [ "$found" -eq 0 ]; then
  echo "  (no installers found under $BUNDLE_DIR — build may have failed)" >&2
  exit 1
fi

echo
echo "==> portable exe (no installer): apps/desktop/src-tauri/target/release/todolist.exe"
echo "DONE"
