"""Verify the immutable trial image using own isolated synthetic PostgreSQL16."""
import argparse
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shlex
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--image-id', required=True)
parser.add_argument('--scope-only', action='store_true')
parser.add_argument('--evidence-name', choices=['detail-loading-image-tests.json', 'detail-loading-postgres-red.json'], default='detail-loading-image-tests.json')
parser.add_argument('--consent', required=True, choices=['synthetic-only'])
args = parser.parse_args()
assert re.fullmatch(r'sha256:[a-f0-9]{64}', args.image_id)
root = Path(__file__).resolve().parents[2]


def remote(command, content=None, timeout=90, require=True):
    result = subprocess.run(['ssh', '-oBatchMode=yes', '-oStrictHostKeyChecking=yes', '-oConnectTimeout=15', 'root@139.100.220.7', shlex.join(command)], input=content, text=True, encoding='utf-8', capture_output=True, timeout=timeout)
    if require and result.returncode:
        raise RuntimeError('Synthetic command failed: ' + command[0] + ':' + str(result.returncode) + ':' + result.stderr[-1000:])
    return result


identity = 'hh-format-image-tests-' + uuid.uuid4().hex
pg, node, folder = identity + '-pg', identity + '-node', '/tmp/' + identity
database_name = 'hh_matrix_output_acceptance_' + uuid.uuid4().hex
database = 'postgresql://hh_agent@127.0.0.1:5432/' + database_name
env = '''APP_ORIGIN=https://synthetic-integration.invalid
INTERNAL_APP_ORIGIN=http://127.0.0.1:3000
GOOGLE_OAUTH_CLIENT_ID=synthetic-client
GOOGLE_OAUTH_REDIRECT_URI=https://synthetic-integration.invalid/api/integrations/google-drive/oauth/callback
GOOGLE_OAUTH_DEPLOYMENT_MODE=testing
ROUTERAI_ENDPOINT=https://synthetic-provider.invalid/chat/completions
ROUTERAI_MODEL=synthetic-test-model
ROUTERAI_STRUCTURED_OUTPUTS=true
E2E_ENVIRONMENT=staging
CANDIDATE_PIPELINE_BUILD_ID=isolated-formatting-integration
MEDIA_PROCESSOR_URL=http://127.0.0.1:4311/v1/extract-audio
MEDIA_PROCESSOR_HOST=127.0.0.1
MEDIA_PROCESSOR_PORT=4311
DOCUMENT_PROCESSOR_URL=http://127.0.0.1:4312/v1/extract-document
DOCUMENT_PROCESSOR_HOST=127.0.0.1
DOCUMENT_PROCESSOR_PORT=4312
'''
credentials = {'database-url': database, 'google-oauth-client-secret': 'synthetic-client-secret',
 'google-oauth-keyring.json': json.dumps({'activeVersion': 'synthetic-v1', 'keys': {'synthetic-v1': base64.urlsafe_b64encode(bytes(32)).decode().rstrip('=')}}),
 'routerai-api-key': 'synthetic-provider-key', 'assemblyai-api-key': 'synthetic-stt-key', 'telegram-bot-token': 'synthetic-telegram-token',
 'telegram-recipients.json': '[]', 'internal-service-tokens.json': '{}', 'rabbitmq-password': 'synthetic-rabbit-password'}
files = {'.runtime/runtime.env': env}
files.update({'.runtime/credentials/' + name: value for name, value in credentials.items()})
extra_tests = ['tests/workspace-candidate-scope.postgres.acceptance.test.ts', 'tests/candidate-assessment-formatting.acceptance.test.mjs', 'tests/matrix-output-budget.acceptance.integration.test.ts', 'tests/abc-direction-provider-contract.acceptance.test.ts']
files.update({name: (root / 'web' / name).read_text(encoding='utf-8') for name in extra_tests})
commands = ['node --import tsx scripts/postgres-migrate.ts',
 'node --test tests/candidate-assessment-formatting.acceptance.test.mjs',
 'node --import tsx --test server/google-drive-oauth/postgres-repository.integration.test.ts server/google-drive-oauth/my-drive-adapter.test.ts server/storage/private-temp.test.ts server/candidate-pipeline/production-runtime.integration.test.ts server/candidate-pipeline/matrix-postgres-repository.integration.test.ts server/agent-runtime/terminal-task-retirement-postgres.integration.test.ts',
 'node --import tsx --test server/candidate-pipeline/assessment-join.acceptance.test.ts tests/abc-direction-provider-contract.acceptance.test.ts',
 'node --import tsx --test tests/matrix-output-budget.acceptance.integration.test.ts']
