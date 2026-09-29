#!/usr/bin/env bash
# =============================================================================
# trial-booking: one-shot provisioning for an Ubuntu VPS (22.04 / 24.04 / 26.04)
# =============================================================================
#
# Sets up, idempotently (safe to re-run):
#   1. base packages (nginx, certbot, rsync, ufw, ...)
#   2. a `deploy` user for CI: SSH key login, no sudo
#   3. nvm + Node LTS + PM2 + pm2-logrotate, as that user
#   4. PostgreSQL 16 with a dedicated role and database
#   5. the deploy root and its logs/ directory
#   6. apps/api/.env and apps/payments-sandbox/.env with generated secrets,
#      only when they do not exist yet
#   7. nginx, from the templates next to this script
#   8. UFW: SSH, 80 and 443 only
#   9. a Let's Encrypt certificate via `certbot certonly --webroot` (optional)
#   then the PM2 systemd unit, so processes come back after a reboot
#
# No Docker anywhere. Runtime is PM2 + nginx + PostgreSQL on the host.
#
# USAGE
#   The script reads nginx.conf, nginx-tls.conf and snippets/ from its own
#   folder, so copy the whole .deploy/ directory to the server first, e.g.
#     scp -r .deploy root@<server>:/root/trial-booking-deploy
#   then, on the server:
#     sudo DOMAIN=trial.example.org CERTBOT_EMAIL=ops@example.org \
#          DEPLOY_SSH_PUBKEY="ssh-ed25519 AAAA... github-actions" \
#          bash /root/trial-booking-deploy/vps-setup.sh
#
# ENVIRONMENT (all optional)
#   DOMAIN             Public hostname. Default example.com, which skips TLS
#                      (the site then answers on the server IP over HTTP).
#   CERTBOT_EMAIL      Let's Encrypt contact. TLS is requested only when this
#                      is set and DOMAIN is real and already resolves here.
#   DEPLOY_SSH_PUBKEY  Public half of the CI deploy key, appended to the deploy
#                      user's authorized_keys.
#   APP_USER           deploy
#   APP_DIR            /home/$APP_USER/trial-booking. Must equal the DEPLOY_PATH
#                      repository variable.
#   DB_NAME            trial_booking
#   DB_USER            trial_booking_app
#   DB_PASSWORD        Used when the role is created (generated if unset).
#                      Setting it for an existing role rotates the password.
#                      Allowed characters: A-Z a-z 0-9 . _ ~ - (16 to 128), so
#                      DATABASE_URL needs no escaping.
#   PG_MAJOR           16
#   NODE_MAJOR         24 (the LTS line that .nvmrc resolves to today)
#   SSH_PORT           Detected from sshd; set it if detection is wrong.
#
# SECRETS
#   Nothing is hardcoded. Generated values (DB password, JWT_SECRET, payment
#   API key) are written straight into the mode-600 env files and not printed.
#   The one exception: a newly generated DB password is printed once when an
#   env file already exists, because it is then stored nowhere else.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# postgres cannot read most working directories; cd / avoids its warnings.
cd /

APP_USER="${APP_USER:-deploy}"
APP_DIR="${APP_DIR:-/home/${APP_USER}/trial-booking}"
APP_DIR="${APP_DIR%/}"
DOMAIN="${DOMAIN:-example.com}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
DEPLOY_SSH_PUBKEY="${DEPLOY_SSH_PUBKEY:-}"
DB_NAME="${DB_NAME:-trial_booking}"
DB_USER="${DB_USER:-trial_booking_app}"
DB_PASSWORD="${DB_PASSWORD:-}"
PG_MAJOR="${PG_MAJOR:-16}"
NODE_MAJOR="${NODE_MAJOR:-24}"
SSH_PORT="${SSH_PORT:-}"

# nvm installer pinned by digest: tags are mutable, so the version alone proves
# nothing. Re-capture when changing NVM_VERSION:
#   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/<tag>/install.sh | sha256sum
NVM_VERSION="v0.40.1"
NVM_INSTALL_SHA256="abdb525ee9f5b48b34d8ed9fc67c6013fb0f659712e401ecd88ab989b3af8f53"

