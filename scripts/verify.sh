#!/usr/bin/env bash
# Full verification gate. CI runs the same steps (see .github/workflows/ci.yml).
# Usage: bash scripts/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> architecture boundaries"
pnpm deps:check

echo "==> typecheck (all packages)"
pnpm -r typecheck

echo "==> tests (packages with tests)"
pnpm -r test

echo "==> production web build"
pnpm --filter @todolist/desktop build

echo "ALL GREEN"
