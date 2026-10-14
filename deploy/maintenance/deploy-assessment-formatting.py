"""Reversible candidate assessment formatting trial rollout. Run only on the authorized VPS.

Preserves data services and credentials. Public intake is paused while internal
tools remain available for draining. No migrations, provider probes or log reads.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
from datetime import datetime, timezone

BASE = "f5995e2b74db4c7f6810f5d16056dac5251fd084"
RELEASE = ""
OLD_IMAGE = "sha256:4a06887617318b49e6b88da5b38f25b9b0e5ad7b1b761e23de15928930bee49c"
RUNTIME_SHA = "3cda817c384010ecf1953c2cf08aaaadb73755bb444f8c89505aa87231592664"
SERVICES = ("web", "worker", "dispatch-publisher", "media-processor", "document-processor",
            "worker-control", "worker-documents", "worker-media", "worker-transcription",
            "worker-llm", "worker-reports", "worker-drive", "worker-notifications")
ROOT = Path("/root/hr")
RECORD = Path("/opt/hh-ops-releases/assessment-formatting")
NGINX = "/etc/nginx/conf.d/hh-web.conf"


def call(command, *, content=None, timeout=120):
    result = subprocess.run(command, input=content, text=True, encoding="utf-8",
                            capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("COMMAND_FAILED:" + command[0] + ":" + str(result.returncode))
    return result.stdout


def compose(*arguments):
    return ["docker", "compose", "-p", "hh-agent", "--project-directory", str(ROOT / "deploy/docker"),
            "-f", str(ROOT / "deploy/docker/docker-compose.yml"),
            "-f", str(ROOT / "deploy/docker/docker-compose.vps.yml"), *arguments]


def sql_snapshot():
    source = """BEGIN READ ONLY; SET LOCAL statement_timeout='3s';
