#!/usr/bin/env bash
[ -n "${BASH_VERSION:-}" ] || exec /usr/bin/env bash "$0" "$@"
set -eu
set -o pipefail

# =============================================================================
# Wave Hosting — remote / one-liner bootstrap (Ubuntu 22.04 / 24.04)
# =============================================================================
# Installs minimal packages, clones the repo (or uses current tree), optionally
# prompts to create infra/.env.deploy, then runs scripts/ubuntu-first-install.sh
# (Docker, compose down, rebuild, stack up, health checks).
#
# --- One-liner (public repo: https://github.com/OKiU-Network/bobshosting) ---
#   export WAVE_REPO_URL=https://github.com/OKiU-Network/bobshosting.git
#   curl -fsSL https://raw.githubusercontent.com/OKiU-Network/bobshosting/main/scripts/bootstrap.sh | sudo -E bash
# If curl returns 404: default branch may not be "main", or repo is private (clone first).
#
# Private repo: clone with a deploy key or PAT first, then:
#   cd /opt/wave-hosting && sudo bash scripts/bootstrap.sh
#
# Env (all optional):
#   WAVE_REPO_URL     — git URL to clone when not run from a checkout (required for curl|bash)
#   WAVE_CLONE_DIR    — default /opt/wave-hosting
#   WAVE_BRANCH       — default main
#   WAVE_NONINTERACTIVE=1 — no prompts; same as answering "no" to custom .env
#   WAVE_USE_WAN_FOR_PUBLIC_API=1 — auto PUBLIC_API_URL uses WAN (ipify); default is LAN/private IP only
#   WAVE_GIT_RESET=1 — if the clone diverged, reset hard to origin/WAVE_BRANCH (drops local commits on the clone)
#   WAVE_GIT_NO_AUTO_RESET=1 — if /opt/wave-hosting diverged from origin, abort instead of auto git reset --hard
#
# Use bash (not dash). For: curl ... | sudo bash
# =============================================================================

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
RST='\033[0m'

log() { echo -e "${GRN}[wave-bootstrap]${RST} $*"; }
warn() { echo -e "${YLW}[wave-bootstrap]${RST} $*"; }
err() { echo -e "${RED}[wave-bootstrap]${RST} $*" >&2; }

require_root() {
  if [[ "${EUID:-}" -ne 0 ]]; then
    err "Run as root: sudo bash $0   (use sudo -E to pass WAVE_* env vars)"
    exit 1
  fi
}

require_ubuntu() {
  if [[ ! -f /etc/os-release ]]; then
    err "/etc/os-release not found — this script targets Ubuntu."
    exit 1
  fi
  # shellcheck source=/dev/null
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    err "Detected ID=${ID:-unknown}. This script is written for Ubuntu."
    exit 1
  fi
  log "Ubuntu ${VERSION_ID:-?} (${VERSION_CODENAME:-?})"
}

minimal_apt() {
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl git gnupg openssl
}

invoked_from_pipe_or_stdin() {
  local p=${BASH_SOURCE[0]:-}
  # Pipe/curl installs often do not set BASH_SOURCE to "-"; stdin being a pipe is reliable.
  [[ -p /dev/stdin ]] || [[ "$p" == '-' ]] || [[ "$p" == '/dev/stdin' ]] || [[ "$p" == '/proc/self/fd/0' ]] \
    || [[ "$p" =~ ^/dev/fd/[0-9]+$ ]]
}

resolve_repo_root() {
  local script_path=${BASH_SOURCE[0]}
  if ! invoked_from_pipe_or_stdin; then
    local script_dir
    script_dir="$(cd "$(dirname "$script_path")" && pwd)"
    if [[ -f "${script_dir}/../infra/docker-compose.yml" ]]; then
      REPO_ROOT="$(cd "${script_dir}/.." && pwd)"
      log "Using existing checkout: ${REPO_ROOT}"
      return 0
    fi
  fi

  if [[ -z "${WAVE_REPO_URL:-}" ]]; then
    err "Not inside a repo checkout and WAVE_REPO_URL is unset."
    err "Set: export WAVE_REPO_URL=https://github.com/OKiU-Network/bobshosting.git"
    err "For private repos, clone manually (deploy key / PAT), then run: sudo bash scripts/bootstrap.sh"
    exit 1
  fi

  local dest="${WAVE_CLONE_DIR:-/opt/wave-hosting}"
  local branch="${WAVE_BRANCH:-main}"

  if [[ -d "${dest}/.git" ]]; then
    log "Updating existing clone: ${dest}"
    git config --global --add safe.directory "${dest}" 2>/dev/null || true
    git -C "${dest}" fetch --depth 1 origin "${branch}" 2>/dev/null || git -C "${dest}" fetch origin
    git -C "${dest}" checkout "${branch}" 2>/dev/null || true
    if git -C "${dest}" pull --ff-only "origin" "${branch}" 2>/dev/null; then
      :
    elif git -C "${dest}" pull --ff-only 2>/dev/null; then
      :
    else
      # Deploy clone should track GitHub (force-push, one-off server commits). Opt out only if you mean it.
      if [[ "${WAVE_GIT_NO_AUTO_RESET:-}" =~ ^(1|true|yes|YES)$ ]]; then
        case "${WAVE_GIT_RESET:-}" in
          1|true|yes|YES)
            warn "WAVE_GIT_RESET=1 — discarding local commits; resetting to origin/${branch}"
            git -C "${dest}" reset --hard "origin/${branch}"
            ;;
          *)
            err "Git fast-forward failed: ${dest} and origin/${branch} have diverged."
            err "Run: sudo git -C ${dest} fetch origin ${branch} && sudo git -C ${dest} reset --hard origin/${branch}"
            err "Or: export WAVE_GIT_RESET=1, or omit WAVE_GIT_NO_AUTO_RESET so bootstrap can auto-reset."
            exit 1
            ;;
        esac
      else
        warn "Clone diverged from origin/${branch} — resetting ${dest} to match GitHub."
        warn "To keep local commits on this machine: export WAVE_GIT_NO_AUTO_RESET=1 before bootstrap."
        git -C "${dest}" reset --hard "origin/${branch}"
      fi
    fi
  else
    log "Cloning ${WAVE_REPO_URL} → ${dest} (branch ${branch})…"
    install -d -m 755 "$(dirname "$dest")"
    if ! git clone --depth 1 -b "${branch}" "${WAVE_REPO_URL}" "${dest}" 2>/dev/null; then
      warn "Branch ${branch} clone failed — trying default remote HEAD…"
      git clone --depth 1 "${WAVE_REPO_URL}" "${dest}"
    fi
    git config --global --add safe.directory "${dest}" 2>/dev/null || true
  fi

  if [[ ! -f "${dest}/infra/docker-compose.yml" ]]; then
    err "Clone missing infra/docker-compose.yml — check WAVE_REPO_URL / branch."
    exit 1
  fi
  REPO_ROOT="${dest}"
}

