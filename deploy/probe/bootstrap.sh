#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
export LC_ALL=C

PROBE_VERSION="1.0.1"
CONTROL_URL="https://units.sslping.io"
PROBE_PORT="${SSLPING_PROBE_PORT:-}"
PROBE_CONCURRENCY="${SSLPING_PROBE_CONCURRENCY:-}"
BINARY_URL="${SSLPING_PROBE_BINARY_URL:-}"
EXPECTED_SHA256="${SSLPING_PROBE_SHA256:-}"
HEALTH_ALLOW="${SSLPING_HEALTH_ALLOW:-}"
REPOSITORY="mitrohin/sslping-dashboard"
ROTATE_KEY=0

usage() {
  cat <<'USAGE'
Usage:
  sudo bash bootstrap.sh [options]

Options:
  --port PORT            Health-only TCP port (default: 8443; minimum: 1024)
  --health-allow CIDR    Expose health to one IPv4/IPv6 CIDR
  --health-allow any     Expose health publicly (not recommended)
                         (default: loopback only; no inbound firewall rule)
  --concurrency N        Concurrent checks (default: 4; range: 1-256)
  --binary-url URL       Override the release binary HTTPS URL
  --sha256 HEX           Expected binary SHA-256 (otherwise URL.sha256 is fetched)
  --rotate-key           Generate a new probe key instead of preserving the old key
  -h, --help             Show this help

The probe claims tasks and submits results over outbound HTTPS. The local
health port serves only /health/live and /health/ready; it is not a control port.
USAGE
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

warn() {
  echo "WARNING: $*" >&2
}

require_option_value() {
  local option="$1"
  local count="$2"
  (( count >= 2 )) || die "${option} requires a value."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      require_option_value "$1" "$#"
      PROBE_PORT="$2"
      shift 2
      ;;
    --port=*) PROBE_PORT="${1#*=}"; shift ;;
    --health-allow)
      require_option_value "$1" "$#"
      HEALTH_ALLOW="$2"
      shift 2
      ;;
    --health-allow=*) HEALTH_ALLOW="${1#*=}"; shift ;;
    --concurrency)
      require_option_value "$1" "$#"
      PROBE_CONCURRENCY="$2"
      shift 2
      ;;
    --concurrency=*) PROBE_CONCURRENCY="${1#*=}"; shift ;;
    --binary-url)
      require_option_value "$1" "$#"
      BINARY_URL="$2"
      shift 2
      ;;
    --binary-url=*) BINARY_URL="${1#*=}"; shift ;;
    --sha256)
      require_option_value "$1" "$#"
      EXPECTED_SHA256="$2"
      shift 2
      ;;
    --sha256=*) EXPECTED_SHA256="${1#*=}"; shift ;;
    --rotate-key) ROTATE_KEY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  die "Run this installer as root (sudo)."
fi

ENV_FILE="/etc/sslping-probe/probe.env"
read_existing_setting() {
  local name="$1"
  [[ -r "${ENV_FILE}" ]] || return 0
  awk -F= -v name="${name}" '$1 == name {sub(/^[^=]*=/, ""); print; exit}' "${ENV_FILE}"
}

# A rerun should retain the settings that identify the already registered
# point unless the operator explicitly supplies replacements.
if [[ -z "${PROBE_PORT}" ]]; then PROBE_PORT="$(read_existing_setting SSLPING_PROBE_PORT)"; fi
if [[ -z "${PROBE_CONCURRENCY}" ]]; then PROBE_CONCURRENCY="$(read_existing_setting SSLPING_PROBE_CONCURRENCY)"; fi
if [[ -z "${HEALTH_ALLOW}" ]]; then HEALTH_ALLOW="$(read_existing_setting SSLPING_HEALTH_ALLOW)"; fi
PROBE_PORT="${PROBE_PORT:-8443}"
PROBE_CONCURRENCY="${PROBE_CONCURRENCY:-4}"
HEALTH_ALLOW="${HEALTH_ALLOW:-local}"

