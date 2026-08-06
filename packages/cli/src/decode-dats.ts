#!/usr/bin/env bun
/**
 * Reassemble DATS/DATCP bitmap uploads from a full HCI snoop log.
 *
 * The vendor app stores a message with a mechanism absent from Agreement.java:
 *
 *   h18  DATS 01 00 <len>     announce a payload of <len> bytes
 *   h21  <raw 16-byte blocks>  the bitmap itself, on characteristic 960a
 *   h18  DATCP                 end of payload
 *   h18  MODE 01 00 / SPEED n  how to display it
 *
 * Handle 21 carries raw data, NOT [len][opcode] frames, so it must be
 * concatenated rather than parsed per block. The result is 16-bit
 * little-endian per display column.
 */
import { readFileSync } from 'node:fs'
import { protocol as p } from '@joggles/core'

const CMD_HANDLE = 18
const DATA_HANDLE = 21

interface Write {
  handle: number
  value: Buffer
}

function attWrites(buf: Buffer): Write[] {
  const out: Write[] = []
  let off = 16
  while (off + 24 <= buf.length) {
    const included = buf.readUInt32BE(off + 4)
    off += 24
    if (included > buf.length - off) break
    const d = buf.subarray(off, off + included)
    off += included
    if (d.length < 13 || d[0] !== 0x02) continue
    if (d.readUInt16LE(7) !== 0x0004) continue
    const opcode = d[9]
    if (opcode !== 0x12 && opcode !== 0x52) continue
    out.push({ handle: d.readUInt16LE(10), value: Buffer.from(d.subarray(12)) })
  }
  return out
}

const letters = (b: Uint8Array) =>
  [...b].map((c) => (c >= 0x41 && c <= 0x5a ? String.fromCharCode(c) : '')).join('')

const buf = readFileSync(process.argv[2] ?? 'captures/btsnoop_hci.log')
const writes = attWrites(buf)

interface Upload {
  declared: number
  data: Buffer
  trailing: string[]
}

const uploads: Upload[] = []
let current: Upload | null = null

for (const w of writes) {
  if (w.value.length !== p.BLOCK_SIZE) continue
  const plain = Buffer.from(p.decrypt(new Uint8Array(w.value)))

  if (w.handle === CMD_HANDLE) {
    const n = plain[0]
    if (n === 0 || n > 15) continue
    const body = plain.subarray(1, 1 + n)
    const op = letters(body)
    const args = [...body.subarray(op.length)]

    if (op === 'DATS') {
      // args: [01, 00, len] - a 16-bit length would be little-endian, but the
      // observed third byte alone tracks payload size.
      current = { declared: args[2] ?? 0, data: Buffer.alloc(0), trailing: [] }
      uploads.push(current)
    } else if (op === 'DATCP') {
      current = null
    } else if (current === null && uploads.length) {
      uploads[uploads.length - 1].trailing.push(`${op} ${args.join(' ')}`.trim())
    }
  } else if (w.handle === DATA_HANDLE && current) {
    current.data = Buffer.concat([current.data, plain])
  }
}

console.log(`${uploads.length} DATS uploads\n`)

for (const [i, up] of uploads.entries()) {
  // 16-bit little-endian per column; only the low bits carry pixels.
  const cols: number[] = []
  for (let o = 0; o + 1 < Math.min(up.data.length, up.declared); o += 2) {
    cols.push(up.data.readUInt16LE(o))
  }
  const used = cols.reduce((m, c) => Math.max(m, c), 0)
  const bits = used === 0 ? 0 : Math.floor(Math.log2(used)) + 1

  console.log(`--- upload ${i}: declared ${up.declared} bytes -> ${cols.length} columns`)
  console.log(`    max value ${used} (${bits} bits per column)`)
  if (up.trailing.length) console.log(`    then: ${up.trailing.slice(0, 4).join(' | ')}`)

  for (let r = bits - 1; r >= 0; r--) {
    const line = cols.map((c) => ((c >> r) & 1 ? '#' : '.')).join('')
    console.log(`    ${line}`)
  }
  console.log()
}