scope_database_name = 'hh_workspace_scope_acceptance_' + uuid.uuid4().hex
scope_database = 'postgresql://hh_agent@127.0.0.1:5432/' + scope_database_name
commands.append('TEST_DATABASE_URL=' + shlex.quote(scope_database) + ' HH_WORKSPACE_SCOPE_ACCEPTANCE_CONSENT=isolated-synthetic-only node --import tsx --test tests/workspace-candidate-scope.postgres.acceptance.test.ts')
if args.scope_only:
    commands = [commands[-1]]
files['image-tests.sh'] = 'set -eu\n' + '\n'.join(commands) + '\n'
created_pg = created_node = False
try:
    upload = "import pathlib,json; p=pathlib.Path(" + repr(folder) + "); p.mkdir(mode=0o700); files=json.loads(input()); [(p/k).parent.mkdir(parents=True,exist_ok=True) for k in files]; [(p/k).write_text(v) for k,v in files.items()]"
    remote(['python3', '-c', upload], json.dumps(files) + '\n')
    remote(['docker', 'run', '-d', '--name', pg, '--network', 'none', '--memory', '384m', '--cpus', '1', '--pids-limit', '150', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '-e', 'POSTGRES_USER=hh_agent', '-e', 'POSTGRES_DB=' + database_name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine'])
    created_pg = True
    for attempt in range(45):
        if remote(['docker', 'exec', pg, 'pg_isready', '-h', '127.0.0.1', '-U', 'hh_agent', '-d', database_name], require=False).returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Synthetic PostgreSQL not ready')
    remote(['docker', 'exec', pg, 'createdb', '-U', 'hh_agent', scope_database_name])
    remote(['docker', 'create', '--name', node, '--network', 'container:' + pg, '--memory', '768m', '--cpus', '1', '--pids-limit', '150', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:rw,size=64m', '-w', '/app/web', '-e', 'TEST_DATABASE_URL=' + database, '-e', 'MATRIX_TEST_POSTGRES_URL=' + database, '-e', 'HH_RUNTIME_CONFIG_ROOT=/app/web/.runtime', '--entrypoint', '/bin/sh', args.image_id, '-ec', '/bin/sh /app/web/image-tests.sh'])
    created_node = True
    remote(['docker', 'cp', folder + '/.', node + ':/app/web'])
    run = remote(['docker', 'start', '-a', node], timeout=300, require=False)
    code = int(remote(['docker', 'inspect', node, '--format', '{{.State.ExitCode}}']).stdout.strip())
    skips = [int(value) for value in re.findall(r'^# skipped (\d+)', run.stdout, re.MULTILINE)]
    if code == 0 and (not skips or any(skips)):
        code = 3
    evidence = {'generatedAtUtc': datetime.now(timezone.utc).isoformat(), 'status': 'PASSED' if code == 0 else 'FAILED', 'imageId': args.image_id, 'commands': commands, 'exitCode': code,
                'skippedByGroup': skips, 'stdout': run.stdout, 'stderr': run.stderr, 'productionWrites': False, 'externalProviderCalls': False, 'environment': 'Own PostgreSQL16, network none, synthetic credentials, Node22 packaged source'}
    (root / 'openspec/changes/format-candidate-assessment-text/evidence' / args.evidence_name).write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    print(json.dumps({'status': evidence['status'], 'exitCode': code, 'stdoutTail': run.stdout[-2300:], 'stderrTail': run.stderr[-800:]}))
    raise SystemExit(code)
finally:
    if created_node:
        remote(['docker', 'rm', '-f', node])
    if created_pg:
        remote(['docker', 'rm', '-f', pg])
    remote(['python3', '-c', "import pathlib,shutil; p=pathlib.Path(" + repr(folder) + "); assert p.parent==pathlib.Path('/tmp') and p.name.startswith('hh-format-image-tests-'); shutil.rmtree(p,ignore_errors=True)"])
