import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "../llm/value-utils.ts";
import type { MatrixCapability } from "./matrix-schemas.ts";

const PYTHON = process.env.MATRIX_PYDANTIC_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const SCRIPT = fileURLToPath(new URL("../../python/matrix_validator.py", import.meta.url));
const MAX_INPUT = 2 * 1024 * 1024;

export async function validateMatrixWithPydanticAi(input: {
  capability: MatrixCapability;
  schema: JsonValue;
  output: JsonValue;
  sourceRefs: string[];
}): Promise<void> {
  const payload = JSON.stringify(input);
  if (Buffer.byteLength(payload) > MAX_INPUT) throw new Error("MATRIX_PYDANTIC_INPUT_TOO_LARGE");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(PYTHON, [SCRIPT], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PYDANTIC_AI_NO_BANNER: "1", PYTHONIOENCODING: "utf-8" },
    });
    let output = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("MATRIX_PYDANTIC_TIMEOUT"));
    }, 15_000);
    child.on("error", () => finish(new Error("MATRIX_PYDANTIC_UNAVAILABLE")));
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 1024) {
        child.kill();
        finish(new Error("MATRIX_PYDANTIC_OUTPUT_INVALID"));
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error("MATRIX_PYDANTIC_RUNTIME_FAILED"));
      try {
        const result: unknown = JSON.parse(output);
        if (result && typeof result === "object" && "ok" in result && result.ok === true) return finish();
        const reason = result && typeof result === "object" && "code" in result ? result.code : undefined;
        const code = typeof reason === "string" && /^MATRIX_[A-Z0-9_]+$/.test(reason) ? reason : "MATRIX_PYDANTIC_OUTPUT_INVALID";
        finish(new Error(code));
      } catch { finish(new Error("MATRIX_PYDANTIC_OUTPUT_INVALID")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(payload);
  });
}
