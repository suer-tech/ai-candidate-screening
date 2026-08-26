import { GoogleDriveOAuthError, type SecretEnvelope } from "./types.ts";

export type GoogleOAuthKeyring = { activeVersion: string; keys: Record<string, Uint8Array> };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function parseGoogleOAuthKeyring(serialized: string | undefined): GoogleOAuthKeyring {
  if (!serialized?.trim()) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_TOKEN_KEYRING_JSON_MISSING");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new GoogleDriveOAuthError("GOOGLE_OAUTH_TOKEN_KEYRING_JSON_INVALID"); }
  if (!parsed || typeof parsed !== "object") throw new GoogleDriveOAuthError("GOOGLE_OAUTH_TOKEN_KEYRING_JSON_INVALID");
  const document = parsed as { activeVersion?: unknown; keys?: unknown };
  if (typeof document.activeVersion !== "string" || !document.activeVersion || !document.keys || typeof document.keys !== "object") throw new GoogleDriveOAuthError("GOOGLE_OAUTH_TOKEN_KEYRING_JSON_INVALID");
  const keys: Record<string, Uint8Array> = {};
  for (const [version, encoded] of Object.entries(document.keys)) {
    if (typeof encoded !== "string") throw new GoogleDriveOAuthError("GOOGLE_OAUTH_TOKEN_KEYRING_JSON_INVALID");
    const bytes = base64UrlToBytes(encoded);
    if (bytes.byteLength !== 32) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_TOKEN_KEY_LENGTH_INVALID");
    keys[version] = bytes;
  }
  if (!keys[document.activeVersion]) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_ACTIVE_KEY_MISSING");
  return { activeVersion: document.activeVersion, keys };
}

async function aesKey(bytes: Uint8Array, usages: KeyUsage[]) {
  return crypto.subtle.importKey("raw", Uint8Array.from(bytes).buffer, { name: "AES-GCM" }, false, usages);
}

export async function encryptSecret(value: string, aad: string, keyring: GoogleOAuthKeyring): Promise<SecretEnvelope> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(aad), tagLength: 128 },
    await aesKey(keyring.keys[keyring.activeVersion], ["encrypt"]),
    encoder.encode(value),
  ));
  const ciphertext = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);
  return { algorithm: "AES-256-GCM", keyVersion: keyring.activeVersion, ciphertext: bytesToBase64Url(ciphertext), nonce: bytesToBase64Url(nonce), tag: bytesToBase64Url(tag) };
}

export async function decryptSecret(envelope: SecretEnvelope, aad: string, keyring: GoogleOAuthKeyring) {
  const material = keyring.keys[envelope.keyVersion];
  if (!material) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_TOKEN_KEY_VERSION_UNKNOWN");
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  const tag = base64UrlToBytes(envelope.tag);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  try {
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(envelope.nonce), additionalData: encoder.encode(aad), tagLength: 128 },
      await aesKey(material, ["decrypt"]),
      combined,
    );
    return decoder.decode(clear);
  } catch { throw new GoogleDriveOAuthError("GOOGLE_OAUTH_TOKEN_ENVELOPE_INVALID"); }
}

export async function sha256Base64Url(value: string) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export function randomBase64Url(byteLength = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function connectionTokenAad(input: { id: string; ownerSubject: string; scopes: readonly string[]; keyVersion: string }) {
  return `google-drive-oauth:refresh:${input.id}:${input.ownerSubject}:${[...input.scopes].sort().join(" ")}:${input.keyVersion}`;
}

export function operationVerifierAad(input: { id: string; principalId: string; redirectUri: string; keyVersion: string }) {
  return `google-drive-oauth:pkce:${input.id}:${input.principalId}:${input.redirectUri}:${input.keyVersion}`;
}

export async function rewrapSecret(envelope: SecretEnvelope, aadFor: (keyVersion: string) => string, keyring: GoogleOAuthKeyring) {
  if (envelope.keyVersion === keyring.activeVersion) return envelope;
  const clear = await decryptSecret(envelope, aadFor(envelope.keyVersion), keyring);
  return encryptSecret(clear, aadFor(keyring.activeVersion), keyring);
}

const SECRET_KEY = /(^|_)(authorization.?code|client.?secret|refresh.?token|access.?token|pkce.?verifier)(_|$)/i;

export function redactOAuthSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOAuthSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : redactOAuthSecrets(item)]));
}
