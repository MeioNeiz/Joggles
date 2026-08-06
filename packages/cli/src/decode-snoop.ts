#!/usr/bin/env bun
/**
 * Decode a Bluetooth HCI snoop log into readable protocol frames.
 *
 * The vendor app demonstrates the parts of the protocol we could not work out by
 * observation - which storage slot MODE reads, what its second argument selects,
 * and how a message wider than the panel is loaded. Since every write is one
 * 16-byte AES block and we have the key, its whole conversation decodes.
 *
 * Usage: bun packages/cli/src/decode-snoop.ts <btsnoop_hci.log>
 */
import { readFileSync } from 'node:fs'
import { protocol as p } from '@joggles/core'

const BTSNOOP_MAGIC = 'btsnoop\0'

interface Packet {
  timestampUs: bigint
  direction: 'sent' | 'recv'
  data: Buffer
}

/** Parse the btsnoop container: 16-byte file header, then length-prefixed records. */
function parseSnoop(buf: Buffer): Packet[] {
  if (buf.subarray(0, 8).toString('binary') !== BTSNOOP_MAGIC) {
    throw new Error('not a btsnoop file')
  }
  const packets: Packet[] = []
  let off = 16
  while (off + 24 <= buf.length) {
    const originalLen = buf.readUInt32BE(off)
    const includedLen = buf.readUInt32BE(off + 4)
    const flags = buf.readUInt32BE(off + 8)
    const timestampUs = buf.readBigUInt64BE(off + 16)
    off += 24
    if (includedLen > buf.length - off) break
    packets.push({
      timestampUs,
      // bit 0: 0 = host->controller (sent), 1 = controller->host (received)
      direction: (flags & 1) === 0 ? 'sent' : 'recv',
      data: buf.subarray(off, off + includedLen),
    })
    off += includedLen
    void originalLen
  }
  return packets
}

/**
 * Pull ATT write payloads out of ACL data packets.
 *
 * We only need writes carrying exactly one 16-byte block, which is every frame
 * this protocol sends, so a light-touch parse is enough: locate the ATT opcode
 * and take the value that follows the handle.
 */
function attWrites(packets: Packet[]): Array<{ t: bigint; handle: number; value: Buffer }> {
  const out: Array<{ t: bigint; handle: number; value: Buffer }> = []
  for (const pkt of packets) {
    // HCI ACL: type byte (0x02) + handle/flags(2) + total len(2) + L2CAP len(2) + cid(2)
    if (pkt.data.length < 13 || pkt.data[0] !== 0x02) continue
    const cid = pkt.data.readUInt16LE(7)
    if (cid !== 0x0004) continue // ATT channel
    const att = pkt.data.subarray(9)
    const opcode = att[0]
    // 0x12 = Write Request, 0x52 = Write Command
    if (opcode !== 0x12 && opcode !== 0x52) continue
    const handle = att.readUInt16LE(1)
    const value = att.subarray(3)
    if (value.length === 0) continue
    out.push({ t: pkt.timestampUs, handle, value: Buffer.from(value) })
  }
  return out
}

const ascii = (b: Uint8Array) =>
  [...b].map((c) => (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.')).join('')

function describe(plain: Uint8Array): string {
  const n = plain[0]
  const bodyBytes = plain.subarray(1, 1 + n)
  const text = ascii(bodyBytes)
  const letters = text.replace(/[^A-Z]/g, '')

  if (n === 4 && plain[1] <= 0x40) {
    // Bulk pixel frame: [04][col][3 bytes]
    const col = plain[1]
    const word = (plain[2] << 16) | (plain[3] << 8) | plain[4]
    return `PIXEL col=${String(col).padStart(3)} bits=${word.toString(2).padStart(24, '0')}`
  }
  const args = [...bodyBytes.subarray(letters.length)]
    .map((b) => b.toString().padStart(3))
    .join(' ')
  return `CMD   ${letters.padEnd(10)} ${args}`
}

const path = process.argv[2]
if (!path) {
  console.error('usage: decode-snoop <btsnoop_hci.log>')
  process.exit(1)
}

const packets = parseSnoop(readFileSync(path))
const writes = attWrites(packets)
console.log(`${packets.length} HCI packets, ${writes.length} ATT writes\n`)

let shown = 0
let lastT = 0n
let pixelRun = 0

for (const w of writes) {
  if (w.value.length !== p.BLOCK_SIZE) continue
  let plain: Uint8Array
  try {
    plain = p.decrypt(new Uint8Array(w.value))
  } catch {
    continue
  }
  const n = plain[0]
  // A valid frame declares a sane length; anything else is unrelated traffic.
  if (n === 0 || n > 15) continue
  const line = describe(plain)

  // Collapse long pixel-upload runs so command sequences stay readable.
  if (line.startsWith('PIXEL')) {
    pixelRun++
    if (pixelRun > 3) continue
  } else if (pixelRun > 3) {
    console.log(`      ... ${pixelRun - 3} more PIXEL writes`)
    pixelRun = 0
  } else {
    pixelRun = 0
  }

  const gapMs = lastT === 0n ? 0 : Number(w.timestampUs - lastT) / 1000
  lastT = w.timestampUs
  const gap = gapMs > 200 ? `  +${gapMs.toFixed(0)}ms` : ''
  console.log(`h${w.handle.toString().padStart(3)}  ${line}${gap}`)
  shown++
}
if (pixelRun > 3) console.log(`      ... ${pixelRun - 3} more PIXEL writes`)
console.log(`\n${shown} decoded frames`)