NGINX_SITE="trial-booking"
NGINX_AVAILABLE="/etc/nginx/sites-available/${NGINX_SITE}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${NGINX_SITE}"
NGINX_SNIPPET_DIR="/etc/nginx/snippets"
SNIPPETS=(trial-booking-app.conf trial-booking-proxy.conf trial-booking-security-headers.conf)
ACME_WEBROOT="/var/www/certbot"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

API_ENV="${APP_DIR}/apps/api/.env"
SANDBOX_ENV="${APP_DIR}/apps/payments-sandbox/.env"

log() { printf '\n>>> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# Run a bash snippet as APP_USER with nvm loaded. Snippets passed here never
# contain secrets (arguments are visible in the process list).
app_sh() {
	sudo -u "${APP_USER}" -H bash -c \
		'set -eo pipefail; export NVM_DIR="$HOME/.nvm"; if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi; '"$1"
}

# Read KEY=value from an env file (last occurrence wins, like dotenv).
env_value() {
	sed -n "s/^$2=//p" "$1" | tail -n 1
}

# =============================================================================
# [0] Preflight: validate every input before touching the system
# =============================================================================
log "[0/9] Preflight"

[ "${EUID}" -eq 0 ] || die "run as root: sudo bash $0"

# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "this script targets Ubuntu; found '${ID:-unknown}'."

for f in nginx.conf nginx-tls.conf "${SNIPPETS[@]/#/snippets/}"; do
	[ -f "${SCRIPT_DIR}/${f}" ] || die "missing ${SCRIPT_DIR}/${f}. Copy the whole .deploy/ folder, not just this script."
done

[[ "${DOMAIN}" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] \
	|| die "DOMAIN '${DOMAIN}' is not a valid hostname."
[[ "${APP_USER}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "APP_USER '${APP_USER}' is not a valid user name."
[[ "${APP_DIR}" =~ ^/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+$ && "${APP_DIR}" != *"/.."* ]] \
	|| die "APP_DIR '${APP_DIR}' must be an absolute path at least two levels deep, without '..'."
[[ "${DB_NAME}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "DB_NAME must match [a-z_][a-z0-9_]*."
[[ "${DB_USER}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "DB_USER must match [a-z_][a-z0-9_]*."
if [ -n "${DB_PASSWORD}" ]; then
	[[ "${DB_PASSWORD}" =~ ^[A-Za-z0-9._~-]{16,128}$ ]] \
		|| die "DB_PASSWORD must be 16 to 128 characters from A-Z a-z 0-9 . _ ~ - (URL-safe)."
fi
[[ "${PG_MAJOR}" =~ ^[0-9]+$ ]] || die "PG_MAJOR must be a number."
[[ "${NODE_MAJOR}" =~ ^[0-9]+$ ]] || die "NODE_MAJOR must be a number."
if [ -n "${CERTBOT_EMAIL}" ]; then
	[[ "${CERTBOT_EMAIL}" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "CERTBOT_EMAIL looks invalid."
fi
if [ -n "${DEPLOY_SSH_PUBKEY}" ]; then
	[[ "${DEPLOY_SSH_PUBKEY}" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))\ [A-Za-z0-9+/=]+(\ .*)?$ ]] \
		|| die "DEPLOY_SSH_PUBKEY must be a single OpenSSH public key line."
fi

# SSH port(s): enabling UFW without the real port would lock everyone out.
# `sshd -T` fails on socket-activated sshd (24.04+), so fall back to the config.
if [ -z "${SSH_PORT}" ]; then
	SSH_PORT="$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }' | sort -u | tr '\n' ' ' || true)"
fi
if [ -z "${SSH_PORT// /}" ]; then
	SSH_PORT="$(grep -hiE '^[[:space:]]*Port[[:space:]]+[0-9]+' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null \
		| awk '{ print $2 }' | sort -u | tr '\n' ' ' || true)"
fi
read -r -a SSH_PORTS <<< "${SSH_PORT//,/ }"
[ "${#SSH_PORTS[@]}" -gt 0 ] || SSH_PORTS=(22)
for p in "${SSH_PORTS[@]}"; do
	[[ "${p}" =~ ^[0-9]+$ ]] || die "SSH_PORT '${p}' is not a number."
done

WANT_TLS="false"
if [ "${DOMAIN}" != "example.com" ] && [ -n "${CERTBOT_EMAIL}" ]; then
	WANT_TLS="true"
fi

info "domain    : ${DOMAIN}"
info "app user  : ${APP_USER}"
info "app dir   : ${APP_DIR}"
info "database  : ${DB_NAME} (role ${DB_USER}), PostgreSQL ${PG_MAJOR}"
info "node      : ${NODE_MAJOR}"
info "ssh port  : ${SSH_PORTS[*]}"
info "tls       : ${WANT_TLS}"

# =============================================================================
# [1] Base packages
# =============================================================================
log "[1/9] Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
# No full upgrade here: unattended-upgrades (on by default) handles that, and a
# re-run of this script should not restart unrelated services.
apt-get install -y curl ca-certificates git rsync ufw openssl nginx certbot postgresql-common
systemctl enable --now nginx

# =============================================================================
# [2] Deploy user (key-only SSH, no sudo: the deploy job never needs root)
# =============================================================================
log "[2/9] User '${APP_USER}'"
if id -u "${APP_USER}" >/dev/null 2>&1; then
	info "exists"
else
	adduser --disabled-password --gecos "" "${APP_USER}"
	info "created"
fi
APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"

install -d -m 700 -o "${APP_USER}" -g "${APP_USER}" "${APP_HOME}/.ssh"
AUTH_KEYS="${APP_HOME}/.ssh/authorized_keys"
touch "${AUTH_KEYS}"
chmod 600 "${AUTH_KEYS}"
chown "${APP_USER}:${APP_USER}" "${AUTH_KEYS}"
if [ -n "${DEPLOY_SSH_PUBKEY}" ]; then
	if grep -qxF "${DEPLOY_SSH_PUBKEY}" "${AUTH_KEYS}"; then
		info "deploy key already authorized"
	else
		printf '%s\n' "${DEPLOY_SSH_PUBKEY}" >> "${AUTH_KEYS}"
		info "deploy key added to ${AUTH_KEYS}"
	fi
fi

# =============================================================================
# [3] nvm, Node, PM2, pm2-logrotate (all as APP_USER)
# =============================================================================
log "[3/9] nvm ${NVM_VERSION}, Node ${NODE_MAJOR}, PM2"
sudo -u "${APP_USER}" -H bash <<EOF
set -euo pipefail
if [ ! -s "\${HOME}/.nvm/nvm.sh" ]; then
	# Download, verify, then run. Piping a remote script into a shell would run
	# whatever arrived, including a truncated or repointed file.
	tmp="\$(mktemp)"
	trap 'rm -f "\${tmp}"' EXIT
	curl -fsSL --proto '=https' --tlsv1.2 -o "\${tmp}" \
		"https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh"
	actual="\$(sha256sum "\${tmp}" | cut -d' ' -f1)"
	if [ "\${actual}" != "${NVM_INSTALL_SHA256}" ]; then
		echo "nvm installer digest mismatch: expected ${NVM_INSTALL_SHA256}, got \${actual}" >&2
		exit 1
	fi
	# Adds nvm to ~/.bashrc, so `pm2` works in an interactive SSH session.
	bash "\${tmp}"
fi
EOF

# Ubuntu's ~/.bashrc returns early in non-interactive shells, so
# `sudo -iu deploy pm2 status` would not find pm2. Load nvm from ~/.profile too.
NVM_MARKER="# trial-booking: load nvm for login shells"
if ! grep -qF "${NVM_MARKER}" "${APP_HOME}/.profile" 2>/dev/null; then
	cat >> "${APP_HOME}/.profile" <<'PROFILE'

# trial-booking: load nvm for login shells
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
PROFILE
fi
# The runbook's commands use $DEPLOY_PATH; keep it in step with APP_DIR.
sed -i '/^export DEPLOY_PATH=/d' "${APP_HOME}/.profile"
printf 'export DEPLOY_PATH=%s\n' "${APP_DIR}" >> "${APP_HOME}/.profile"
chown "${APP_USER}:${APP_USER}" "${APP_HOME}/.profile"

app_sh "
	nvm install ${NODE_MAJOR}
	nvm alias default ${NODE_MAJOR}
	command -v pm2 >/dev/null || npm install -g pm2
	[ -d \"\$HOME/.pm2/modules/pm2-logrotate\" ] || pm2 install pm2-logrotate
	# Rotate the ./logs/*.log files PM2 writes: 10 MB each, 14 kept, gzipped.
	pm2 set pm2-logrotate:max_size 10M >/dev/null
	pm2 set pm2-logrotate:retain 14 >/dev/null
	pm2 set pm2-logrotate:compress true >/dev/null
	echo \"    node \$(node -v), npm \$(npm -v), pm2 \$(pm2 -v)\"
"

# =============================================================================
# [4] PostgreSQL
# =============================================================================
log "[4/9] PostgreSQL ${PG_MAJOR}"
if ! apt-cache show "postgresql-${PG_MAJOR}" >/dev/null 2>&1; then
	# Not in this release's archive (22.04 ships 14, 26.04 ships a newer major):
	# add the official PGDG repository with the helper postgresql-common ships.
	PGDG_HELPER="/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh"
	[ -x "${PGDG_HELPER}" ] || die "postgresql-${PG_MAJOR} is not available and ${PGDG_HELPER} is missing."
	"${PGDG_HELPER}" -y
fi
apt-get install -y "postgresql-${PG_MAJOR}"

PG_PORT="$(pg_lsclusters --no-header | awk -v v="${PG_MAJOR}" '$1 == v && $2 == "main" { print $3; exit }')"
if [ -z "${PG_PORT}" ]; then
	pg_createcluster "${PG_MAJOR}" main
	PG_PORT="$(pg_lsclusters --no-header | awk -v v="${PG_MAJOR}" '$1 == v && $2 == "main" { print $3; exit }')"
fi
systemctl enable --now "postgresql@${PG_MAJOR}-main"
info "cluster ${PG_MAJOR}/main listens on 127.0.0.1:${PG_PORT}"

pg() { sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -p "${PG_PORT}" "$@"; }

# SQL that carries a password goes in on stdin, never through `psql -c`:
# command-line arguments are readable by every local user via /proc.
DB_PASSWORD_STATE="unchanged"
DB_PASSWORD_GENERATED="false"
if [ "$(pg -tAc "SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'")" = "1" ]; then
	if [ -n "${DB_PASSWORD}" ]; then
		pg <<SQL
ALTER ROLE "${DB_USER}" WITH LOGIN PASSWORD '${DB_PASSWORD}';
SQL
		DB_PASSWORD_STATE="rotated"
		info "role ${DB_USER}: password rotated"
	else
		info "role ${DB_USER}: exists, password unchanged"
	fi
else
	if [ -z "${DB_PASSWORD}" ]; then
		DB_PASSWORD="$(openssl rand -hex 24)"
		DB_PASSWORD_GENERATED="true"
	fi
	pg <<SQL
CREATE ROLE "${DB_USER}" WITH LOGIN PASSWORD '${DB_PASSWORD}';
SQL
	DB_PASSWORD_STATE="created"
	info "role ${DB_USER}: created"
fi

if [ "$(pg -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" = "1" ]; then
	info "database ${DB_NAME}: exists"
else
	sudo -u postgres createdb -p "${PG_PORT}" -O "${DB_USER}" "${DB_NAME}"
	info "database ${DB_NAME}: created, owner ${DB_USER}"
fi
# Only the app role (and superusers) may connect.
pg <<SQL
REVOKE ALL ON DATABASE "${DB_NAME}" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE "${DB_NAME}" TO "${DB_USER}";
SQL

# Fail now, before nginx and TLS, if the API env file cannot be written.
if [ ! -f "${API_ENV}" ] && [ "${DB_PASSWORD_STATE}" = "unchanged" ]; then
	die "role ${DB_USER} exists but ${API_ENV} does not, so its password is unknown.
       Re-run with DB_PASSWORD=<new URL-safe password> to set one and write the file."
fi

# =============================================================================
# [5] Deploy root
# =============================================================================
log "[5/9] Deploy root ${APP_DIR}"
install -d -m 755 "${APP_DIR}"
chown "${APP_USER}:${APP_USER}" "${APP_DIR}"
sudo -u "${APP_USER}" mkdir -p "${APP_DIR}/logs" "${APP_DIR}/apps/api" "${APP_DIR}/apps/payments-sandbox"

# nginx runs as www-data and must reach apps/web/dist. Ubuntu creates home
# directories as 0750, so grant traverse (o+x) on each parent: no listing, and
# the mode-600 env files stay unreadable.
d="${APP_DIR}"
while [ "${d}" != "/" ]; do
	chmod o+x "${d}"
	d="$(dirname "${d}")"
done

# =============================================================================
# [6] App env files (only when absent; existing secrets are never replaced)
#
# Written before nginx and TLS so a generated DB password is on disk even if a
# later step fails. The scheme is predicted: https when a certificate exists or
# one is about to be requested. The summary flags it if that did not work out.
# =============================================================================
log "[6/9] Env files"
if [ -f "${CERT_DIR}/fullchain.pem" ] || [ "${WANT_TLS}" = "true" ]; then SCHEME="https"; else SCHEME="http"; fi

# The API and the sandbox share one API key. Reuse it from whichever file
# already has it, so writing only the missing file keeps them in step.
PROVIDER_KEY=""
if [ -f "${API_ENV}" ]; then PROVIDER_KEY="$(env_value "${API_ENV}" PAYMENT_PROVIDER_API_KEY)"; fi
if [ -z "${PROVIDER_KEY}" ] && [ -f "${SANDBOX_ENV}" ]; then PROVIDER_KEY="$(env_value "${SANDBOX_ENV}" SANDBOX_API_KEY)"; fi
PROVIDER_KEY="${PROVIDER_KEY:-$(openssl rand -hex 24)}"

if [ "${SCHEME}" = "https" ]; then COOKIE_SECURE="true"; else COOKIE_SECURE="false"; fi

# Create with umask 077 so the file is never readable by others, even briefly.
write_env() {
	local file="$1"
	if [ -e "${file}" ]; then
		cat > /dev/null
		info "${file} exists, left unchanged"
		return 0
	fi
	(umask 077 && cat > "${file}")
	chown "${APP_USER}:${APP_USER}" "${file}"
	chmod 600 "${file}"
	info "${file} written (mode 600)"
}

write_env "${API_ENV}" <<EOF
# Written by .deploy/vps-setup.sh on $(date -u +%Y-%m-%d). Never commit this file.
# Every supported variable and its default: apps/api/.env.example, .deploy/README.md
NODE_ENV=production
PORT=4001
BIND_HOST=127.0.0.1
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_NAME}
JWT_SECRET=$(openssl rand -hex 32)
CORS_ORIGIN=${SCHEME}://${DOMAIN}
COOKIE_SECURE=${COOKIE_SECURE}
TRUST_PROXY=1
PAYMENT_PROVIDER_URL=http://127.0.0.1:4002
PAYMENT_PROVIDER_API_KEY=${PROVIDER_KEY}
LOG_LEVEL=info
EOF

write_env "${SANDBOX_ENV}" <<EOF
# Written by .deploy/vps-setup.sh on $(date -u +%Y-%m-%d). Never commit this file.
# Every supported variable and its default: apps/payments-sandbox/.env.example
NODE_ENV=production
SANDBOX_PORT=4002
SANDBOX_BIND_HOST=127.0.0.1
SANDBOX_API_KEY=${PROVIDER_KEY}
EOF

# =============================================================================
# [7] nginx
# =============================================================================
log "[7/9] nginx"
install -d -m 755 "${ACME_WEBROOT}"

render() {
	sed -e "s|example\.com|${DOMAIN}|g" -e "s|/home/deploy/trial-booking|${APP_DIR}|g" "$1"
}

# Write snippets + vhost, keep the previous files, and put them back if
# `nginx -t` rejects the result, so a bad template never reaches a reload.
install_nginx() {
	local vhost_template="$1" backup f
	backup="$(mktemp -d)"
	for f in "${SNIPPETS[@]}"; do
		if [ -f "${NGINX_SNIPPET_DIR}/${f}" ]; then cp -a "${NGINX_SNIPPET_DIR}/${f}" "${backup}/"; fi
	done
	if [ -f "${NGINX_AVAILABLE}" ]; then cp -a "${NGINX_AVAILABLE}" "${backup}/vhost"; fi

	for f in "${SNIPPETS[@]}"; do
		render "${SCRIPT_DIR}/snippets/${f}" > "${NGINX_SNIPPET_DIR}/${f}"
		chmod 644 "${NGINX_SNIPPET_DIR}/${f}"
	done
	render "${SCRIPT_DIR}/${vhost_template}" > "${NGINX_AVAILABLE}"
	chmod 644 "${NGINX_AVAILABLE}"
	ln -sfn "${NGINX_AVAILABLE}" "${NGINX_ENABLED}"
	rm -f /etc/nginx/sites-enabled/default

	if nginx -t; then
		systemctl reload nginx
		rm -rf "${backup}"
		info "installed ${vhost_template}"
		return 0
	fi

	warn "nginx -t failed, restoring the previous configuration"
	for f in "${SNIPPETS[@]}"; do
		if [ -f "${backup}/${f}" ]; then cp -a "${backup}/${f}" "${NGINX_SNIPPET_DIR}/"; fi
	done
	if [ -f "${backup}/vhost" ]; then cp -a "${backup}/vhost" "${NGINX_AVAILABLE}"; else rm -f "${NGINX_ENABLED}"; fi
	rm -rf "${backup}"
	die "the rendered nginx config did not pass 'nginx -t'. Nothing was reloaded."
}

# Key off the certificate on disk, not WANT_TLS, so a re-run without
# CERTBOT_EMAIL never downgrades a working HTTPS site to HTTP.
if [ -f "${CERT_DIR}/fullchain.pem" ]; then
	install_nginx nginx-tls.conf
else
	install_nginx nginx.conf
fi

# =============================================================================
# [8] Firewall: SSH, 80, 443. Ports 4001/4002/5432 stay closed; nginx is the
# only way in, and the apps and Postgres listen on loopback anyway.
# =============================================================================
log "[8/9] UFW"
ufw default deny incoming
ufw default allow outgoing
for p in "${SSH_PORTS[@]}"; do
	ufw allow "${p}/tcp" comment 'ssh'
done
ufw allow 80/tcp comment 'http'
ufw allow 443/tcp comment 'https'
ufw --force enable
ufw status verbose

# =============================================================================
# [9] TLS: certbot certonly (never --nginx, which would rewrite the vhost)
# =============================================================================
log "[9/9] TLS"
if [ -f "${CERT_DIR}/fullchain.pem" ]; then
	info "certificate for ${DOMAIN} already present; certbot.timer renews it"
elif [ "${WANT_TLS}" = "true" ]; then
	# HTTP-01 needs a public A/AAAA record for DOMAIN pointing at this server.
	if certbot certonly --webroot -w "${ACME_WEBROOT}" \
		--cert-name "${DOMAIN}" -d "${DOMAIN}" \
		--email "${CERTBOT_EMAIL}" --agree-tos --non-interactive --keep-until-expiring; then
		install_nginx nginx-tls.conf
	else
		warn "certbot failed. Check that ${DOMAIN} resolves to this server and port 80 is reachable, then re-run."
	fi
else
	info "skipped: set DOMAIN (not example.com) and CERTBOT_EMAIL to request a certificate"
fi

if [ -f "${CERT_DIR}/fullchain.pem" ]; then
	install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
	cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
# Written by trial-booking .deploy/vps-setup.sh: pick up renewed certificates.
systemctl reload nginx
HOOK
	chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
	HAVE_CERT="true"
else
	HAVE_CERT="false"
fi

# =============================================================================
# PM2 systemd unit
# =============================================================================
log "PM2 startup"
# `pm2 startup` only prints the root command it needs; run that command
# directly instead of evaluating captured output. It bakes the current Node
# path into the unit, so re-run this script after changing NODE_MAJOR.
NODE_BIN_DIR="$(app_sh 'dirname "$(command -v node)"')"
env PATH="${NODE_BIN_DIR}:${PATH}" "${NODE_BIN_DIR}/pm2" startup systemd -u "${APP_USER}" --hp "${APP_HOME}" >/dev/null
systemctl enable "pm2-${APP_USER}" >/dev/null 2>&1 || true
info "pm2-${APP_USER}.service enabled; it restores the list saved by 'pm2 save'"

# =============================================================================
# Consistency checks between the env files and what was provisioned
# =============================================================================
if [ "${DB_PASSWORD_STATE}" != "unchanged" ] && [ "$(env_value "${API_ENV}" DATABASE_URL)" != "postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_NAME}" ]; then
	warn "the ${DB_USER} password was ${DB_PASSWORD_STATE} but ${API_ENV} holds another DATABASE_URL."
	if [ "${DB_PASSWORD_GENERATED}" = "true" ]; then
		# Printed once, on purpose: it is stored nowhere else.
		info "Set this in ${API_ENV}, then: pm2 restart trial-booking-api trial-booking-worker"
		info "DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_NAME}"
	else
		info "Update DATABASE_URL there with the DB_PASSWORD you passed, then restart the API and worker."
	fi
fi

if [ "${HAVE_CERT}" = "true" ] && [ "$(env_value "${API_ENV}" COOKIE_SECURE)" = "false" ]; then
	warn "TLS is active but ${API_ENV} still has COOKIE_SECURE=false."
	info "Set COOKIE_SECURE=true and CORS_ORIGIN=https://${DOMAIN}, then: pm2 restart trial-booking-api"
fi

if [ "${HAVE_CERT}" = "false" ] && [ "$(env_value "${API_ENV}" COOKIE_SECURE)" = "true" ]; then
	warn "no certificate yet, but ${API_ENV} has COOKIE_SECURE=true: logins fail over plain HTTP."
	info "Fix DNS for ${DOMAIN} and re-run this script, or set COOKIE_SECURE=false and CORS_ORIGIN=http://${DOMAIN}."
fi

# =============================================================================
# Summary
# =============================================================================
HOST_KEY="$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || true)"
FIRST_SSH_PORT="${SSH_PORTS[0]}"
if [ "${FIRST_SSH_PORT}" = "22" ]; then KNOWN_HOST="<VPS_HOST>"; else KNOWN_HOST="[<VPS_HOST>]:${FIRST_SSH_PORT}"; fi

cat <<EOF

============================================================
 trial-booking server ready
============================================================
 URL          : $([ "${HAVE_CERT}" = "true" ] && echo https || echo http)://${DOMAIN}
 Deploy root  : ${APP_DIR}  (set the DEPLOY_PATH repository variable to this)
 Deploy user  : ${APP_USER}
 Env files    : ${API_ENV}
                ${SANDBOX_ENV}
                Review both against the .env.example files after the first deploy.
 Database     : ${DB_NAME} on 127.0.0.1:${PG_PORT}, role ${DB_USER}

 GitHub repository secrets:
   VPS_HOST      this server's public address or DNS name
   VPS_USER      ${APP_USER}
   VPS_PORT      ${FIRST_SSH_PORT}
   VPS_SSH_KEY   private half of the deploy key (public half in ${AUTH_KEYS})
   VPS_HOST_KEY  this line, with <VPS_HOST> replaced by the exact VPS_HOST value:
                 ${KNOWN_HOST} ${HOST_KEY:-<no ed25519 host key found>}
 GitHub repository variables:
   DEPLOY_PATH         ${APP_DIR}
   SHOW_DEMO_ACCOUNTS  optional, "true" shows the seeded demo logins

 Then push to main (or run the Deploy workflow). Runbook: .deploy/README.md
============================================================
EOF
