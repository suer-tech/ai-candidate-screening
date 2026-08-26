#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then echo "Run as root" >&2; exit 1; fi
source_root="${1:-}"
build_id="${2:-}"
domain="${3:-}"
if [[ -z "${source_root}" || ! -f "${source_root}/web/package-lock.json" || ! "${build_id}" =~ ^[A-Za-z0-9._-]{6,128}$ || ! "${domain}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,63}$ || "${domain}" == *..* ]]; then
  echo "Usage: install.sh /absolute/path/to/hh immutable-build-id public.example.org" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg nginx ufw age openssl sudo postgresql-common certbot
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes --output /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor --yes --output /etc/apt/keyrings/postgresql.gpg
echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "${VERSION_CODENAME}")-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y nodejs postgresql-16 postgresql-client-16

id hh-agent >/dev/null 2>&1 || useradd --system --home /var/lib/hh-agent --shell /usr/sbin/nologin hh-agent
id hh-backup >/dev/null 2>&1 || useradd --system --home /var/backups/hh-agent --shell /usr/sbin/nologin hh-backup
install -d -o hh-agent -g hh-agent -m 0750 /opt/hh-agent/releases /var/lib/hh-agent /var/log/hh-agent
install -d -o root -g hh-agent -m 0750 /etc/hh-agent /etc/hh-agent/credentials
install -d -o hh-backup -g hh-backup -m 0700 /var/backups/hh-agent

release_root="/opt/hh-agent/releases/${build_id}"
if [[ -e "${release_root}" ]]; then echo "Immutable release already exists" >&2; exit 1; fi
install -d -o hh-agent -g hh-agent -m 0750 "${release_root}"
tar -C "${source_root}" -cf - \
  --exclude='web/.runtime' --exclude='web/candidate' --exclude='web/.wrangler' \
  --exclude='web/.output' --exclude='web/node_modules' --exclude='web/test-results' --exclude='web/playwright-report' \
  --exclude='web/.env' --exclude='web/.env.*' --exclude='web/.dev.vars' web | tar -C "${release_root}" -xf -
chown -R hh-agent:hh-agent "${release_root}"
sudo -u hh-agent bash -lc "cd '${release_root}/web' && npm ci && npm run build"
ln -sfn "${release_root}" /opt/hh-agent/current

if [[ ! -f /etc/hh-agent/runtime.env ]]; then install -o root -g hh-agent -m 0640 "${source_root}/deploy/ubuntu/runtime.env.example" /etc/hh-agent/runtime.env; fi
sed -i "s#https://hire\.example\.com#https://${domain}#g; s/^CANDIDATE_PIPELINE_BUILD_ID=.*/CANDIDATE_PIPELINE_BUILD_ID=${build_id}/; s/^LLM_RELEASE_VERSION=replace-with-release-version$/LLM_RELEASE_VERSION=${build_id}/" /etc/hh-agent/runtime.env

database_password_file=/etc/hh-agent/postgres-password
if [[ ! -s "${database_password_file}" ]]; then openssl rand -hex 32 | tr -d '\r\n' > "${database_password_file}"; chmod 0600 "${database_password_file}"; fi
database_password="$(cat "${database_password_file}")"
sudo -u postgres psql --set=ON_ERROR_STOP=1 <<SQL
SELECT 'CREATE ROLE hh_agent LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='hh_agent') \gexec
ALTER ROLE hh_agent PASSWORD '${database_password}';
SELECT 'CREATE DATABASE hh_agent OWNER hh_agent' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='hh_agent') \gexec
SQL
sudo -u postgres psql --set=ON_ERROR_STOP=1 --command="ALTER SYSTEM SET listen_addresses='localhost'"
pg_hba="/etc/postgresql/16/main/pg_hba.conf"
if ! grep -q '^host hh_agent hh_agent 127\.0\.0\.1/32 scram-sha-256$' "${pg_hba}"; then echo 'host hh_agent hh_agent 127.0.0.1/32 scram-sha-256' >> "${pg_hba}"; fi
systemctl restart postgresql
printf 'postgresql://hh_agent:%s@127.0.0.1:5432/hh_agent\n' "${database_password}" > /etc/hh-agent/credentials/database-url
printf '127.0.0.1:5432:*:hh_agent:%s\n' "${database_password}" > /etc/hh-agent/postgres.pgpass
chown root:hh-agent /etc/hh-agent/credentials/database-url
chmod 0640 /etc/hh-agent/credentials/database-url /etc/hh-agent/postgres.pgpass
install -o hh-backup -g hh-backup -m 0600 /etc/hh-agent/postgres.pgpass /var/backups/hh-agent/.pgpass

