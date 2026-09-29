// Trust anchor building blocks, computed for real with Web Crypto:
// HMAC-SHA256 frame MACs (constant-time verify), an anti-replay window, a SHA-256
// hash-chained provenance ledger rooted in a genesis block, and Ed25519 signatures for the
// satellite-to-station handshake. The HSM is emulated in software, as the brief allows.

const encoder = new TextEncoder();

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export interface FrameHeader {
  scid: number;
  vc: number;
  /** Transmit timestamp, milliseconds of scene time. */
  tMs: number;
}

export function encodeHeader(h: FrameHeader): Uint8Array {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setUint16(0, h.scid);
  buf.setUint8(2, h.vc);
  buf.setUint8(3, 0x01); // frame version
  buf.setUint32(4, Math.round(h.tMs) >>> 0);
  return new Uint8Array(buf.buffer);
}

/** Bytes covered by the MAC: header ‖ sequence (64-bit) ‖ payload. */
export function macInput(
  header: Uint8Array,
  seq: number,
  payload: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const seqBytes = new DataView(new ArrayBuffer(8));
  seqBytes.setBigUint64(0, BigInt(seq));
  return concat(header, new Uint8Array(seqBytes.buffer), payload);
}

export async function importMacKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function macSign(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

/** Constant-time verification (Web Crypto compares internally). */
export async function macVerify(
  key: CryptoKey,
  data: Uint8Array<ArrayBuffer>,
  tag: Uint8Array,
): Promise<boolean> {
  return crypto.subtle.verify('HMAC', key, new Uint8Array(tag), data);
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

export const GENESIS = 'genesis';

/** Root of the provenance chain: SHA-256 of the genesis record. */
export async function genesisRoot(station: string): Promise<string> {
  return toHex(await sha256(encoder.encode(`${GENESIS}|${station}|trust_anchor`)));
}

/** Ed25519 identity of the spacecraft, used to sign handshake challenges. */
export interface Ed25519Identity {
  publicHex: string;
  sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array>;
  verify(data: Uint8Array<ArrayBuffer>, signature: Uint8Array): Promise<boolean>;
}

/** Real Ed25519 keys from Web Crypto, or null where the browser does not support them. */
export async function createEd25519(): Promise<Ed25519Identity | null> {
  try {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return {
      publicHex: toHex(raw),
      sign: async (data) =>
        new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, data)),
      verify: (data, signature) =>
        crypto.subtle.verify({ name: 'Ed25519' }, pair.publicKey, new Uint8Array(signature), data),
    };
  } catch {
    return null;
  }
}

export const encodeText = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text);

/** h_k = SHA-256(h_{k-1} ‖ SHA-256(frame_k) ‖ meta_k). */
export async function chainHash(
  prevHex: string | null,
  frame: Uint8Array<ArrayBuffer>,
  meta: string,
): Promise<string> {
  const frameDigest = await sha256(frame);
  const bar = encoder.encode('|');
  const data = concat(
    encoder.encode(prevHex ?? GENESIS),
    bar,
    frameDigest,
    bar,
    encoder.encode(meta),
  );
  return toHex(await sha256(data));
}

/** Anti-replay: reject sequence numbers already seen or older than the window. */
export class ReplayWindow {
  private high = -1;
  private seen = new Set<number>();
  readonly size: number;

  constructor(size = 64) {
    this.size = size;
  }

  accept(seq: number): boolean {
    if (seq <= this.high - this.size || this.seen.has(seq)) return false;
    this.seen.add(seq);
    if (seq > this.high) {
      this.high = seq;
      for (const x of this.seen) if (x <= this.high - this.size) this.seen.delete(x);
    }
    return true;
  }
}

/**
 * Emulated HSM: derives one HMAC key per key epoch from a master secret that never leaves
 * this object. Spacecraft and station share it; an attacker does not.
 */
export class EmulatedHsm {
  private cache = new Map<number, Promise<CryptoKey>>();
  private readonly master: CryptoKey;

  private constructor(master: CryptoKey) {
    this.master = master;
  }

  static async create(masterSecret?: Uint8Array<ArrayBuffer>): Promise<EmulatedHsm> {
    const secret = masterSecret ?? crypto.getRandomValues(new Uint8Array(32));
    return new EmulatedHsm(await importMacKey(secret));
  }

  epochKey(epoch: number): Promise<CryptoKey> {
    let key = this.cache.get(epoch);
    if (!key) {
      key = (async () => {
        const derived = await macSign(this.master, encoder.encode(`key-epoch:${epoch}`));
        return importMacKey(new Uint8Array(derived));
      })();
      this.cache.set(epoch, key);
    }
    return key;
  }
}

export const shortHash = (hex: string): string => `${hex.slice(0, 10)}…${hex.slice(-8)}`;
