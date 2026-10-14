"""Return only the authorized formatting trial to its pinned previous image."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re

spec = importlib.util.spec_from_file_location('formatting_rollout', Path(__file__).with_name('deploy-assessment-formatting.py'))
rollout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rollout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-sha', required=True)
    parser.add_argument('--consent', required=True, choices=['user-requested-formatting-rollback'])
    args = parser.parse_args()
    assert os.geteuid() == 0 and re.fullmatch(r'[a-f0-9]{40}', args.release_sha)
    lock = open('/run/lock/hh-approved-code-deploy.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    record = Path('/opt/hh-ops-releases/assessment-formatting-' + args.release_sha[:7])
    assert not record.is_symlink()
    journal = json.loads((record / 'deployment.json').read_text())
    assert journal['status'] == 'DEPLOYED' and journal['releaseSha'] == args.release_sha
    assert rollout.call(['git', '-C', str(rollout.ROOT), 'rev-parse', 'HEAD']).strip() == args.release_sha
    assert not rollout.call(['git', '-C', str(rollout.ROOT), 'status', '--porcelain']).strip()
    assert rollout.image_id('hh-agent:local') == journal['candidateImageId']
    counts = journal['serviceReplicas']
    actual = {service: 0 for service in rollout.SERVICES}
    for item in rollout.containers():
        service = item['Config']['Labels']['com.docker.compose.service']
        if service in actual:
            assert item['State']['Running'] and item['Image'] == journal['candidateImageId']
            actual[service] += 1
    assert actual == counts

    def require_idle():
        state = rollout.sql_snapshot()
        assert state['activeRuns'] == state['runningTasks'] == state['runningAttempts'] == state['unsafeEffects'] == 0, 'NOT_IDLE'

    def up(services):
        scaling = [argument for service in services for argument in ('--scale', service + '=' + str(counts[service]))]
        rollout.call(rollout.compose('up', '-d', '--no-build', '--no-deps', '--pull', 'never', *scaling, *services), timeout=240)

    def apply_nginx(content):
        file = record / 'rollback.nginx.apply.conf'
        file.write_text(content)
        file.chmod(0o600)
        rollout.call(['docker', 'cp', str(file), 'hh-agent-nginx-1:' + rollout.NGINX])
        rollout.call(['docker', 'exec', 'hh-agent-nginx-1', 'nginx', '-t'])
        rollout.call(['docker', 'exec', 'hh-agent-nginx-1', 'nginx', '-s', 'reload'])

    def save(status):
        temporary = record / 'rollback.json.new'
        temporary.write_text(json.dumps({'status': status, 'releaseSha': args.release_sha, 'previousImageId': journal['previousImageId']}, indent=2))
        temporary.chmod(0o600)
        os.replace(temporary, record / 'rollback.json')
        print(json.dumps({'status': status}), flush=True)

    require_idle()
    original_nginx = rollout.call(['docker', 'exec', 'hh-agent-nginx-1', 'cat', rollout.NGINX])
    marker = '        set $web_upstream web:3000;'
    assert original_nginx.count(marker) == 1
    maintenance_nginx = original_nginx.replace(marker, '        return 503; # temporary authorized formatting rollback\n' + marker)
    (record / 'rollback.nginx.before.conf').write_text(original_nginx)
    (record / 'rollback.nginx.before.conf').chmod(0o600)
    healthy = False
    intake_paused = False
    try:
        intake_paused = True
        apply_nginx(maintenance_nginx)
        rollout.call(rollout.compose('stop', '--timeout', '90', 'worker'), timeout=120)
        require_idle()
        rollout.call(rollout.compose('stop', '--timeout', '60', *[s for s in rollout.SERVICES if s != 'worker']), timeout=180)
        rollout.call(['docker', 'tag', journal['previousImageId'], 'hh-agent:local'])
        rollout.set_build_id(journal['previousBuildId'])
        rollout.call(['git', '-C', str(rollout.ROOT), 'switch', '--detach', rollout.BASE])
        up([s for s in rollout.SERVICES if s != 'worker'])
        rollout.processing_ready()
        up(['worker'])
        rollout.processing_ready()
        healthy = True
        apply_nginx(original_nginx)
        intake_paused = False
        save('ROLLED_BACK')
    except Exception:
        healthy = False
        # Keep the working trial if returning to the old application failed.
        intake_paused = True
        apply_nginx(maintenance_nginx)
        rollout.call(rollout.compose('stop', '--timeout', '90', 'worker'), timeout=120)
        require_idle()
        rollout.call(['docker', 'tag', journal['candidateImageId'], 'hh-agent:local'])
        rollout.set_build_id(args.release_sha)
        assert not rollout.call(['git', '-C', str(rollout.ROOT), 'status', '--porcelain']).strip()
        rollout.call(['git', '-C', str(rollout.ROOT), 'switch', '--detach', args.release_sha])
        up(list(rollout.SERVICES))
        rollout.processing_ready()
        healthy = True
        save('ROLLBACK_ABORTED_TRIAL_RESTORED')
        raise
    finally:
        if intake_paused and healthy:
            apply_nginx(original_nginx)
        elif intake_paused:
            save('MANUAL_RECOVERY_REQUIRED_INTAKE_PAUSED')


if __name__ == '__main__':
    main()
