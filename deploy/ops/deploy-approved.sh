#!/usr/bin/env bash
set -euo pipefail
release_sha="${1:-}"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA' >&2; exit 2; }
exec 9>/run/lock/hh-approved-code-deploy.lock
flock -n 9 || { echo 'Another candidate deployment is running' >&2; exit 3; }
cd /root/hr
test -z "$(git status --porcelain)" || { echo 'Candidate checkout has local changes' >&2; exit 4; }
git fetch --no-tags origin production
test "$(git rev-parse origin/production)" = "$release_sha" || { echo 'Production branch moved; refuse stale release' >&2; exit 5; }
git merge-base --is-ancestor HEAD "$release_sha" || { echo 'Release would replace divergent server code' >&2; exit 6; }
previous_sha="$(git rev-parse HEAD)"
docker tag hh-agent:local "hh-agent:before-${release_sha:0:8}"
git merge --ff-only "$release_sha"
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.vps.yml build web
docker tag hh-agent:local "hh-agent:${release_sha:0:8}"
python3 - "$release_sha" <<'PY'
import re
import sys
from pathlib import Path
config = Path('deploy/docker/.env')
values = config.read_text()
entry = 'CANDIDATE_PIPELINE_BUILD_ID=' + sys.argv[1]
updated, count = re.subn(r'(?m)^CANDIDATE_PIPELINE_BUILD_ID=.*$', entry, values)
if not count:
    updated = values.rstrip('\n') + '\n' + entry + '\n'
config.write_text(updated)
PY
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.vps.yml up -d --no-build --no-deps web worker dispatch-publisher media-processor document-processor worker-control worker-documents worker-media worker-transcription worker-llm worker-reports worker-drive worker-notifications
ready=false
for attempt in {1..30}; do
  if docker exec hh-agent-web-1 node -e "fetch('http://127.0.0.1:3000/api/health/processing').then(async r=>{const b=await r.json();process.exit(r.ok&&b.ready===true?0:1)}).catch(()=>process.exit(1))"; then
    ready=true
    break
  fi
  sleep 2
done
test "$ready" = true || { echo "Candidate readiness failed; previous source $previous_sha, previous image retained" >&2; exit 7; }
docker exec hh-agent-nginx-1 nginx -t
docker exec hh-agent-nginx-1 nginx -s reload
curl --fail --silent --show-error https://agent.devbpm.ru/api/health/live
echo "Candidate deployment completed: $release_sha; previous source: $previous_sha"
