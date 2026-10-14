import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const python = process.platform === "win32" ? "python" : "python3";
const shellPath = (path) => path.replaceAll("\\", "/");

function fixtureRoot(t) {
  const parent = resolve(tmpdir());
  const fixture = mkdtempSync(join(parent, "hh-ops-gate-test-"));
  t.after(() => {
    assert.ok(resolve(fixture).startsWith(parent + (process.platform === "win32" ? "\\" : "/")));
    assert.ok(dirname(fixture) === parent && fixture.includes("hh-ops-gate-test-"));
    rmSync(fixture, { recursive: true, force: true });
  });
  return fixture;
}

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(repo, message) {
  git(repo, "add", ".");
  git(repo, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function checkout(t, state) {
  const fixture = fixtureRoot(t);
  const repo = join(fixture, "checkout");
  mkdirSync(repo);
  git(repo, "init", "-b", "production");
  const source = join(repo, "synthetic.txt");
  writeFileSync(source, "synthetic base\n");
  const base = commit(repo, "synthetic base");
  writeFileSync(source, "synthetic reviewed fix\n");
  const release = commit(repo, "synthetic reviewed fix");
  const remote = join(fixture, "remote.git");
  mkdirSync(remote);
  git(remote, "init", "--bare");
  git(repo, "remote", "add", "origin", shellPath(remote));
  git(repo, "push", "origin", "production");
  git(repo, "checkout", "-b", "deployed", base);
  if (state === "dirty") writeFileSync(source, "synthetic local work that must survive\n");
  if (state === "divergent") {
    writeFileSync(source, "synthetic independent server commit\n");
    commit(repo, "synthetic independent server commit");
  }
  const effects = join(fixture, "effects.log");
  const bin = join(fixture, "bin");
  mkdirSync(bin);
  // The actual script performs real Git status/fetch/ancestry checks in this
  // local-only repository. Docker is a sentinel that stops at its first effect.
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${shellPath(effects)}'\nexit 99\n`, { mode: 0o755 });
  writeFileSync(join(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  const original = readFileSync(join(root, "deploy-approved.sh"), "utf8");
  const script = join(fixture, "deploy-under-test.sh");
  assert.ok(original.includes("cd /root/hr"), "test harness must relocate the fixed deployment directory");
  const relocated = original.replace("cd /root/hr", `cd '${shellPath(repo)}'`)
    .replace("/run/lock/hh-approved-code-deploy.lock", shellPath(join(fixture, "deploy.lock")));
  writeFileSync(script, relocated.replaceAll("\r\n", "\n"));
  return { repo, source, effects, script, release, base, bin };
}

function runHost(f, sha) {
  return spawnSync(bash, ["--noprofile", "--norc", shellPath(f.script), sha], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, BASH_ENV: "", PATH: `${f.bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` },
  });
}

for (const [state, explanation] of [
  ["dirty", "local user changes"],
  ["divergent", "server commits outside the approved history"],
  ["stale", "a production branch that moved after approval"],
]) {
  test(`HH-OPS-HOST: refuses ${explanation} before image or checkout mutation`, (t) => {
    const f = checkout(t, state);
    const beforeHead = git(f.repo, "rev-parse", "HEAD");
    const beforeSource = readFileSync(f.source, "utf8");
    const result = runHost(f, state === "stale" ? f.base : f.release);
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(f.effects), false, "refused deployment reached Docker effects");
    assert.equal(git(f.repo, "rev-parse", "HEAD"), beforeHead, "refused deployment rewrote server history");
    assert.equal(readFileSync(f.source, "utf8"), beforeSource, "refused deployment overwrote local source");
    const reason = result.stderr;
    assert.match(reason, state === "dirty" ? /local changes/i : state === "divergent" ? /divergent/i : /branch moved/i);
  });
}

test("HH-OPS-HOST: clean descendant reaches the deployment boundary with an approved full SHA", (t) => {
  const f = checkout(t, "clean");
  const result = runHost(f, f.release);
  assert.ifError(result.error);
  assert.equal(result.status, 99, "the isolated Docker sentinel must stop this synthetic deployment");
  assert.match(readFileSync(f.effects, "utf8"), /^tag hh-agent:local hh-agent:before-[a-f0-9]{8}/);
  assert.equal(git(f.repo, "rev-parse", "HEAD"), f.base, "sentinel must stop before the Git merge");
});

test("HH-OPS-SSH: forced command accepts one exact SHA and rejects command injection", () => {
  const commands = [
    "deploy " + "a".repeat(40), "", "deploy abcdef12", "deploy " + "A".repeat(40),
    "deploy " + "a".repeat(40) + "; touch /tmp/pwned", "deploy " + "a".repeat(40) + "\nwhoami",
    "deploy  " + "a".repeat(40), " deploy " + "a".repeat(40), "git pull", "sudo bash", "deploy $(whoami)",
  ];
  const code = `import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('dispatch',sys.argv[1])\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nresults=[]\nfor command in json.loads(sys.argv[2]):\n try: results.append(m.parse_command(command))\n except ValueError: results.append(None)\nprint(json.dumps(results))\n`;
  const results = JSON.parse(execFileSync(python, ["-B", "-c", code, join(root, "hh-ops-dispatch.py"), JSON.stringify(commands)], { encoding: "utf8", windowsHide: true }));
  assert.deepEqual(results, ["a".repeat(40), ...Array(commands.length - 1).fill(null)]);
});

test("HH-OPS-SSH: valid forced command invokes only the fixed sudo wrapper", () => {
  const code = `import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('dispatch',sys.argv[1])\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nm.os.environ['SSH_ORIGINAL_COMMAND']='deploy '+('a'*40)\ncalls=[]\nm.os.execv=lambda path,args:calls.append([path,args])\nm.main()\nprint(json.dumps(calls))\n`;
  const calls = JSON.parse(execFileSync(python, ["-B", "-c", code, join(root, "hh-ops-dispatch.py")], { encoding: "utf8", windowsHide: true }));
  assert.deepEqual(calls, [["/usr/bin/sudo", ["sudo", "-n", "/usr/local/sbin/hh-approved-code-deploy", "a".repeat(40)]]]);
});

test("HH-OPS-HOST: malformed SHA exits before touching the fixed production directory", () => {
  for (const sha of ["", "abcdef12", "z".repeat(40), "a".repeat(40) + ";echo injected"]) {
    const result = spawnSync(bash, ["--noprofile", "--norc", shellPath(join(root, "deploy-approved.sh")), sha], { encoding: "utf8", windowsHide: true, env: { ...process.env, BASH_ENV: "" } });
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Invalid release SHA/);
  }
});
