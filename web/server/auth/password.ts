import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
const VERSION = "v1";
const N = 32_768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

export function canonicalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export function validatePassword(value: string) {
  if (value.length < 12) throw new Error("AUTH_PASSWORD_TOO_SHORT");
  if (Buffer.byteLength(value, "utf8") > 1024) throw new Error("AUTH_PASSWORD_TOO_LONG");
}

async function derive(password: string, salt: Buffer, n = N, r = R, p = P) {
  return Buffer.from(await scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEMORY }) as Buffer);
}

export async function hashPassword(password: string) {
  validatePassword(password);
  const salt = randomBytes(16);
  const digest = await derive(password, salt);
  return `scrypt$${VERSION}$${N}$${R}$${P}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export async function verifyPassword(password: string, envelope: string) {
  const [algorithm, version, rawN, rawR, rawP, rawSalt, rawDigest] = envelope.split("$");
  if (algorithm !== "scrypt" || version !== VERSION || !rawDigest) return false;
  const digest = Buffer.from(rawDigest, "base64url");
  const candidate = await derive(password, Buffer.from(rawSalt, "base64url"), Number(rawN), Number(rawR), Number(rawP));
  return digest.length === candidate.length && timingSafeEqual(digest, candidate);
}

const DUMMY_ENVELOPE_PROMISE = hashPassword("synthetic-dummy-password-only");
export async function runDummyPasswordVerification(password: string) {
  return verifyPassword(password, await DUMMY_ENVELOPE_PROMISE);
}

export const PASSWORD_HASH_POLICY = Object.freeze({ algorithm: "scrypt", version: VERSION, minimumLength: 12, memoryHard: true });
