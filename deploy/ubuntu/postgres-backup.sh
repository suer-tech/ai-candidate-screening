#!/usr/bin/env bash
set -euo pipefail
umask 077
backup_root=/var/backups/hh-agent
recipient_file=/var/backups/hh-agent/age-recipient
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="${backup_root}/.${timestamp}.dump.age.new"
target="${backup_root}/${timestamp}.dump.age"
test -s "${recipient_file}"
recipient="$(tr -d '\r\n' < "${recipient_file}")"
PGPASSFILE=/var/backups/hh-agent/.pgpass pg_dump --host=127.0.0.1 --username=hh_agent --dbname=hh_agent --format=custom --no-owner --no-acl \
  | age --recipient "${recipient}" --output "${temporary}"
test -s "${temporary}"
mv "${temporary}" "${target}"
(cd "${backup_root}" && sha256sum "$(basename "${target}")" > "$(basename "${target}").sha256")
find "${backup_root}" -maxdepth 1 -type f -name '*.dump.age' -mtime +14 -delete
find "${backup_root}" -maxdepth 1 -type f -name '*.dump.age.sha256' -mtime +14 -delete
printf '{"backup":"created","encrypted":true,"retentionDays":14,"secretValuesPrinted":0}\n'
