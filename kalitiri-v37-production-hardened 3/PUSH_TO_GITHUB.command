#!/bin/bash
set -euo pipefail

REPO_URL="https://github.com/tusharkumarnayak24cse-bit/kalinitidi.git"
BRANCH="main"
TARGET_DIR="kalitiri-v34-clear-trick-zone"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(mktemp -d -t kalitiri-v37-push.XXXXXX)"
CLONE_DIR="$WORK_DIR/kalinitidi"

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

printf '\nKaali Ni Tidi v3.7.0 — GitHub updater\n'
printf 'Repository: %s\n' "$REPO_URL"
printf 'Render root directory kept as: %s\n\n' "$TARGET_DIR"

command -v git >/dev/null 2>&1 || { echo "Git is required. Install Xcode Command Line Tools with: xcode-select --install"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Node.js/npm is required before pushing because tests are run first."; exit 1; }

cd "$PROJECT_DIR"
echo "Running v3.7 tests..."
npm install --no-audit --no-fund
npm test

echo "Cloning current repository..."
git clone --branch "$BRANCH" "$REPO_URL" "$CLONE_DIR"

cd "$CLONE_DIR"
echo "Updating only $TARGET_DIR so the existing Render service keeps working..."
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

# Copy the hardened release into the directory Render already deploys.
rsync -a \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude 'PUSH_TO_GITHUB.command~' \
  "$PROJECT_DIR"/ "$TARGET_DIR"/

cd "$TARGET_DIR"
echo "Installing dependencies and testing the clean deploy tree..."
rm -rf node_modules
npm install --no-audit --no-fund
npm test
cd "$CLONE_DIR"

git add -A "$TARGET_DIR"
if git diff --cached --quiet; then
  echo "No changes to push. The deployed folder already matches v3.7.0."
  exit 0
fi

git commit -m "Release Kaali Ni Tidi v3.7.0 production hardening"
echo "Pushing to GitHub. GitHub may ask you to authenticate in Terminal/browser."
git push origin "$BRANCH"

echo
echo "Success: v3.7.0 pushed into $TARGET_DIR"
echo "Render auto-deploy should start automatically from branch $BRANCH."
