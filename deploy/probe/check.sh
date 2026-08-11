#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP="${SCRIPT_DIR}/bootstrap.sh"

bash -n "${BOOTSTRAP}"

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "${BOOTSTRAP}" "${BASH_SOURCE[0]}"
else
  echo "shellcheck is not installed; skipping lint"
fi

grep -Fq 'CONTROL_URL="https://units.sslping.io"' "${BOOTSTRAP}"
grep -Fq 'REPOSITORY="mitrohin/sslping-dashboard"' "${BOOTSTRAP}"
grep -Fq 'PROBE_VERSION="1.0.6"' "${BOOTSTRAP}"
grep -Fq 'Probe key      : preserved (not printed again)' "${BOOTSTRAP}"
grep -Fq 'HEALTH_ALLOW="${HEALTH_ALLOW:-local}"' "${BOOTSTRAP}"
grep -Fq 'SSLPING_PROBE_HEALTH_ADDR=127.0.0.1:' "${BOOTSTRAP}"
grep -Fq '"${CODE_SUGGESTION}" == "local"' "${BOOTSTRAP}"
grep -Fq 'grep -Eq '\''^IPV6=yes$'\'' "${UFW_DEFAULTS}"' "${BOOTSTRAP}"

if grep -Eq -- '--control-url|--version[= )]' "${BOOTSTRAP}"; then
  echo "production URL and version must not be operator options" >&2
  exit 1
fi
if grep -Fq 'releases/latest' "${BOOTSTRAP}"; then
  echo "installer must use an immutable release" >&2
  exit 1
fi

echo "Public probe bootstrap checks passed"
