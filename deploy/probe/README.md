# SSLPing check unit

The check unit is an unprivileged outbound agent. It long-polls the SSLPing
control plane over HTTPS/HTTP/2, executes only leased checks assigned to its
location, and submits fenced results. It has no database credentials and does
not accept inbound task or control traffic.

The configured port serves only unauthenticated HTTP liveness and readiness
endpoints and binds to loopback by default. Task delivery and unit presence use
outbound HTTPS, so no public health port is required.

## Supported VPS images

The production bootstrap supports:

- Debian 12 and 13;
- Ubuntu 22.04 LTS and 24.04 LTS;
- `amd64` and `arm64` CPUs;
- systemd and an OpenSSH-based VPS image.

Allocate the static public address in the VPS provider before installation.
The script can report an address but cannot reserve it or configure the
provider's external firewall/security group.

Use a provider-installed SSH key. Keep the current SSH session open until a
second key-based login has been tested after installation.

## Install

Release `1.0.2` is the bootstrap's pinned default. The pinned one-command
installation for a new VPS is:

```bash
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/mitrohin/sslping-dashboard/probe-v1.0.2/deploy/probe/bootstrap.sh \
  | sudo bash
```

The command intentionally has no control-plane URL, version or registration
argument. The dedicated probe endpoint (`https://units.sslping.io`) and immutable
probe version are part of the reviewed public installer. The generated probe
key authenticates and binds the unit after its IP, port and key are saved in
the administration section; the key does not need to encode an API address.

For diagnosis or review, downloading the installer before running it makes
network failures clearer and avoids executing a partial pipeline:

```bash
curl --fail --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/mitrohin/sslping-dashboard/probe-v1.0.2/deploy/probe/bootstrap.sh \
  --output /tmp/sslping-probe-bootstrap.sh
sudo bash /tmp/sslping-probe-bootstrap.sh
```

The bootstrap installs a checksummed static binary, creates a dedicated
non-login user and hardened systemd service, enables UFW, Fail2ban, unattended
security upgrades, and Chrony time synchronization. Existing UFW rules are
retained; the script does not reset the firewall.

The final output contains the public IP, health port, registration key,
version, concurrency, and selected control network. Enter the printed address
unchanged in **System administration → Check locations**. The process can be
live while readiness remains `connecting` until its key is registered.

The installer prefers a usable public IPv4 address and falls back to IPv6. It
pins only the agent's control-plane transport to the corresponding `tcp4` or
`tcp6` family, so source-IP enforcement observes the address printed during
installation even when the API hostname is dual-stack. Monitor checks are not
family-restricted and continue to test IPv4 and IPv6 targets normally. The
control connection is deliberately direct and ignores proxy environment
variables, because a proxy's egress address would not match the VPS address
used for source-IP enforcement.

### Health endpoint exposure

By default, the health endpoint is reachable only from the VPS itself and UFW
does not open its port. The dashboard determines availability from the unit's
outbound claims; the recorded IP and port remain registration/diagnostic
metadata. Expose health only when an external operations system truly needs it:

```bash
sudo bash /tmp/sslping-probe-bootstrap.sh --health-allow 203.0.113.10/32
```

Use `/128` for a single IPv6 address. Apply the same restriction in the VPS
provider's external firewall. Every detected SSH port is rate-limited by UFW
and protected by Fail2ban. On a rerun, obsolete rules carrying SSLPing's own
SSH marker are removed after an SSH port change; unrelated custom UFW rules are
preserved. UFW still allows outbound traffic because HTTP, TCP, UDP, DNS, TLS
and reachability monitors may target different public ports.

### Installer options

```text
--port PORT             Health-only port, 1024-65535 (default 8443)
--health-allow CIDR     Expose health to one IPv4/IPv6 CIDR (default: local)
--health-allow any      Expose health to every source (not recommended)
--concurrency N         Concurrent checks (default 4 for a small VPS)
--binary-url URL        Use a custom HTTPS binary URL
--sha256 HEX            Pin the exact custom/default binary digest
--rotate-key            Replace the currently installed probe key
```

Without `--sha256`, the installer downloads `BINARY_URL.sha256`. This detects
corruption or a mismatched artifact, but a checksum hosted beside a binary is
not a cryptographic signature and does not protect against compromise of the
release publisher. For a private mirror, pass both `--binary-url` and a digest
obtained through an independent trusted channel:

```bash
sudo bash /tmp/sslping-probe-bootstrap.sh \
  --binary-url https://downloads.example/sslping-probe-linux-amd64 \
  --sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

## Safe reruns and key rotation

A normal rerun preserves the port, concurrency, health CIDR and probe key when
they are not supplied again. A preserved key is deliberately not printed
again; read the root-only environment file only during an attended credential
recovery. The installer redetects the public address/control family, replaces
the binary and service
definition atomically where possible, restarts the service, and requires both
`systemctl is-active` and local `/health/live` to succeed before printing
credentials.

Use `--rotate-key` only during a coordinated dashboard update. The service
starts with the new key immediately, so it receives authorization errors until
the new value is saved for that location. The dashboard stores only the key's
SHA-256 hash. On disk the key is readable by root and the dedicated
`sslping-probe` service account, not by other users.

SSH password authentication is changed only when the exact current
`SUDO_USER` (or root for a direct root install) has a valid
`~/.ssh/authorized_keys`. The installer validates both `sshd -t` and effective
`sshd -T` settings and rolls its drop-in back if validation or reload fails.
Otherwise it prints a warning and leaves SSH authentication unchanged.

## Operations

```bash
systemctl status sslping-probe
journalctl -u sslping-probe -f
curl --fail http://127.0.0.1:8443/health/live
curl --fail http://127.0.0.1:8443/health/ready
sudo ufw status numbered
sudo fail2ban-client status sshd
chronyc tracking
timedatectl show -p NTPSynchronized
```

`/health/live` verifies the process. `/health/ready` verifies that the agent is
successfully talking to the control plane; it may return `503 connecting`
during registration or a control-plane outage. Unit liveness should be tracked
separately from monitored-site incidents.

## Release artifacts

For tag `probe-vVERSION`, the workflow publishes:

- `sslping-probe-linux-amd64` and `.sha256`;
- `sslping-probe-linux-arm64` and `.sha256`;
- `SHA256SUMS` covering both binaries.

The installer uses `/releases/download/probe-vVERSION/...`, never
`/releases/latest/...`.

The probe binaries are built from the private backend repository and published
as release assets in this public repository. The backend release workflow
requires the `SSLPING_DASHBOARD_RELEASE_TOKEN` secret with permission to create
releases in `mitrohin/sslping-dashboard`.

## Local verification

```bash
./deploy/probe/check.sh
```

The production control-plane URL and probe release are pinned inside the
public installer. Registration is performed solely with the generated probe
key: copy the final IP, health port and key into **System administration →
Check locations**. No backend URL or software version is required from the
operator.
