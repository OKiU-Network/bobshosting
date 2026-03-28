#!/usr/bin/env bash
# Force bash first — CRLF or `sh` breaks `pipefail` before this ran when the guard lived below long comments.
[ -n "${BASH_VERSION:-}" ] || exec /usr/bin/env bash "$0" "$@"
set -eu
set -o pipefail

# =============================================================================
# Wave Hosting — Ubuntu first-time install (22.04 / 24.04 LTS)
# =============================================================================
# End-to-end: installs Docker, generates secrets, removes any existing Wave compose
# containers (project wavehosting), rebuilds images with --no-cache, starts the stack,
# waits until API + panel respond. Named volumes (Postgres, API data, server files) are kept
# unless you use "docker compose … down -v".
#
# Prerequisites: this repository already on the server — or use scripts/bootstrap.sh
# (clone + optional .env prompts + this script).
#
#   cd /path/to/Hosting
#   sudo bash scripts/ubuntu-first-install.sh
#
# One-liner (set your repo URL): see scripts/bootstrap.sh header.
#
# Optional: force the browser→API URL used when building the web image (LAN IP, domain):
#   export PUBLIC_API_URL=http://203.0.113.10:4000
#   sudo -E bash scripts/ubuntu-first-install.sh
#
# Re-runs: if infra/.env.deploy already exists, its secrets are reused so Postgres data
# volumes stay valid. For a full wipe: docker compose -p wavehosting -f infra/docker-compose.yml down -v
#   && rm -f infra/.env.deploy && run this script again.
#
# If you see "set: pipefail: invalid option", the file has Windows CRLF — run:
#   sed -i 's/\r$//' scripts/ubuntu-first-install.sh
# Repo uses .gitattributes so fresh git checkouts use LF.
# =============================================================================

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
RST='\033[0m'

log() { echo -e "${GRN}[wave-install]${RST} $*"; }
warn() { echo -e "${YLW}[wave-install]${RST} $*"; }
err() { echo -e "${RED}[wave-install]${RST} $*" >&2; }

require_root() {
  if [[ "${EUID:-}" -ne 0 ]]; then
    err "Run as root: sudo bash $0"
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker-compose.yml"
ENV_FILE="${REPO_ROOT}/infra/.env.deploy"

install_packages() {
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl gnupg openssl git
}

install_docker_official() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker Engine + Compose plugin already installed."
    docker --version
    docker compose version
    return 0
  fi

  log "Installing Docker Engine + Compose plugin (official Docker apt repository)…"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  # shellcheck source=/dev/null
  source /etc/os-release
  local codename="${UBUNTU_CODENAME:-$VERSION_CODENAME}"

  tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${codename}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  systemctl enable --now docker
  docker --version
  docker compose version
}

add_deploy_user_to_docker_group() {
  local u="${SUDO_USER:-}"
  if [[ -n "$u" ]] && id "$u" &>/dev/null; then
    usermod -aG docker "$u"
    log "Added '$u' to group 'docker' (re-login to use docker without sudo)."
  fi
}

maybe_open_ufw() {
  if command -v ufw >/dev/null 2>&1; then
    if ufw status 2>/dev/null | grep -qi 'Status: active'; then
      ufw allow 3000/tcp comment 'wave web' >/dev/null   || true
      ufw allow 4000/tcp comment 'wave api' >/dev/null   || true
      ufw allow 7001/tcp comment 'wave agent' >/dev/null || true
      log "ufw is active — allowed TCP 3000, 4000, 7001."
    fi
  fi
}

detect_public_api_url() {
  if [[ -n "${PUBLIC_API_URL:-}" ]]; then
    echo "${PUBLIC_API_URL}"
    return
  fi
  local ip
  ip=$(curl -4sSf --connect-timeout 5 https://api.ipify.org 2>/dev/null || true)
  if [[ -n "$ip" ]] && [[ "$ip" =~ ^[0-9.]+$ ]]; then
    echo "http://${ip}:4000"
    return
  fi
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1); exit}' || true)
  if [[ -n "$ip" ]]; then
    echo "http://${ip}:4000"
    return
  fi
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo "http://${ip:-127.0.0.1}:4000"
}

