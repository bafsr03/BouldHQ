#!/usr/bin/env bash
# BouldHQ release script.
#
# Bumps app/src-tauri/tauri.conf.json version, builds a SIGNED Tauri bundle,
# and creates a GitHub Release at bafsr03/BouldHQ with:
#   - BouldHQ_<v>_<arch>.dmg                 (installer)
#   - BouldHQ_<v>_<arch>.app.tar.gz          (updater payload)
#   - BouldHQ_<v>_<arch>.app.tar.gz.sig      (signature, verified on client)
#   - latest.json                            (manifest the app polls)
#
# Once this runs, every installed BouldHQ app (current + future installs of
# a version >= 1.8.8) auto-detects the new release on next boot and prompts
# the user to install.
#
# Usage:
#   ./scripts/release.sh patch        # 1.8.8 -> 1.8.9
#   ./scripts/release.sh minor        # 1.8.8 -> 1.9.0
#   ./scripts/release.sh major        # 1.8.8 -> 2.0.0
#   ./scripts/release.sh 1.8.10       # set explicit version
#
# Prereqs (one-time):
#   - brew install gh && gh auth login
#   - ~/.tauri/bouldhq_updater.key (private signing key)
#   - ~/.tauri/bouldhq_updater.key.pass (password)
#   - Apple Silicon machine (this script builds arm64 only by default)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
TAURI_DIR="$APP_DIR/src-tauri"
CONF="$TAURI_DIR/tauri.conf.json"
KEY_PATH="$HOME/.tauri/bouldhq_updater.key"
PASS_PATH="$HOME/.tauri/bouldhq_updater.key.pass"
GH_REPO="bafsr03/BouldHQ"

# ---- 1. Preflight ------------------------------------------------------------

err() { echo "❌ $*" >&2; exit 1; }
info() { echo "→ $*"; }

[[ -f "$KEY_PATH" ]]  || err "Signing key not found at $KEY_PATH. Run: bun run tauri signer generate -w $KEY_PATH"
[[ -f "$PASS_PATH" ]] || err "Password file not found at $PASS_PATH"
command -v gh >/dev/null || err "GitHub CLI not installed. brew install gh"
gh auth status >/dev/null 2>&1 || err "GitHub CLI not authenticated. Run: gh auth login"
command -v jq >/dev/null || err "jq required. brew install jq"

# ---- 2. Compute next version -------------------------------------------------

CUR=$(jq -r '.version' "$CONF")
BUMP="${1:-patch}"

case "$BUMP" in
  patch|minor|major)
    IFS='.' read -r MA MI PA <<< "$CUR"
    case "$BUMP" in
      patch) PA=$((PA + 1)) ;;
      minor) MI=$((MI + 1)); PA=0 ;;
      major) MA=$((MA + 1)); MI=0; PA=0 ;;
    esac
    NEW="${MA}.${MI}.${PA}"
    ;;
  [0-9]*.[0-9]*.[0-9]*)
    NEW="$BUMP"
    ;;
  *)
    err "Usage: $0 [patch|minor|major|<x.y.z>]"
    ;;
esac

info "Releasing $CUR → $NEW"

# ---- 3. Bump version in config -----------------------------------------------

tmp=$(mktemp)
jq --arg v "$NEW" '.version = $v' "$CONF" > "$tmp" && mv "$tmp" "$CONF"
info "Wrote version $NEW to $CONF"

# ---- 4. Build signed bundle --------------------------------------------------

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$PASS_PATH")"

info "Building signed bundle (this is the slow part)..."
( cd "$APP_DIR" && bun run tauri:desktop:build )

# Detect the arch (aarch64 on M-series, x86_64 on Intel).
ARCH=$(uname -m); [[ "$ARCH" == "arm64" ]] && ARCH=aarch64
BUNDLE_DIR="$TAURI_DIR/target/release/bundle"
DMG="$BUNDLE_DIR/dmg/BouldHQ_${NEW}_${ARCH}.dmg"
TARBALL="$BUNDLE_DIR/macos/BouldHQ.app.tar.gz"
SIG="$BUNDLE_DIR/macos/BouldHQ.app.tar.gz.sig"

[[ -f "$DMG" ]]     || err "Expected DMG missing: $DMG"
[[ -f "$TARBALL" ]] || err "Expected tarball missing: $TARBALL"
[[ -f "$SIG" ]]     || err "Expected signature missing: $SIG — is the signing key configured?"

# Rename payload to include version (we'll upload with this exact name).
PAYLOAD="$BUNDLE_DIR/macos/BouldHQ_${NEW}_${ARCH}.app.tar.gz"
PAYLOAD_SIG="$PAYLOAD.sig"
cp "$TARBALL" "$PAYLOAD"
cp "$SIG" "$PAYLOAD_SIG"

# ---- 5. Build latest.json ----------------------------------------------------

SIG_CONTENT="$(cat "$PAYLOAD_SIG")"
PUB_URL="https://github.com/${GH_REPO}/releases/download/v${NEW}/$(basename "$PAYLOAD")"
LATEST_JSON="$BUNDLE_DIR/latest.json"

cat > "$LATEST_JSON" <<JSON
{
  "version": "${NEW}",
  "notes": "BouldHQ ${NEW}",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-${ARCH}": {
      "signature": "${SIG_CONTENT}",
      "url": "${PUB_URL}"
    }
  }
}
JSON

info "Wrote $LATEST_JSON"

# ---- 6. Commit + tag (optional — only if the working tree is clean) ---------

if git -C "$REPO_ROOT" diff --quiet -- "$CONF" 2>/dev/null; then
  : # no version change committed yet, that's fine
fi
git -C "$REPO_ROOT" add "$CONF"
if ! git -C "$REPO_ROOT" diff --cached --quiet; then
  git -C "$REPO_ROOT" commit -m "chore(release): v${NEW}"
fi

TAG="v${NEW}"
if git -C "$REPO_ROOT" rev-parse "$TAG" >/dev/null 2>&1; then
  info "Tag $TAG already exists, skipping tag creation"
else
  git -C "$REPO_ROOT" tag -a "$TAG" -m "BouldHQ $TAG"
fi

# Push tag + commit so GitHub has the source state for this release.
git -C "$REPO_ROOT" push origin HEAD --tags || info "(push skipped — fix and push manually)"

# ---- 7. Cut GitHub release ---------------------------------------------------

info "Creating GitHub release $TAG..."
gh release create "$TAG" \
  --repo "$GH_REPO" \
  --title "BouldHQ ${NEW}" \
  --notes "Auto-update build. See commit log for details." \
  "$DMG" \
  "$PAYLOAD" \
  "$PAYLOAD_SIG" \
  "$LATEST_JSON" \
  2>&1 || err "gh release create failed. The build artifacts are still in $BUNDLE_DIR — you can upload manually."

info "✅ Released v${NEW}"
info "   DMG : $DMG"
info "   Manifest: https://github.com/${GH_REPO}/releases/latest/download/latest.json"
info ""
info "Installed apps will pick up this version on next boot (after the 3s grace period in useAutoUpdate)."
