#!/bin/bash
# =============================================================
# NexaPOS — Deploy from this PC to the VPS
#
# Pushes main to GitHub, then SSHes into the VPS and runs the
# server-side update (update.sh / nexapos-update), which pulls the
# code, runs migrations, rebuilds the frontend and restarts services.
#
#   bash deploy-vps.sh              # push + deploy
#   bash deploy-vps.sh --setup-key  # one-time: log in with an SSH key
#                                   # instead of typing the password
#
# No passwords are stored here: SSH and sudo ask for them when
# needed. Override the target with VPS_HOST / VPS_USER if it moves.
# =============================================================
set -euo pipefail

VPS_HOST="${VPS_HOST:-208.110.72.189}"
VPS_USER="${VPS_USER:-administrator}"
APP_DIR="${APP_DIR:-/var/www/nexapos}"
BRANCH="${BRANCH:-main}"
TARGET="${VPS_USER}@${VPS_HOST}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

command -v git >/dev/null 2>&1 || error "git is not installed"
command -v ssh >/dev/null 2>&1 || error "ssh is not installed (run this from Git Bash)"

# ── One-time SSH key setup ───────────────────────────────────
if [ "${1:-}" = "--setup-key" ]; then
  KEY="${HOME}/.ssh/id_ed25519"
  if [ ! -f "${KEY}" ]; then
    info "Creating an SSH key at ${KEY}..."
    mkdir -p "${HOME}/.ssh"
    ssh-keygen -t ed25519 -f "${KEY}" -N "" -C "nexapos-deploy"
  fi
  info "Adding the key to ${TARGET} (enter the server password once)..."
  ssh "${TARGET}" 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys' < "${KEY}.pub"
  ok "Key installed — future deploys won't ask for the SSH password"
  exit 0
fi

# ── Push to GitHub ───────────────────────────────────────────
cd "$(dirname "$0")"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "${CURRENT_BRANCH}" = "${BRANCH}" ] || error "On branch '${CURRENT_BRANCH}' — switch to '${BRANCH}' first (the server deploys ${BRANCH})"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  warn "You have uncommitted changes — they will NOT be deployed:"
  git status --short --untracked-files=no
  read -r -p "Continue anyway? [y/N] " ANSWER
  [[ "${ANSWER}" =~ ^[Yy]$ ]] || exit 1
fi

info "Pushing ${BRANCH} to GitHub..."
git push origin "${BRANCH}"
DEPLOY_COMMIT="$(git rev-parse --short HEAD)"
ok "Pushed ${DEPLOY_COMMIT}"

# ── Run the update on the VPS ────────────────────────────────
# -t gives sudo a terminal so it can ask for the password there.
info "Deploying ${DEPLOY_COMMIT} to ${TARGET}..."
ssh -t "${TARGET}" "
  if command -v nexapos-update >/dev/null 2>&1; then
    sudo nexapos-update
  else
    sudo bash '${APP_DIR}/update.sh'
  fi
"

ok "Deployed ${DEPLOY_COMMIT} to ${VPS_HOST}"
