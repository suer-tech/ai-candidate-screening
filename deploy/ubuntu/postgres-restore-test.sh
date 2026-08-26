#!/usr/bin/env bash
set -euo pipefail
umask 077
latest="$(find /var/backups/hh-agent -maxdepth 1 -type f -name '*.dump.age' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
test -n "${latest}" && test -f "${latest}.sha256"
(cd "$(dirname "${latest}")" && sha256sum --check "$(basename "${latest}.sha256")" >/dev/null)
database="hh_restore_test_$(date -u +%s)"
cleanup() { sudo -u postgres dropdb --if-exists "${database}" >/dev/null; }
trap cleanup EXIT
sudo -u postgres createdb --owner=hh_agent "${database}"
age --decrypt --identity /etc/hh-agent/backup-age-identity "${latest}" \
  | PGPASSFILE=/etc/hh-agent/postgres.pgpass pg_restore --host=127.0.0.1 --username=hh_agent --dbname="${database}" --no-owner --no-acl
PGPASSFILE=/etc/hh-agent/postgres.pgpass psql --host=127.0.0.1 --username=hh_agent --dbname="${database}" --tuples-only --command='select count(*) >= 1 from __drizzle_migrations;' | grep -q t
printf '{"restore":"verified","isolated":true,"secretValuesPrinted":0}\n'
