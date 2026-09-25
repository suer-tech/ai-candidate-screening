import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const venvRoot = join(webRoot, ".runtime", "matrix-venv");
const venvPython = join(venvRoot, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const systemPython = process.env.MATRIX_TEST_SYSTEM_PYTHON ?? (process.platform === "win32" ? "python" : "python3");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: webRoot, stdio: "inherit", timeout: 120_000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(venvPython)) {
  mkdirSync(dirname(venvRoot), { recursive: true });
  run(systemPython, ["-m", "venv", venvRoot]);
}
run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", "python/requirements-matrix.txt"]);
run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "tests/matrix-pydantic-validator.test.ts"], {
  env: { ...process.env, MATRIX_PYDANTIC_PYTHON: venvPython },
});
