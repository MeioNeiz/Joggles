/**
 * AES-128 single-block encrypt/decrypt, dependency-free.
 *
 * Why not platform crypto: the three targets disagree. Node has `aes-128-ecb`,
 * Web Crypto deliberately omits ECB, and React Native ships no crypto at all.
 * Since every frame this protocol sends is exactly one 16-byte block, ECB is
 * just "encrypt one block" - the mode machinery is irrelevant. Implementing it
 * here keeps laptop and phone bit-identical with no native module anywhere.
 */

const SBOX = new Uint8Array(256)
const INV_SBOX = new Uint8Array(256)

// Generate the S-box from its definition rather than shipping a 256-byte table:
// multiplicative inverse in GF(2^8) followed by the affine transform.
;(() => {
  const p: number[] = new Array(256)
  const l: number[] = new Array(256)
  let x = 1
  for (let i = 0; i < 256; i++) {
    p[i] = x
    l[x] = i
    x ^= (x << 1) ^ ((x & 0x80) !== 0 ? 0x11b : 0)
    x &= 0xff
  }
  SBOX[0] = 0x63
  for (let i = 1; i < 256; i++) {
    const inv = p[255 - l[i]]
    let s = inv
    let acc = inv
    for (let k = 0; k < 4; k++) {
      acc = ((acc << 1) | (acc >>> 7)) & 0xff
      s ^= acc
    }
    SBOX[i] = s ^ 0x63
  }
  for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i
})()

const xtime = (a: number) => ((a << 1) ^ ((a & 0x80) !== 0 ? 0x1b : 0)) & 0xff

/** Multiply in GF(2^8). Used by MixColumns and its inverse. */
function mul(a: number, b: number): number {
  let r = 0
  while (b) {
    if (b & 1) r ^= a
    a = xtime(a)
    b >>= 1
  }
  return r & 0xff
}

const ROUNDS = 10

/** Expand a 16-byte key into 11 round keys. */
export function expandKey(key: Uint8Array): Uint8Array[] {
  if (key.length !== 16) throw new Error(`key must be 16 bytes, got ${key.length}`)
  const w = new Uint8Array(16 * (ROUNDS + 1))
  w.set(key, 0)
  let rcon = 1
  for (let i = 16; i < w.length; i += 4) {
    let a = w[i - 4]
    let b = w[i - 3]
    let c = w[i - 2]
    let d = w[i - 1]
    if (i % 16 === 0) {
      // Rotate, substitute, then fold in the round constant.
      ;[a, b, c, d] = [SBOX[b] ^ rcon, SBOX[c], SBOX[d], SBOX[a]]
      rcon = xtime(rcon)
    }
    w[i] = w[i - 16] ^ a
    w[i + 1] = w[i - 15] ^ b
    w[i + 2] = w[i - 14] ^ c
    w[i + 3] = w[i - 13] ^ d
  }
  const keys: Uint8Array[] = []
  for (let r = 0; r <= ROUNDS; r++) keys.push(w.subarray(r * 16, r * 16 + 16))
  return keys
}

function addRoundKey(s: Uint8Array, k: Uint8Array): void {
  for (let i = 0; i < 16; i++) s[i] ^= k[i]
}

function shiftRows(s: Uint8Array): void {
  const t = s.slice()
  for (let c = 0; c < 4; c++) {
    for (let r = 1; r < 4; r++) {
      s[c * 4 + r] = t[((c + r) % 4) * 4 + r]
    }
  }
}

function invShiftRows(s: Uint8Array): void {
  const t = s.slice()
  for (let c = 0; c < 4; c++) {
    for (let r = 1; r < 4; r++) {
      s[((c + r) % 4) * 4 + r] = t[c * 4 + r]
    }
  }
}

function mixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4
    const [a0, a1, a2, a3] = [s[i], s[i + 1], s[i + 2], s[i + 3]]
    s[i] = mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3
    s[i + 1] = a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3
    s[i + 2] = a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3)
    s[i + 3] = mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2)
  }
}

function invMixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4
    const [a0, a1, a2, a3] = [s[i], s[i + 1], s[i + 2], s[i + 3]]
    s[i] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9)
    s[i + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13)
    s[i + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11)
    s[i + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14)
  }
}

/** Encrypt exactly one 16-byte block. */
export function encryptBlock(roundKeys: Uint8Array[], input: Uint8Array): Uint8Array {
  if (input.length !== 16) throw new Error(`block must be 16 bytes, got ${input.length}`)
  const s = new Uint8Array(input)
  addRoundKey(s, roundKeys[0])
  for (let r = 1; r < ROUNDS; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]
    shiftRows(s)
    mixColumns(s)
    addRoundKey(s, roundKeys[r])
  }
  for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]
  shiftRows(s)
  addRoundKey(s, roundKeys[ROUNDS])
  return s
}

/** Decrypt exactly one 16-byte block. */
export function decryptBlock(roundKeys: Uint8Array[], input: Uint8Array): Uint8Array {
  if (input.length !== 16) throw new Error(`block must be 16 bytes, got ${input.length}`)
  const s = new Uint8Array(input)
  addRoundKey(s, roundKeys[ROUNDS])
  for (let r = ROUNDS - 1; r >= 1; r--) {
    invShiftRows(s)
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]
    addRoundKey(s, roundKeys[r])
    invMixColumns(s)
  }
  invShiftRows(s)
  for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]
  addRoundKey(s, roundKeys[0])
  return s
}
