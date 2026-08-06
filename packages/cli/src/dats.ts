import { readFileSync } from 'node:fs'
import { protocol as p } from '@joggles/core'

// Per TextAgreement.sendData(): payload is chunked into 15-byte pieces, each
// written as [len][15 bytes] then encrypted. The length prefix must be stripped
// before reassembly.
const buf = readFileSync(process.argv[2] ?? 'captures/btsnoop_hci.log')
let off = 16
const writes: { h: number; v: Buffer }[] = []
while (off + 24 <= buf.length) {
  const inc = buf.readUInt32BE(off + 4)
  off += 24
  if (inc > buf.length - off) break
  const d = buf.subarray(off, off + inc)
  off += inc
  if (d.length < 13 || d[0] !== 0x02 || d.readUInt16LE(7) !== 4) continue
  if (d[9] !== 0x12 && d[9] !== 0x52) continue
  writes.push({ h: d.readUInt16LE(10), v: Buffer.from(d.subarray(12)) })
}

let cur: Buffer | null = null
let declared = 0
let best: { d: number; b: Buffer } | null = null
for (const w of writes) {
  if (w.v.length !== 16) continue
  const pt = Buffer.from(p.decrypt(new Uint8Array(w.v)))
  if (w.h === 18) {
    const n = pt[0]
    if (!n || n > 15) continue
    const body = pt.subarray(1, 1 + n)
    const op = [...body].map((c) => (c >= 65 && c <= 90 ? String.fromCharCode(c) : '')).join('')
    if (op === 'DATS') {
      declared = (body[5] << 8) | body[6]
      cur = Buffer.alloc(0)
    } else if (op === 'DATCP' && cur) {
      if (!best || cur.length > best.b.length) best = { d: declared, b: cur }
      cur = null
    }
  } else if (w.h === 21 && cur) {
    const n = pt[0] // chunk length prefix, max 15
    cur = Buffer.concat([cur, pt.subarray(1, 1 + Math.min(n, 15))])
  }
}

if (!best) { console.log('no upload found'); process.exit(1) }
const cols: number[] = []
for (let o = 0; o + 1 < Math.min(best.b.length, best.d); o += 2) cols.push(best.b.readUInt16LE(o))
console.log(`declared ${best.d} bytes, reassembled ${best.b.length}, ${cols.length} columns\n`)
// 14 rows: bits 0-6 are rows 0-6, bits 8-14 rows 7-13.
for (let r = 13; r >= 0; r--) {
  const bit = r < 7 ? r : r + 1
  console.log('  ' + cols.map((c) => ((c >> bit) & 1 ? '#' : '.')).join(''))
}
