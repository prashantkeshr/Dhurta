// PIN-derived end-to-end encryption. The relay server never has the PIN, so it
// can never decrypt anything routed through it — every signaling blob and every
// datachannel message is opaque ciphertext to any third party in the middle.
//
// Key derivation: PBKDF2-SHA256(pin, salt=roomCode, 150k iterations) -> AES-256-GCM key.
// Both peers derive the same key locally from the PIN they both know; it is
// never transmitted.

const PBKDF2_ITERATIONS = 150_000;

async function importPinKey(pin: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
}

export async function deriveRoomKey(pin: string, roomCode: string): Promise<CryptoKey> {
  const baseKey = await importPinKey(pin);
  const salt = new TextEncoder().encode(`dhurta-connect:${roomCode}`);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface EncryptedEnvelope {
  iv: string; // base64
  data: string; // base64 ciphertext
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: toBase64(iv), data: toBase64(ciphertext) };
}

export async function decryptJSON<T = unknown>(key: CryptoKey, envelope: EncryptedEnvelope): Promise<T> {
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.data);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export function randomPin(digits = 6): string {
  const max = 10 ** digits;
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return n.toString().padStart(digits, '0');
}

export function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return toBase64(bytes).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
}