SELECT json_build_object(
 'activeRuns',(SELECT count(*) FROM agent_runs WHERE state='ACTIVE'),
 'runningTasks',(SELECT count(*) FROM agent_tasks WHERE state='RUNNING'),
 'runningAttempts',(SELECT count(*) FROM agent_attempts WHERE state='RUNNING'),
 'unsafeEffects',(SELECT count(*) FROM agent_outbox o LEFT JOIN agent_tasks t ON t.idempotency_identity=o.operation_identity LEFT JOIN agent_runs r ON r.id=t.run_id WHERE o.state='SENDING' OR (o.state='UNKNOWN_OUTCOME' AND (t.state IS DISTINCT FROM 'SUCCEEDED' OR r.state IS DISTINCT FROM 'SUCCEEDED'))),
 'historicalResolvedUnknownEffects',(SELECT count(*) FROM agent_outbox o JOIN agent_tasks t ON t.idempotency_identity=o.operation_identity JOIN agent_runs r ON r.id=t.run_id WHERE o.state='UNKNOWN_OUTCOME' AND t.state='SUCCEEDED' AND r.state='SUCCEEDED'),
 'terminalPending',(SELECT count(*) FROM agent_tasks t JOIN agent_runs r ON r.id=t.run_id WHERE r.state IN ('FAILED','CANCELLED','SUPERSEDED') AND t.state IN ('PENDING','RUNNABLE','WAITING') AND t.lease_owner IS NULL AND t.lease_expires_at IS NULL)); COMMIT;"""
    return json.loads(call(["docker", "exec", "-i", "-u", "postgres", "hh-agent-postgres-1", "psql", "-X", "-U", "hh_agent", "-d", "hh_agent", "-Atq", "-v", "ON_ERROR_STOP=1"], content=source))


def image_id(reference):
    return call(["docker", "image", "inspect", reference, "--format", "{{.Id}}" ]).strip()


def containers():
    ids = call(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=hh-agent"]).split()
    return json.loads(call(["docker", "inspect", *ids]))


def set_build_id(value):
    target = ROOT / "deploy/docker/.env"
    assert target.is_file() and not target.is_symlink()
    metadata = target.stat()
    text = target.read_text()
    replacement = "CANDIDATE_PIPELINE_BUILD_ID=" + value
    changed, count = re.subn(r"(?m)^CANDIDATE_PIPELINE_BUILD_ID=.*$", replacement, text)
    assert count == 1
    temporary = target.with_name(".env.assessment-formatting.new")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, metadata.st_mode & 0o777)
    with os.fdopen(fd, "w") as stream:
        stream.write(changed)
        stream.flush()
        os.fsync(stream.fileno())
    os.chown(temporary, metadata.st_uid, metadata.st_gid)
    os.chmod(temporary, metadata.st_mode & 0o777)
    os.replace(temporary, target)


def processing_ready():
    code = "fetch('http://127.0.0.1:3000/api/health/processing').then(async r=>{const v=await r.json();process.exit(r.ok&&v.ready===true?0:1)}).catch(()=>process.exit(1))"
    for _ in range(45):
        result = subprocess.run(["docker", "exec", "hh-agent-web-1", "node", "-e", code], capture_output=True, timeout=15)
        if result.returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError("PROCESSING_READINESS_FAILED")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-id", required=True)
    parser.add_argument("--release-sha", required=True)
    parser.add_argument("--consent", required=True, choices=["user-authorized-assessment-formatting"])
    args = parser.parse_args()
    global RELEASE, RECORD
    assert re.fullmatch(r"[a-f0-9]{40}", args.release_sha)
    RELEASE = args.release_sha
    RECORD = Path("/opt/hh-ops-releases/assessment-formatting-" + RELEASE[:7])
    assert os.geteuid() == 0 and re.fullmatch(r"sha256:[a-f0-9]{64}", args.image_id)
    lock = open("/run/lock/hh-approved-code-deploy.lock", "w")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    assert not call(["git", "-C", str(ROOT), "status", "--porcelain"]).strip()
    assert call(["git", "-C", str(ROOT), "rev-parse", "HEAD"]).strip() == BASE
    assert call(["git", "-C", str(ROOT), "rev-parse", "origin/production"]).strip() == RELEASE
    assert image_id(args.image_id) == args.image_id
    assert image_id("hh-agent:local") == OLD_IMAGE
    probe = "const fs=require('node:fs'),c=require('node:crypto');console.log(c.createHash('sha256').update(fs.readFileSync('/app/web/server/agent-runtime/postgres-runtime-repository.ts')).digest('hex'))"
    assert call(["docker", "run", "--rm", "--network", "none", "--read-only", "--entrypoint", "node", args.image_id, "-e", probe]).strip() == RUNTIME_SHA
    public_files = ["app/api/workspace/route.ts", "server/product/application.ts", "app/page.tsx", "app/globals.css", "app/assessment-text.tsx", "server/product/postgres-repository.ts", "server/configuration/runtime.ts", "server/llm/artifacts.ts", "server/candidate-pipeline/assessment-join.ts", "server/candidate-pipeline/production-runtime.ts", "package.json"]
    expected = {name: hashlib.sha256(subprocess.check_output(["git", "-C", str(ROOT), "show", RELEASE + ":web/" + name])).hexdigest() for name in public_files}
    probe_files = "const fs=require('fs'),c=require('crypto');const names=JSON.parse(process.argv[1]);console.log(JSON.stringify(Object.fromEntries(names.map(n=>[n,c.createHash('sha256').update(fs.readFileSync('/app/web/'+n)).digest('hex')]))))"
    actual = json.loads(call(["docker", "run", "--rm", "--network", "none", "--read-only", "--entrypoint", "node", args.image_id, "-e", probe_files, json.dumps(public_files)]))
    assert expected == actual, "PUBLIC_SOURCE_IMAGE_MISMATCH"
    assert not call(["git", "-C", str(ROOT), "diff", "--name-only", BASE, RELEASE, "web/drizzle-postgres", "web/package-lock.json", "deploy/docker", "web/Dockerfile"]).strip(), "UNRELATED_DEPLOYMENT_CHANGE"
    state = sql_snapshot()
    assert state["unsafeEffects"] == 0
    assert state["runningTasks"] == state["runningAttempts"] == state["activeRuns"] == 0, "NOT_IDLE"
    before = containers()
    counts = {service: 0 for service in SERVICES}
    infrastructure = {}
    for item in before:
        service = item["Config"]["Labels"]["com.docker.compose.service"]
        if service in counts:
            assert item["State"]["Running"] and item["Image"] == OLD_IMAGE
            counts[service] += 1
        elif service in ("postgres", "rabbitmq", "nginx", "certbot"):
            infrastructure[item["Name"]] = {"id": item["Id"], "startedAt": item["State"]["StartedAt"]}
    assert all(counts.values())
    envfile = ROOT / "deploy/docker/.env"
    assert not envfile.is_symlink()
    old_builds = re.findall(r"(?m)^CANDIDATE_PIPELINE_BUILD_ID=(.*)$", envfile.read_text())
    assert len(old_builds) == 1
    old_build = old_builds[0]
    if not RECORD.parent.exists():
        RECORD.parent.mkdir(mode=0o700)
    assert not RECORD.parent.is_symlink()
    RECORD.mkdir(mode=0o700)
    original_nginx = call(["docker", "exec", "hh-agent-nginx-1", "cat", NGINX])
    marker = "        set $web_upstream web:3000;"
    assert original_nginx.count(marker) == 1
    maintenance_nginx = original_nginx.replace(marker, "        return 503; # temporary authorized deployment\n" + marker)
    journal = {"releaseSha": RELEASE, "candidateImageId": args.image_id, "previousImageId": OLD_IMAGE,
               "userAuthorizedReversibleTrial": True, "fullE2EStatus": "BLOCKED", "before": state,
               "previousBuildId": old_build, "publicSourceHashes": actual, "serviceReplicas": counts,
               "infrastructureBefore": infrastructure, "phases": []}
    (RECORD / "nginx.before.conf").write_text(original_nginx)
    os.chmod(RECORD / "nginx.before.conf", 0o600)

    def phase(name):
        journal["phases"].append({"name": name, "atUtc": datetime.now(timezone.utc).isoformat()})
        temporary = RECORD / "deployment.json.new"
        temporary.write_text(json.dumps(journal, indent=2) + "\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, RECORD / "deployment.json")
        print(json.dumps({"phase": name}), flush=True)

    def nginx_config(content):
        file = RECORD / "nginx.apply.conf"
        file.write_text(content)
        os.chmod(file, 0o600)
        call(["docker", "cp", str(file), "hh-agent-nginx-1:" + NGINX])
        call(["docker", "exec", "hh-agent-nginx-1", "nginx", "-t"])
        call(["docker", "exec", "hh-agent-nginx-1", "nginx", "-s", "reload"])

    def up(services):
        scaling = [argument for service in services for argument in ("--scale", service + "=" + str(counts[service]))]
        call(compose("up", "-d", "--no-build", "--no-deps", "--pull", "never", *scaling, *services), timeout=240)

    switched = False
    maintenance = False
    safe_to_restore_intake = False
    try:
        call(["docker", "tag", OLD_IMAGE, "hh-agent:before-formatting-" + RELEASE[:7]])
        phase("ROLLBACK_IMAGE_PINNED")
        maintenance = True
        nginx_config(maintenance_nginx)
        phase("PUBLIC_INTAKE_PAUSED")
        call(compose("stop", "--timeout", "90", "worker"), timeout=120)
        # The precondition was idle; recheck after discovery is fully stopped.
        idle = sql_snapshot()
        assert idle["activeRuns"] == idle["runningTasks"] == idle["runningAttempts"] == idle["unsafeEffects"] == 0, "WORK_APPEARED_ABORT_WITHOUT_SWITCH"
        phase("DISCOVERY_STOPPED_AND_IDLE_RECONFIRMED")
        call(compose("stop", "--timeout", "60", *[s for s in SERVICES if s != "worker"]), timeout=180)
        call(["git", "-C", str(ROOT), "merge", "--ff-only", RELEASE])
        switched = True
        set_build_id(RELEASE)
        call(["docker", "tag", args.image_id, "hh-agent:local"])
        up([s for s in SERVICES if s != "worker"])
        phase("APPLICATION_RECREATED")
        processing_ready()
        for item in containers():
            service = item["Config"]["Labels"]["com.docker.compose.service"]
            if service in counts and service != "worker":
                assert item["State"]["Running"] and item["Image"] == args.image_id
        phase("PROCESSING_READY")
        up(["worker"])
        processing_ready()
        after = containers()
        actual_infrastructure = {i["Name"]: {"id": i["Id"], "startedAt": i["State"]["StartedAt"]} for i in after if i["Name"] in infrastructure}
        assert actual_infrastructure == infrastructure
        actual_counts = {service: 0 for service in SERVICES}
        for item in after:
            service = item["Config"]["Labels"]["com.docker.compose.service"]
            if service in counts:
                assert item["State"]["Running"] and item["Image"] == args.image_id
                actual_counts[service] += 1
        assert actual_counts == counts
        journal["after"] = sql_snapshot()
        safe_to_restore_intake = True
        nginx_config(original_nginx)
        maintenance = False
        journal["status"] = "DEPLOYED"
        phase("DEPLOYED")
    except Exception as error:
        safe_to_restore_intake = False
        journal["failureClass"] = type(error).__name__
        phase("DEPLOYMENT_FAILED")
        if switched:
            # Discovery may have resumed before a late postcheck failed. Never
            # replace the new workers while a newly discovered run is active.
            maintenance = True
            nginx_config(maintenance_nginx)
            call(compose("stop", "--timeout", "90", "worker"), timeout=120)
            rollback_idle = sql_snapshot()
            assert rollback_idle["activeRuns"] == rollback_idle["runningTasks"] == rollback_idle["runningAttempts"] == rollback_idle["unsafeEffects"] == 0, "NEW_WORK_REQUIRES_SAFE_DRAIN_BEFORE_ROLLBACK"
            call(["docker", "tag", OLD_IMAGE, "hh-agent:local"])
            set_build_id(old_build)
            # Clean checkout only; no reset/down migration or state restoration.
            assert not call(["git", "-C", str(ROOT), "status", "--porcelain"]).strip()
            call(["git", "-C", str(ROOT), "switch", "--detach", BASE])
            up(list(SERVICES))
            processing_ready()
            safe_to_restore_intake = True
            journal["status"] = "ROLLED_BACK"
            phase("ROLLED_BACK")
        else:
            up(list(SERVICES))
            processing_ready()
            safe_to_restore_intake = True
            journal["status"] = "ABORTED_WITHOUT_IMAGE_SWITCH"
            phase("ABORTED_WITHOUT_IMAGE_SWITCH")
        raise
    finally:
        if maintenance and safe_to_restore_intake:
            nginx_config(original_nginx)
            phase("PUBLIC_INTAKE_RESTORED")
        elif maintenance:
            journal["status"] = "MANUAL_RECOVERY_REQUIRED_INTAKE_PAUSED"
            phase("INTAKE_REMAINS_PAUSED")


if __name__ == "__main__":
    main()