panel_base_url() {
  local api=$1
  echo "${api/:4000/:3000}"
}

write_env_file() {
  local jwt=$1
  local pg=$2
  local pub=$3
  umask 077
  install -d -m 700 "$(dirname "$ENV_FILE")"
  cat >"$ENV_FILE" <<EOF
# Generated by scripts/ubuntu-first-install.sh — do not commit (gitignored).
COMPOSE_PROJECT_NAME=wavehosting
JWT_SECRET=${jwt}
POSTGRES_PASSWORD=${pg}
PUBLIC_API_URL=${pub}
EOF
  chmod 600 "$ENV_FILE"
  log "Wrote ${ENV_FILE}"
}

verify_repo() {
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    err "Missing ${COMPOSE_FILE}. Run this script from a checkout of the Wave Hosting repo."
    exit 1
  fi
}

wait_for_http_200() {
  local url=$1
  local label=$2
  local max_attempts=${3:-90}
  local i=0
  while [[ $i -lt $max_attempts ]]; do
    if curl -fsSL --connect-timeout 2 --max-time 8 "$url" >/dev/null 2>&1; then
      log "${label} OK — ${url}"
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  err "${label} did not become ready in time: ${url}"
  (cd "$REPO_ROOT" && docker compose -p wavehosting --env-file infra/.env.deploy -f infra/docker-compose.yml logs --tail 120) || true
  exit 1
}

remove_existing_wave_containers() {
  cd "$REPO_ROOT"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  log "Stopping and removing existing Wave Hosting containers (compose project wavehosting)…"
  docker compose -p wavehosting --env-file infra/.env.deploy -f infra/docker-compose.yml down --remove-orphans 2>/dev/null || true
}

deploy_stack() {
  cd "$REPO_ROOT"
  remove_existing_wave_containers

  log "Rebuilding images from scratch (--no-cache; can take several minutes)…"
  docker compose -p wavehosting --env-file infra/.env.deploy -f infra/docker-compose.yml build --no-cache

  log "Starting containers…"
  docker compose -p wavehosting --env-file infra/.env.deploy -f infra/docker-compose.yml up -d

  wait_for_http_200 'http://127.0.0.1:4000/v1/health' 'API'
  wait_for_http_200 'http://127.0.0.1:7001/health' 'Node agent'
  wait_for_http_200 'http://127.0.0.1:3000/' 'Web panel'
}

print_done() {
  local api_url=$1
  local panel_url=$2
  cat <<EOF

${GRN}== Wave Hosting is running ==${RST}
  Panel:  ${panel_url}
  API:    ${api_url}
  Agent:  http://127.0.0.1:7001/health (host)

  Default login: ${YLW}admin@local.dev${RST} / ${YLW}admin123${RST}
  Change the admin password after first login.

  Secrets file (backup securely): ${ENV_FILE}
  Data volumes: docker volume ls | grep wavehosting

EOF
}

main() {
  require_root
  require_ubuntu
  verify_repo

  install_packages
  install_docker_official
  add_deploy_user_to_docker_group
  maybe_open_ufw

  local api_url panel_url
  if [[ -f "$ENV_FILE" ]]; then
    log "Reusing existing ${ENV_FILE} (delete it to generate new secrets and match fresh volumes)."
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    if [[ -z "${JWT_SECRET:-}" || -z "${POSTGRES_PASSWORD:-}" || -z "${PUBLIC_API_URL:-}" ]]; then
      err "${ENV_FILE} must define JWT_SECRET, POSTGRES_PASSWORD, and PUBLIC_API_URL"
      exit 1
    fi
    api_url=$PUBLIC_API_URL
  else
    api_url=$(detect_public_api_url)
    log "PUBLIC_API_URL for web build (browser → API): ${api_url}"
    write_env_file "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" "$api_url"
  fi

  panel_url=$(panel_base_url "$api_url")

  deploy_stack
  print_done "$api_url" "$panel_url"
}

main "$@"
