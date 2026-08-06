import { expect, test } from 'bun:test'
import { chunkPayload, datsStart, decodeBitmap, encodeBitmap } from './dats.js'
import { body } from './protocol.js'

test('DATS start frame matches the vendor layout', () => {
  const f = datsStart(178)
  // [07]["DATS"][01][hi][lo]
  expect(String.fromCharCode(...body(f).subarray(0, 4))).toBe('DATS')
  expect([...body(f).subarray(4)]).toEqual([1, 0, 178])
})

test('16-bit length is big-endian across the byte boundary', () => {
  const f = datsStart(300) // 300 = 0x012C
  expect([...body(f).subarray(4)]).toEqual([1, 1, 44])
})

test('bitmap encoding skips the unused bit 7', () => {
  const bmp = Array.from({ length: 14 }, () => [0])
  bmp[0][0] = 1 // row 0 -> bit 0
  bmp[7][0] = 1 // row 7 -> bit 8, NOT bit 7
  const enc = encodeBitmap(bmp)
  const word = enc[0] | (enc[1] << 8)
  expect(word).toBe(0b1_0000_0001)
  expect((word >> 7) & 1).toBe(0)
})

test('encode/decode round-trips', () => {
  const bmp = Array.from({ length: 14 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => (r + c) % 3 === 0 ? 1 : 0),
  )
  expect(decodeBitmap(encodeBitmap(bmp))).toEqual(bmp)
})

test('chunking prefixes each block with its own length', () => {
  const payload = new Uint8Array(38).fill(0xaa)
  const blocks = chunkPayload(payload)
  expect(blocks.length).toBe(3) // 15 + 15 + 8
  expect(blocks[0][0]).toBe(15)
  expect(blocks[2][0]).toBe(8)
  expect(blocks.every((b) => b.length === 16)).toBe(true)
  // Reassembly must strip the prefix.
  const back = blocks.flatMap((b) => [...b.subarray(1, 1 + b[0])])
  expect(back.length).toBe(38)
})

test('rejects more rows than the format holds', () => {
  expect(() => encodeBitmap(Array.from({ length: 15 }, () => [0]))).toThrow()
})
