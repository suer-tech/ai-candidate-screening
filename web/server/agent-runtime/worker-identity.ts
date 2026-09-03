import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export function createWorkerIdentity(role: string, configured?: string) {
  const prefix = configured?.trim() || hostname().replace(/[^A-Za-z0-9._-]/g, "-") || "worker";
  const safeRole = role.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${prefix}:${safeRole}:${process.pid}:${randomUUID().slice(0, 8)}`;
}