if [[ ! -s /etc/hh-agent/credentials/google-oauth-keyring.json ]]; then (cd "${release_root}/web" && HH_RUNTIME_CONFIG_ROOT=/etc/hh-agent npm run generate:google-oauth-keyring); fi
if [[ ! -s /etc/hh-agent/credentials/internal-service-tokens.json ]]; then (cd "${release_root}/web" && HH_RUNTIME_CONFIG_ROOT=/etc/hh-agent npm run generate:internal-service-tokens); fi
for credential in google-oauth-client-secret routerai-api-key assemblyai-api-key telegram-bot-token telegram-recipients.json; do
  if [[ ! -e "/etc/hh-agent/credentials/${credential}" ]]; then install -o root -g hh-agent -m 0640 /dev/null "/etc/hh-agent/credentials/${credential}"; fi
done
chown root:hh-agent /etc/hh-agent/credentials/*
chmod 0640 /etc/hh-agent/credentials/*

if [[ ! -s /etc/hh-agent/backup-age-identity ]]; then age-keygen -o /etc/hh-agent/backup-age-identity 2>/etc/hh-agent/backup-age-recipient; sed -i 's/^Public key: //' /etc/hh-agent/backup-age-recipient; fi
chmod 0600 /etc/hh-agent/backup-age-identity
chmod 0644 /etc/hh-agent/backup-age-recipient
install -o hh-backup -g hh-backup -m 0600 /etc/hh-agent/backup-age-recipient /var/backups/hh-agent/age-recipient

for unit in hh-web.service hh-agent-worker.service hh-media-processor.service hh-document-processor.service hh-postgres-backup.service hh-postgres-backup.timer hh-postgres-restore-test.service hh-postgres-restore-test.timer; do
  install -m 0644 "${source_root}/deploy/ubuntu/${unit}" "/etc/systemd/system/${unit}"
done
install -m 0750 "${source_root}/deploy/ubuntu/postgres-backup.sh" /usr/local/sbin/hh-postgres-backup
install -m 0750 "${source_root}/deploy/ubuntu/postgres-restore-test.sh" /usr/local/sbin/hh-postgres-restore-test
install -o root -g hh-agent -m 0750 "${source_root}/deploy/ubuntu/production-preflight.sh" /usr/local/sbin/hh-production-preflight
install -m 0644 "${source_root}/deploy/ubuntu/nginx-hh-web.conf" /etc/nginx/sites-available/hh-web
sed -i "s/hire\.example\.com/${domain}/g" /etc/nginx/sites-available/hh-web
rm -f /etc/nginx/sites-enabled/default
systemctl disable --now nginx >/dev/null 2>&1 || true

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
systemctl daemon-reload
systemctl enable hh-postgres-backup.timer hh-postgres-restore-test.timer

echo "Repository package installed. Fill the five empty provider credential files, edit /etc/hh-agent/runtime.env, migrate PostgreSQL, and create the first HR user with npm run auth:create."
echo "Then run: sudo /usr/local/sbin/hh-production-preflight"
echo "Only after TLS and preflight: enable nginx site and start nginx, hh-media-processor, hh-document-processor, hh-web, and hh-agent-worker."
