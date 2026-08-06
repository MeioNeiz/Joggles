import { expect, test } from 'bun:test'
import { COLS, Grid, ROWS, alive, edgePixels } from './display.js'
import { textBitmap, textWidth } from './font.js'

test('pixels use the vendor two-bit value 0b11 at stride 2', () => {
  const g = new Grid()
  g.set(0, 0)
  expect(g.columnWord(0)).toBe(0b11)
  g.clear().set(8, 0)
  expect(g.columnWord(0)).toBe(0b11 << 16)
})

test('a full column matches a real vendor animation word', () => {
  // AnimData.getAnim1() frame 1 contains 262128 = 0x3FFF0 = bits 4..17 = rows 2..8.
  const g = new Grid()
  for (let r = 2; r <= 8; r++) g.set(r, 0)
  expect(g.columnWord(0)).toBe(262128)
})

test('dead zones match the physical panel', () => {
  expect(alive(8, 11)).toBe(false) // top-row gap
  expect(alive(8, 0)).toBe(true)
  expect(alive(0, 11)).toBe(false) // nose notch
  expect(alive(4, 11)).toBe(true)
})

test('edge trace reproduces the verified silhouette', () => {
  const g = new Grid()
  for (const [r, c] of edgePixels()) g.set(r, c)
  expect(g.render().split('\n')[0]).toBe('#########......#########')
  expect(g.render().split('\n')[8]).toBe('#########......#########')
})

test('delta only reports changed columns', () => {
  const a = new Grid()
  const b = new Grid()
  b.set(4, 7)
  expect(b.deltaFrames(a).map(([i]) => i)).toEqual([7])
  expect(b.deltaFrames(b).length).toBe(0)
  expect(b.deltaFrames(null).length).toBe(COLS)
})

test('font renders and measures consistently', () => {
  expect(textWidth('F')).toBe(3)
  const bm = textBitmap('F')
  expect(bm.length).toBe(5)
  // Bottom row first, so the F's stem is set and its top bar is on the last row.
  expect(bm[0]).toEqual([1, 0, 0])
  expect(bm[4]).toEqual([1, 1, 1])
})

test('grid dimensions', () => {
  expect(ROWS).toBe(9)
  expect(COLS).toBe(24)
})
