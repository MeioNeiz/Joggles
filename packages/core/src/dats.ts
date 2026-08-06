/**
 * DATS/DATCP: upload content wider than the panel, for the device to animate.
 *
 * This is a separate path from the DIY column writes. DIY draws to a live
 * 24-column buffer; DATS stores an arbitrary-width bitmap that the `MODE`
 * commands then display and scroll, unattended, with nothing connected.
 *
 * Protocol per the vendor's TextAgreement.java, confirmed against an HCI
 * capture:
 *
 *     cmd  9600   [07]["DATS"][01][len_hi][len_lo]
 *     notify      "DATSOK"
 *     data 960a   [len][up to 15 payload bytes]   xN
 *     cmd  9600   [05]["DATCP"]
 *     notify      "DATCPOK" | "ERROR"
 *
 * The payload is NOT our DIY encoding. It is 16-bit little-endian per column:
 *
 *     bits 0-6   rows 0-6
 *     bit  7     unused
 *     bits 8-14  rows 7-13
 *     bit  15    unused
 */
import { frame } from './protocol.js'

/** Rows addressable by the DATS payload format. */
export const DATS_ROWS = 14

/** Payload bytes carried per 16-byte block; byte 0 is the length prefix. */
export const CHUNK_PAYLOAD = 15

/** Announce an upload of `byteLength` bytes. Length is 16-bit big-endian. */
export function datsStart(byteLength: number): Uint8Array {
  if (byteLength < 0 || byteLength > 0xffff) {
    throw new Error(`payload length out of range: ${byteLength}`)
  }
  return frame('DATS', 1, (byteLength >> 8) & 0xff, byteLength & 0xff)
}

/** Signal the end of an upload. */
export const datsComplete = (): Uint8Array => frame('DATCP')

/**
 * Pack a [row][col] bitmap into the DATS payload encoding.
 *
 * Row 0 is the BOTTOM row, matching the rest of this codebase.
 */
export function encodeBitmap(bitmap: number[][]): Uint8Array {
  const rows = bitmap.length
  if (rows > DATS_ROWS) {
    throw new Error(`DATS holds ${DATS_ROWS} rows, got ${rows}`)
  }
  const cols = bitmap[0]?.length ?? 0
  const out = new Uint8Array(cols * 2)
  for (let c = 0; c < cols; c++) {
    let word = 0
    for (let r = 0; r < rows; r++) {
      if (!bitmap[r][c]) continue
      // Rows 0-6 occupy bits 0-6; rows 7-13 skip the unused bit 7.
      word |= 1 << (r < 7 ? r : r + 1)
    }
    out[c * 2] = word & 0xff
    out[c * 2 + 1] = (word >> 8) & 0xff
  }
  return out
}

/** Decode a DATS payload back to a [row][col] bitmap. Used by the log decoder. */
export function decodeBitmap(payload: Uint8Array): number[][] {
  const cols = Math.floor(payload.length / 2)
  const out = Array.from({ length: DATS_ROWS }, () => new Array(cols).fill(0))
  for (let c = 0; c < cols; c++) {
    const word = payload[c * 2] | (payload[c * 2 + 1] << 8)
    for (let r = 0; r < DATS_ROWS; r++) {
      out[r][c] = (word >> (r < 7 ? r : r + 1)) & 1
    }
  }
  return out
}

/**
 * Split a payload into wire blocks, each `[length][up to 15 bytes]`.
 *
 * The length prefix is per-chunk, not cumulative. Reassembling without
 * stripping it shifts the bitmap and yields plausible-looking garbage.
 */
export function chunkPayload(payload: Uint8Array): Uint8Array[] {
  const blocks: Uint8Array[] = []
  for (let off = 0; off < payload.length; off += CHUNK_PAYLOAD) {
    const slice = payload.subarray(off, off + CHUNK_PAYLOAD)
    const block = new Uint8Array(16)
    block[0] = slice.length
    block.set(slice, 1)
    blocks.push(block)
  }
  return blocks
}

const ascii = (b: Uint8Array) => String.fromCharCode(...b)

/** Classify a decrypted notify frame during an upload. */
export function parseReply(plain: Uint8Array): 'DATSOK' | 'DATCPOK' | 'ERROR' | null {
  const text = ascii(plain.subarray(1, 9))
  if (text.startsWith('DATSOK')) return 'DATSOK'
  if (text.startsWith('DATCPOK')) return 'DATCPOK'
  if (text.startsWith('ERROR')) return 'ERROR'
  return null
}