# Same logic as ubuntu-first-install.sh (keep in sync for auto-detect)
is_private_ipv4() {
  local a=$1
  [[ -z "$a" || "$a" =~ ^127\. ]] && return 1
  [[ "$a" =~ ^10\. ]] && return 0
  [[ "$a" =~ ^192\.168\. ]] && return 0
  [[ "$a" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && return 0
  return 1
}

route_src_ipv4() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1); exit}'
}

detect_public_api_url() {
  if [[ -n "${PUBLIC_API_URL:-}" ]]; then
    echo "${PUBLIC_API_URL}"
    return
  fi
  local ip w
  for w in $(hostname -I 2>/dev/null); do
    if is_private_ipv4 "$w"; then
      echo "http://${w}:4000"
      return
    fi
  done
  ip=$(route_src_ipv4)
  if [[ -n "$ip" ]] && is_private_ipv4 "$ip"; then
    echo "http://${ip}:4000"
    return
  fi
  case "${WAVE_USE_WAN_FOR_PUBLIC_API:-}" in
    1|true|yes|YES)
      ip=$(curl -4sSf --connect-timeout 5 https://api.ipify.org 2>/dev/null || true)
      if [[ -n "$ip" ]] && [[ "$ip" =~ ^[0-9.]+$ ]]; then
        echo "http://${ip}:4000"
        return
      fi
      ;;
  esac
  ip=$(route_src_ipv4)
  if [[ -n "$ip" ]]; then
    echo "http://${ip}:4000"
    return
  fi
  for w in $(hostname -I 2>/dev/null); do
    [[ "$w" =~ ^127\. ]] && continue
    echo "http://${w}:4000"
    return
  done
  echo "http://127.0.0.1:4000"
}

write_env_deploy() {
  local root=$1 jwt=$2 pg=$3 pub=$4
  local f="${root}/infra/.env.deploy"
  umask 077
  install -d -m 700 "${root}/infra"
  cat >"$f" <<EOF
# Generated by scripts/bootstrap.sh — do not commit (gitignored).
COMPOSE_PROJECT_NAME=wavehosting
JWT_SECRET=${jwt}
POSTGRES_PASSWORD=${pg}
PUBLIC_API_URL=${pub}
EOF
  chmod 600 "$f"
  log "Wrote ${f}"
}

maybe_prompt_custom_env() {
  local root=$1
  local env_file="${root}/infra/.env.deploy"

  case "${WAVE_NONINTERACTIVE:-}" in
    1|true|yes|YES)
      log "WAVE_NONINTERACTIVE=${WAVE_NONINTERACTIVE} — skipping .env prompts (installer defaults)."
      return 0
      ;;
  esac

  if [[ ! -t 0 ]] || [[ ! -t 1 ]]; then
    log "No TTY — skipping .env prompts (installer defaults)."
    return 0
  fi

  echo ""
  read -r -p "Customize secrets and PUBLIC_API_URL (.env.deploy) now? [y/N] " answer </dev/tty || true
  if [[ ! "${answer:-}" =~ ^[Yy] ]]; then
    log "Using installer defaults for .env.deploy (auto secrets + API URL detect)."
    return 0
  fi

  local j p u
  read -r -p "JWT_SECRET (Enter for random): " j </dev/tty || j=""
  read -r -sp "POSTGRES_PASSWORD (Enter for random): " p </dev/tty || p=""
  printf '\n' >/dev/tty || true
  read -r -p "PUBLIC_API_URL e.g. http://203.0.113.5:4000 (Enter for auto-detect): " u </dev/tty || u=""

  [[ -z "$j" ]] && j=$(openssl rand -hex 32)
  [[ -z "$p" ]] && p=$(openssl rand -hex 24)
  [[ -z "$u" ]] && u=$(detect_public_api_url)

  write_env_deploy "$root" "$j" "$p" "$u"
}

main() {
  require_root
  require_ubuntu
  minimal_apt

  local REPO_ROOT
  resolve_repo_root

  maybe_prompt_custom_env "$REPO_ROOT"

  log "Starting full install (Docker + stack)…"
  exec /usr/bin/env bash "${REPO_ROOT}/scripts/ubuntu-first-install.sh"
}

main "$@"