if [[ ! "${CONTROL_URL}" =~ ^https:// ]] || [[ ${#CONTROL_URL} -gt 2048 ]]; then
  die "The pinned control-plane URL must be an HTTPS URL no longer than 2048 characters."
fi
if [[ "${CONTROL_URL}" == *$'\n'* || "${CONTROL_URL}" == *$'\r'* || "${CONTROL_URL}" == *$'\t'* || "${CONTROL_URL}" == *" "* || "${CONTROL_URL}" == *\"* || "${CONTROL_URL}" == *"'"* || "${CONTROL_URL}" == *\\* ]]; then
  die "The pinned control-plane URL contains characters that cannot be stored safely."
fi
if [[ "${CONTROL_URL}" == *\?* || "${CONTROL_URL}" == *\#* ]]; then
  die "The pinned control-plane URL must not contain a query string or fragment."
fi
CONTROL_AUTHORITY="${CONTROL_URL#https://}"
CONTROL_AUTHORITY="${CONTROL_AUTHORITY%%/*}"
if [[ -z "${CONTROL_AUTHORITY}" || "${CONTROL_AUTHORITY}" == *@* ]]; then
  die "The pinned control-plane URL must contain a host and no user credentials."
fi
if [[ ! "${PROBE_PORT}" =~ ^[0-9]+$ ]] || (( ${#PROBE_PORT} > 5 )); then
  die "--port must be between 1024 and 65535."
fi
PROBE_PORT=$((10#${PROBE_PORT}))
if (( PROBE_PORT < 1024 || PROBE_PORT > 65535 )); then
  die "--port must be between 1024 and 65535."
fi
if [[ ! "${PROBE_CONCURRENCY}" =~ ^[0-9]+$ ]] || (( ${#PROBE_CONCURRENCY} > 3 )); then
  die "--concurrency must be between 1 and 256."
fi
PROBE_CONCURRENCY=$((10#${PROBE_CONCURRENCY}))
if (( PROBE_CONCURRENCY < 1 || PROBE_CONCURRENCY > 256 )); then
  die "--concurrency must be between 1 and 256."
fi
if [[ ! "${PROBE_VERSION}" =~ ^[0-9][0-9A-Za-z._-]{0,63}$ ]]; then
  die "The pinned probe version contains unsupported characters."
fi
if [[ ! "${REPOSITORY}" =~ ^[0-9A-Za-z_.-]+/[0-9A-Za-z_.-]+$ ]]; then
  die "The pinned public release repository must be an owner/repository pair."
fi
if [[ -n "${BINARY_URL}" && ! "${BINARY_URL}" =~ ^https:// ]]; then
  die "--binary-url must be an HTTPS URL."
fi
if [[ "${BINARY_URL}" == *$'\n'* || "${BINARY_URL}" == *$'\r'* || "${BINARY_URL}" == *$'\t'* || "${BINARY_URL}" == *" "* ]]; then
  die "--binary-url contains unsupported whitespace."
fi
if [[ -n "${EXPECTED_SHA256}" && ! "${EXPECTED_SHA256}" =~ ^[0-9A-Fa-f]{64}$ ]]; then
  die "--sha256 must contain exactly 64 hexadecimal characters."
fi
if [[ "${HEALTH_ALLOW}" != "local" && "${HEALTH_ALLOW}" != "any" && ! "${HEALTH_ALLOW}" =~ ^[0-9A-Fa-f:.]+/[0-9]{1,3}$ ]]; then
  die "--health-allow must be an IPv4 or IPv6 CIDR, for example 203.0.113.10/32."
fi

if [[ ! -r /etc/os-release ]]; then
  die "Supported systems are Debian 12/13 and Ubuntu 22.04/24.04."
fi
. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
  debian:12|debian:13|ubuntu:22.04|ubuntu:24.04) ;;
  *) die "Unsupported system ${ID:-unknown} ${VERSION_ID:-unknown}; use Debian 12/13 or Ubuntu 22.04/24.04." ;;
esac
if [[ ! -d /run/systemd/system ]] || ! command -v systemctl >/dev/null 2>&1; then
  die "This installer requires a systemd-based VPS."
fi

case "$(uname -m)" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) die "Unsupported CPU architecture: $(uname -m)." ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates chrony curl fail2ban iproute2 openssh-client openssl python3-systemd unattended-upgrades ufw

# UFW can otherwise report itself active while protecting IPv4 only. The probe
# supports dual-stack VPSes, so fail closed unless both address families use the
# same deny-by-default policy.
UFW_DEFAULTS="/etc/default/ufw"
[[ -f "${UFW_DEFAULTS}" ]] || die "UFW defaults file ${UFW_DEFAULTS} is missing."
if grep -Eq '^[[:space:]]*IPV6=' "${UFW_DEFAULTS}"; then
  sed -i -E 's/^[[:space:]]*IPV6=.*/IPV6=yes/' "${UFW_DEFAULTS}"
else
  printf '\nIPV6=yes\n' >>"${UFW_DEFAULTS}"
fi
grep -Eq '^IPV6=yes$' "${UFW_DEFAULTS}" || die "Could not enable UFW protection for IPv6."

if [[ "${HEALTH_ALLOW}" != "local" && "${HEALTH_ALLOW}" != "any" ]]; then
  python3 - "${HEALTH_ALLOW}" <<'PY' || die "--health-allow is not a valid IPv4 or IPv6 CIDR."
import ipaddress
import sys

ipaddress.ip_network(sys.argv[1], strict=False)
PY
fi

enable_time_sync() {
  local unit=""
  local candidate
  local attempt
  if command -v timedatectl >/dev/null 2>&1; then
    timedatectl set-ntp true >/dev/null 2>&1 || true
  fi
  for candidate in chrony.service chronyd.service systemd-timesyncd.service; do
    if ! systemctl list-unit-files "${candidate}" --no-legend 2>/dev/null | grep -q "^${candidate}"; then
      continue
    fi
    if systemctl enable --now "${candidate}" >/dev/null 2>&1; then
      unit="${candidate}"
      break
    fi
  done
  [[ -n "${unit}" ]] || die "No supported time synchronization service could be enabled."
  systemctl is-active --quiet "${unit}" || die "Time synchronization service ${unit} is not active."
  if command -v timedatectl >/dev/null 2>&1; then
    for ((attempt = 0; attempt < 5; attempt++)); do
      [[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)" == "yes" ]] && return 0
      sleep 1
    done
    warn "The clock is not synchronized yet; TLS and result timestamps require accurate time."
  fi
}
enable_time_sync

declare -a SSH_PORTS=()
add_ssh_port() {
  local candidate="$1"
  local existing
  [[ "${candidate}" =~ ^[0-9]+$ ]] || return 0
  (( ${#candidate} <= 5 )) || return 0
  candidate=$((10#${candidate}))
  (( candidate >= 1 && candidate <= 65535 )) || return 0
  for existing in "${SSH_PORTS[@]:-}"; do
    [[ "${existing}" == "${candidate}" ]] && return 0
  done
  SSH_PORTS+=("${candidate}")
}

if [[ -n "${SSH_CONNECTION:-}" ]]; then
  ACTIVE_SSH_PORT=""
  IFS=' ' read -r _ _ _ ACTIVE_SSH_PORT <<<"${SSH_CONNECTION}"
  add_ssh_port "${ACTIVE_SSH_PORT}"
fi
if command -v sshd >/dev/null 2>&1; then
  while IFS= read -r detected_port; do add_ssh_port "${detected_port}"; done \
    < <(sshd -T 2>/dev/null | awk '$1 == "port" {print $2}')
fi
while IFS= read -r detected_port; do add_ssh_port "${detected_port}"; done \
  < <(ss -H -ltnp 2>/dev/null | awk '$0 ~ /(sshd|dropbear)/ {address=$4; sub(/^.*:/, "", address); if (address ~ /^[0-9]+$/) print address}')
if (( ${#SSH_PORTS[@]} == 0 )); then
  add_ssh_port 22
  warn "Could not detect an SSH listener; preserving access by allowing the conventional port 22."
fi
for detected_port in "${SSH_PORTS[@]}"; do
  if [[ "${detected_port}" == "${PROBE_PORT}" ]]; then
    die "Health port ${PROBE_PORT} conflicts with an SSH listener. Choose another --port."
  fi
done
join_with_comma() {
  local IFS=,
  printf '%s' "$*"
}
SSH_PORT_CSV="$(join_with_comma "${SSH_PORTS[@]}")"

if [[ -z "${BINARY_URL}" ]]; then
  BINARY_URL="https://github.com/${REPOSITORY}/releases/download/probe-v${PROBE_VERSION}/sslping-probe-linux-${ARCH}"
fi
CHECKSUM_URL="${BINARY_URL}.sha256"
TEMP_DIR="$(mktemp -d)"
STAGED_BINARY=""
STAGED_ENV=""
STAGED_UNIT=""
cleanup() {
  if [[ -n "${STAGED_BINARY}" ]]; then rm -f -- "${STAGED_BINARY}"; fi
  if [[ -n "${STAGED_ENV}" ]]; then rm -f -- "${STAGED_ENV}"; fi
  if [[ -n "${STAGED_UNIT}" ]]; then rm -f -- "${STAGED_UNIT}"; fi
  rm -rf -- "${TEMP_DIR}"
}
trap cleanup EXIT

CURL_RELEASE_ARGS=(
  --fail --silent --show-error --location
  --proto '=https' --proto-redir '=https' --tlsv1.2
  --connect-timeout 15 --max-time 300 --retry 3 --retry-delay 2
)

echo "Downloading SSLPing probe ${PROBE_VERSION} for linux/${ARCH}..."
curl "${CURL_RELEASE_ARGS[@]}" "${BINARY_URL}" --output "${TEMP_DIR}/sslping-probe"
[[ -s "${TEMP_DIR}/sslping-probe" ]] || die "Downloaded probe binary is empty."

if [[ -z "${EXPECTED_SHA256}" ]]; then
  curl "${CURL_RELEASE_ARGS[@]}" "${CHECKSUM_URL}" --output "${TEMP_DIR}/sslping-probe.sha256"
  EXPECTED_SHA256="$(awk 'NF {print $1; exit}' "${TEMP_DIR}/sslping-probe.sha256")"
  if [[ ! "${EXPECTED_SHA256}" =~ ^[0-9A-Fa-f]{64}$ ]]; then
    die "Release checksum file is invalid."
  fi
fi
EXPECTED_SHA256="${EXPECTED_SHA256,,}"
ACTUAL_SHA256="$(sha256sum "${TEMP_DIR}/sslping-probe" | awk '{print $1}')"
if [[ "${ACTUAL_SHA256}" != "${EXPECTED_SHA256}" ]]; then
  die "Probe checksum mismatch: expected ${EXPECTED_SHA256}, got ${ACTUAL_SHA256}."
fi
echo "SHA-256 checksum verified."

valid_public_ip_for_family() {
  local address="$1"
  local family="$2"
  python3 - "${address}" "${family}" <<'PY'
import ipaddress
import sys

try:
    address = ipaddress.ip_address(sys.argv[1])
except ValueError:
    raise SystemExit(1)
raise SystemExit(0 if address.version == int(sys.argv[2]) and address.is_global else 1)
PY
}

control_reachable_over_family() {
  local curl_family="$1"
  curl --silent --show-error --location --output /dev/null --request HEAD --noproxy '*' \
    --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 10 --max-time 20 "${curl_family}" "${CONTROL_URL}" 2>/dev/null
}

PUBLIC_IP="$(curl --fail --silent --show-error --noproxy '*' --max-time 10 --ipv4 --proto '=https' --tlsv1.2 https://api4.ipify.org 2>/dev/null || true)"
if [[ -n "${PUBLIC_IP}" ]] && valid_public_ip_for_family "${PUBLIC_IP}" 4 && control_reachable_over_family --ipv4; then
  CONTROL_NETWORK="tcp4"
else
  PUBLIC_IP="$(curl --fail --silent --show-error --noproxy '*' --max-time 10 --ipv6 --proto '=https' --tlsv1.2 https://api6.ipify.org 2>/dev/null || true)"
  if [[ -n "${PUBLIC_IP}" ]] && valid_public_ip_for_family "${PUBLIC_IP}" 6 && control_reachable_over_family --ipv6; then
    CONTROL_NETWORK="tcp6"
  else
    die "Could not find a public IPv4/IPv6 address that can reach the control plane. Check DNS, routing, TLS, and the VPS static address."
  fi
fi
echo "Control-plane egress pinned to ${CONTROL_NETWORK} (${PUBLIC_IP})."

install -d -o root -g root -m 0755 /usr/local/bin
STAGED_BINARY="$(mktemp /usr/local/bin/.sslping-probe.XXXXXX)"
install -o root -g root -m 0755 "${TEMP_DIR}/sslping-probe" "${STAGED_BINARY}"
mv -f -- "${STAGED_BINARY}" /usr/local/bin/sslping-probe
STAGED_BINARY=""

if ! getent group sslping-probe >/dev/null; then
  groupadd --system sslping-probe
fi
if ! id sslping-probe >/dev/null 2>&1; then
  useradd --system --gid sslping-probe --home-dir /var/lib/sslping-probe --create-home --shell /usr/sbin/nologin sslping-probe
fi
install -d -o root -g sslping-probe -m 0750 /etc/sslping-probe

EXISTING_PROBE_KEY="$(read_existing_setting SSLPING_PROBE_KEY)"
if (( ROTATE_KEY == 0 )) && [[ -n "${EXISTING_PROBE_KEY}" ]]; then
  if [[ ! "${EXISTING_PROBE_KEY}" =~ ^[0-9A-Za-z._~-]{32,256}$ ]]; then
    die "Existing probe key has an unsafe format; fix ${ENV_FILE} or use --rotate-key."
  fi
  PROBE_KEY="${EXISTING_PROBE_KEY}"
  KEY_ACTION="preserved"
else
  PROBE_KEY="$(openssl rand -hex 32)"
  if (( ROTATE_KEY == 1 )) && [[ -n "${EXISTING_PROBE_KEY}" ]]; then
    KEY_ACTION="rotated"
  else
    KEY_ACTION="generated"
  fi
fi

umask 0027
STAGED_ENV="$(mktemp /etc/sslping-probe/.probe.env.XXXXXX)"
{
  printf 'SSLPING_CONTROL_URL=%s\n' "${CONTROL_URL}"
  printf 'SSLPING_CONTROL_NETWORK=%s\n' "${CONTROL_NETWORK}"
  printf 'SSLPING_PROBE_KEY=%s\n' "${PROBE_KEY}"
  printf 'SSLPING_PROBE_PORT=%s\n' "${PROBE_PORT}"
  if [[ "${HEALTH_ALLOW}" == "local" ]]; then
    printf 'SSLPING_PROBE_HEALTH_ADDR=127.0.0.1:%s\n' "${PROBE_PORT}"
  else
    printf 'SSLPING_PROBE_HEALTH_ADDR=:%s\n' "${PROBE_PORT}"
  fi
  printf 'SSLPING_PROBE_CONCURRENCY=%s\n' "${PROBE_CONCURRENCY}"
  printf 'SSLPING_PROBE_VERSION=%s\n' "${PROBE_VERSION}"
  printf 'SSLPING_PROBE_SHA256=%s\n' "${EXPECTED_SHA256}"
  printf 'SSLPING_HEALTH_ALLOW=%s\n' "${HEALTH_ALLOW}"
} >"${STAGED_ENV}"
chown root:sslping-probe "${STAGED_ENV}"
chmod 0640 "${STAGED_ENV}"
mv -f -- "${STAGED_ENV}" "${ENV_FILE}"
STAGED_ENV=""

STAGED_UNIT="$(mktemp /etc/systemd/system/.sslping-probe.service.XXXXXX)"
cat >"${STAGED_UNIT}" <<'UNIT'
[Unit]
Description=SSLPing remote monitoring probe
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=sslping-probe
Group=sslping-probe
EnvironmentFile=/etc/sslping-probe/probe.env
ExecStart=/usr/local/bin/sslping-probe
Restart=always
RestartSec=5s
TimeoutStopSec=20s
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectHostname=true
ProtectClock=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectProc=invisible
ProcSubset=pid
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
RemoveIPC=true
RestrictRealtime=true
RestrictNamespaces=true
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_INET AF_INET6
SystemCallArchitectures=native
TasksMax=128
LimitNOFILE=4096
UMask=0027

[Install]
WantedBy=multi-user.target
UNIT
chown root:root "${STAGED_UNIT}"
chmod 0644 "${STAGED_UNIT}"
mv -f -- "${STAGED_UNIT}" /etc/systemd/system/sslping-probe.service
STAGED_UNIT=""

APT_CONFIG_TMP="$(mktemp /etc/apt/apt.conf.d/.52sslping-unattended-upgrades.XXXXXX)"
cat >"${APT_CONFIG_TMP}" <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
APT
chmod 0644 "${APT_CONFIG_TMP}"
chown root:root "${APT_CONFIG_TMP}"
mv -f -- "${APT_CONFIG_TMP}" /etc/apt/apt.conf.d/52sslping-unattended-upgrades
if systemctl list-unit-files apt-daily-upgrade.timer --no-legend 2>/dev/null | grep -q '^apt-daily-upgrade.timer'; then
  systemctl enable --now apt-daily-upgrade.timer >/dev/null
fi

if command -v sshd >/dev/null 2>&1; then
  install -d -o root -g root -m 0755 /etc/fail2ban/jail.d
  FAIL2BAN_CONFIG="/etc/fail2ban/jail.d/sshd-local.conf"
  FAIL2BAN_BACKUP="${TEMP_DIR}/previous-fail2ban-sshd-local.conf"
  FAIL2BAN_HAD_CONFIG=0
  if [[ -e "${FAIL2BAN_CONFIG}" ]]; then
    cp -a -- "${FAIL2BAN_CONFIG}" "${FAIL2BAN_BACKUP}"
    FAIL2BAN_HAD_CONFIG=1
  fi
  FAIL2BAN_TMP="$(mktemp /etc/fail2ban/jail.d/.sshd-local.conf.XXXXXX)"
  cat >"${FAIL2BAN_TMP}" <<JAIL
[sshd]
enabled = true
port = ${SSH_PORT_CSV}
maxretry = 5
findtime = 10m
bantime = 1h
JAIL
  chmod 0644 "${FAIL2BAN_TMP}"
  chown root:root "${FAIL2BAN_TMP}"
  mv -f -- "${FAIL2BAN_TMP}" "${FAIL2BAN_CONFIG}"
  if ! fail2ban-client -t; then
    if (( FAIL2BAN_HAD_CONFIG == 1 )); then
      cp -a -- "${FAIL2BAN_BACKUP}" "${FAIL2BAN_CONFIG}"
    else
      rm -f -- "${FAIL2BAN_CONFIG}"
    fi
    die "Fail2ban rejected the sshd jail for detected ports ${SSH_PORT_CSV}; the previous config was restored."
  fi
  systemctl enable fail2ban >/dev/null
  systemctl restart fail2ban
  FAIL2BAN_READY=0
  for ((FAIL2BAN_ATTEMPT = 0; FAIL2BAN_ATTEMPT < 10; FAIL2BAN_ATTEMPT++)); do
    if fail2ban-client ping >/dev/null 2>&1 && fail2ban-client status sshd >/dev/null 2>&1; then
      FAIL2BAN_READY=1
      break
    fi
    sleep 1
  done
  (( FAIL2BAN_READY == 1 )) || die "Fail2ban did not start its sshd jail."
else
  warn "OpenSSH sshd was not found; Fail2ban's sshd jail was not enabled."
fi

secure_ssh_path_for_admin() {
  local path="$1"
  local admin_user="$2"
  local owner
  local mode
  [[ -e "${path}" ]] || return 1
  owner="$(stat -c '%U' "${path}" 2>/dev/null || true)"
  [[ "${owner}" == "${admin_user}" || "${owner}" == "root" ]] || return 1
  mode="$(stat -c '%a' "${path}" 2>/dev/null || true)"
  [[ "${mode}" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#${mode} & 0022) == 0 ))
}

valid_authorized_keys_for_admin() {
  local file="$1"
  local admin_user="$2"
  local admin_home="$3"
  local ssh_directory
  ssh_directory="$(dirname -- "${file}")"
  [[ -s "${file}" && -d "${ssh_directory}" ]] || return 1
  secure_ssh_path_for_admin "${admin_home}" "${admin_user}" || return 1
  secure_ssh_path_for_admin "${ssh_directory}" "${admin_user}" || return 1
  secure_ssh_path_for_admin "${file}" "${admin_user}" || return 1
  ssh-keygen -l -f "${file}" >/dev/null 2>&1
}

effective_sshd_is_hardened() {
  local effective="$1"
  local admin_user="$2"
  grep -qx 'pubkeyauthentication yes' <<<"${effective}" || return 1
  grep -qx 'passwordauthentication no' <<<"${effective}" || return 1
  grep -qx 'kbdinteractiveauthentication no' <<<"${effective}" || return 1
  grep -qx 'permitemptypasswords no' <<<"${effective}" || return 1
  grep -qx 'x11forwarding no' <<<"${effective}" || return 1
  grep -qx 'allowagentforwarding no' <<<"${effective}" || return 1
  grep -qx 'allowtcpforwarding no' <<<"${effective}" || return 1
  grep -qx 'permittunnel no' <<<"${effective}" || return 1
  grep -qx 'gatewayports no' <<<"${effective}" || return 1
  if [[ "${admin_user}" == "root" ]]; then
    grep -Eq '^permitrootlogin (prohibit-password|without-password)$' <<<"${effective}"
  else
    grep -Eq '^permitrootlogin (no|prohibit-password|without-password)$' <<<"${effective}"
  fi
}

harden_ssh_if_safe() {
  local admin_user="${SUDO_USER:-root}"
  local admin_home=""
  local authorized_keys_file=""
  local hardening_file="/etc/ssh/sshd_config.d/00-sslping-hardening.conf"
  local hardening_tmp=""
  local backup_file="${TEMP_DIR}/previous-ssh-hardening.conf"
  local had_previous=0
  local effective=""
  local client_address=""
  local server_host=""

  if ! command -v sshd >/dev/null 2>&1 || ! id "${admin_user}" >/dev/null 2>&1; then
    warn "SSH authentication was not changed because the current sudo/admin user could not be verified."
    return 0
  fi
  admin_home="$(getent passwd "${admin_user}" | awk -F: 'NR == 1 {print $6}')"
  authorized_keys_file="${admin_home}/.ssh/authorized_keys"
  if [[ -z "${admin_home}" ]] || ! valid_authorized_keys_for_admin "${authorized_keys_file}" "${admin_user}" "${admin_home}"; then
    warn "SSH password login was left unchanged: ${authorized_keys_file} has no parseable key or its ownership/permissions are unsafe for the current sudo/admin user ${admin_user}."
    return 0
  fi

  install -d -o root -g root -m 0755 /etc/ssh/sshd_config.d
  if [[ -e "${hardening_file}" ]]; then
    cp -a -- "${hardening_file}" "${backup_file}"
    had_previous=1
  fi
  hardening_tmp="$(mktemp /etc/ssh/sshd_config.d/.00-sslping-hardening.conf.XXXXXX)"
  cat >"${hardening_tmp}" <<'SSH'
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PermitRootLogin prohibit-password
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitTunnel no
GatewayPorts no
ClientAliveInterval 300
ClientAliveCountMax 2
SSH
  chmod 0644 "${hardening_tmp}"
  chown root:root "${hardening_tmp}"
  mv -f -- "${hardening_tmp}" "${hardening_file}"

  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    IFS=' ' read -r client_address _ _ _ <<<"${SSH_CONNECTION}"
  fi
  server_host="$(hostname -f 2>/dev/null || hostname)"
  if [[ -n "${client_address}" ]]; then
    effective="$(sshd -T -C "user=${admin_user},addr=${client_address},host=${server_host}" 2>/dev/null || true)"
  else
    effective="$(sshd -T 2>/dev/null || true)"
  fi
  if ! sshd -t 2>/dev/null || ! effective_sshd_is_hardened "${effective}" "${admin_user}"; then
    if (( had_previous == 1 )); then
      cp -a -- "${backup_file}" "${hardening_file}"
    else
      rm -f -- "${hardening_file}"
    fi
    warn "SSH hardening was rolled back because syntax or effective settings validation failed."
    return 0
  fi
  if ! (systemctl reload ssh.service 2>/dev/null || systemctl reload sshd.service 2>/dev/null); then
    if (( had_previous == 1 )); then
      cp -a -- "${backup_file}" "${hardening_file}"
    else
      rm -f -- "${hardening_file}"
    fi
    sshd -t >/dev/null 2>&1 || true
    systemctl reload ssh.service 2>/dev/null || systemctl reload sshd.service 2>/dev/null || true
    warn "SSH hardening was rolled back because sshd could not reload it."
    return 0
  fi
  echo "SSH key-only authentication validated for ${admin_user}."
}
harden_ssh_if_safe

ufw_has_managed_marker() {
  local marker="$1"
  ufw status 2>/dev/null | grep -Fq "${marker}" ||
    ufw show added 2>/dev/null | grep -Fq "${marker}"
}

for detected_port in "${SSH_PORTS[@]}"; do
  ssh_marker="SSLPing SSH rate limit ${detected_port}"
  if ! ufw_has_managed_marker "${ssh_marker}"; then
    ufw limit "${detected_port}/tcp" comment "${ssh_marker}" >/dev/null
  fi
done
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
ufw status | grep -q '^Status: active' || die "UFW did not become active."

ssh_port_is_current() {
  local candidate="$1"
  local current
  for current in "${SSH_PORTS[@]}"; do
    [[ "${candidate}" == "${current}" ]] && return 0
  done
  return 1
}

remove_stale_managed_ssh_rules() {
  local -a managed_rules=()
  local entry
  local rule_number
  local managed_port
  mapfile -t managed_rules < <(
    ufw status numbered 2>/dev/null |
      awk 'index($0, "SSLPing SSH rate limit ") {number=$0; sub(/^\[[[:space:]]*/, "", number); sub(/\].*$/, "", number); gsub(/[[:space:]]/, "", number); port=$0; sub(/^.*SSLPing SSH rate limit[[:space:]]+/, "", port); sub(/[^0-9].*$/, "", port); if (number ~ /^[0-9]+$/ && port ~ /^[0-9]+$/) print number ":" port}' |
      sort -t: -k1,1rn
  )
  for entry in "${managed_rules[@]:-}"; do
    [[ -n "${entry}" ]] || continue
    rule_number="${entry%%:*}"
    managed_port="${entry#*:}"
    if ! ssh_port_is_current "${managed_port}"; then
      ufw --force delete "${rule_number}" >/dev/null
    fi
  done
}

remove_stale_managed_ssh_rules

remove_managed_health_rules() {
  local -a rule_numbers=()
  local rule_number
  mapfile -t rule_numbers < <(
    ufw status numbered 2>/dev/null |
      awk 'index($0, "SSLPing probe health") {line=$0; sub(/^\[[[:space:]]*/, "", line); sub(/\].*$/, "", line); gsub(/[[:space:]]/, "", line); if (line ~ /^[0-9]+$/) print line}' |
      sort -rn
  )
  for rule_number in "${rule_numbers[@]:-}"; do
    if [[ -n "${rule_number}" ]]; then ufw --force delete "${rule_number}" >/dev/null; fi
  done
}

remove_managed_health_rules
if [[ "${HEALTH_ALLOW}" == "local" ]]; then
  : # The service binds to loopback and UFW receives no inbound health rule.
elif [[ "${HEALTH_ALLOW}" == "any" ]]; then
  ufw allow "${PROBE_PORT}/tcp" comment 'SSLPing probe health' >/dev/null
else
  ufw allow from "${HEALTH_ALLOW}" to any port "${PROBE_PORT}" proto tcp comment 'SSLPing probe health' >/dev/null
fi
ufw logging low >/dev/null
ufw status | grep -q '^Status: active' || die "UFW did not become active."

systemctl daemon-reload
systemctl enable sslping-probe >/dev/null
systemctl restart sslping-probe

SERVICE_HEALTHY=0
for ((SERVICE_ATTEMPT = 0; SERVICE_ATTEMPT < 20; SERVICE_ATTEMPT++)); do
  if systemctl is-active --quiet sslping-probe &&
    curl --fail --silent --show-error --noproxy '*' --max-time 2 "http://127.0.0.1:${PROBE_PORT}/health/live" >/dev/null 2>&1; then
    SERVICE_HEALTHY=1
    break
  fi
  sleep 1
done
if (( SERVICE_HEALTHY == 0 )); then
  systemctl status sslping-probe --no-pager >&2 || true
  journalctl -u sslping-probe -n 50 --no-pager >&2 || true
  die "sslping-probe did not become active or answer its local liveness endpoint."
fi

CODE_SUGGESTION="$(hostname -s | tr '[:upper:]_' '[:lower:]-' | tr -cd 'a-z0-9-' | cut -c1-48)"
if [[ ${#CODE_SUGGESTION} -lt 2 || "${CODE_SUGGESTION}" == "local" ]]; then CODE_SUGGESTION="probe-$(openssl rand -hex 3)"; fi

HEALTH_HOST="${PUBLIC_IP:-127.0.0.1}"
if [[ "${HEALTH_HOST}" == *:* ]]; then HEALTH_HOST="[${HEALTH_HOST}]"; fi
if [[ "${HEALTH_ALLOW}" == "local" ]]; then
  HEALTH_ACCESS="loopback only"
elif [[ "${HEALTH_ALLOW}" == "any" ]]; then
  HEALTH_ACCESS="public (all sources)"
else
  HEALTH_ACCESS="restricted to ${HEALTH_ALLOW}"
fi

echo
echo "SSLPing probe is installed and its local liveness check passed."
echo "Add this point in Dashboard -> System administration -> Check locations:"
echo "  Suggested code : ${CODE_SUGGESTION}"
echo "  Name           : $(hostname -f 2>/dev/null || hostname)"
echo "  IP address     : ${PUBLIC_IP:-unknown}"
echo "  Health port    : ${PROBE_PORT} (${HEALTH_ACCESS})"
echo "  Probe key      : ${PROBE_KEY} (${KEY_ACTION})"
echo "  Concurrency    : ${PROBE_CONCURRENCY}"
echo "  Probe version  : ${PROBE_VERSION}"
echo "  Control network: ${CONTROL_NETWORK}"
echo "  Enforce IP     : enabled"
echo
echo "The port is health-only. Tasks and results use outbound HTTPS to ${CONTROL_URL}."
echo "The key is readable only by root and the sslping-probe service account in ${ENV_FILE}."
echo "Readiness may stay 'connecting' until the key is registered in the dashboard."
if [[ "${HEALTH_ALLOW}" == "local" ]]; then
  echo "Health URL    : http://127.0.0.1:${PROBE_PORT}/health/ready (run on the VPS)"
else
  echo "Health URL    : http://${HEALTH_HOST}:${PROBE_PORT}/health/ready"
fi
