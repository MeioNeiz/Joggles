/**
 * Pixel layer: a 9x24 grid packed the way the panel expects.
 *
 * Geometry established against live hardware:
 *   9 rows, 24 columns per lens
 *   row 0 = bottom, row 8 = top, column 0 = left
 *   row r occupies bit 2*r of the 3-byte column word (two bits per pixel)
 */
import { column } from './protocol.js'

export const ROWS = 9
export const COLS = 24
export const STRIDE = 2

/**
 * The panel is not a rectangle. Two centred physical gaps, mapped by drawing a
 * full border and noting what was missing: the middle of the top row, and a
 * triangular nose-bridge notch at the bottom.
 */
const DEAD: Record<number, [number, number]> = {
  8: [9, 15],
  1: [10, 14],
  0: [9, 15],
}

/** Is there physically an LED at this coordinate? */
export function alive(row: number, col: number): boolean {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return false
  const gap = DEAD[row]
  return !gap || col < gap[0] || col >= gap[1]
}

/** Live pixels bordering a gap or the outside - the panel's true silhouette. */
export function edgePixels(): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!alive(r, c)) continue
      const exposed =
        !alive(r + 1, c) || !alive(r - 1, c) || !alive(r, c + 1) || !alive(r, c - 1)
      if (exposed) out.push([r, c])
    }
  }
  return out
}

/** A mutable 9x24 monochrome frame. Origin (0,0) is BOTTOM-LEFT. */
export class Grid {
  readonly px: Uint8Array[]

  constructor() {
    this.px = Array.from({ length: ROWS }, () => new Uint8Array(COLS))
  }

  clear(): this {
    for (const row of this.px) row.fill(0)
    return this
  }

  set(row: number, col: number, on = true): this {
    if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
      this.px[row][col] = on ? 1 : 0
    }
    return this
  }

  get(row: number, col: number): number {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS ? this.px[row][col] : 0
  }

  /** Draw a [row][col] bitmap with its bottom-left at (row0, col0). */
  blit(bitmap: number[][], row0 = 0, col0 = 0): this {
    bitmap.forEach((line, r) =>
      line.forEach((v, c) => {
        if (v) this.set(row0 + r, col0 + c)
      }),
    )
    return this
  }

  equals(other: Grid): boolean {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.px[r][c] !== other.px[r][c]) return false
      }
    }
    return true
  }

  clone(): Grid {
    const g = new Grid()
    for (let r = 0; r < ROWS; r++) g.px[r].set(this.px[r])
    return g
  }

  /** The 24-bit word for one column, in the panel's bit layout. */
  columnWord(c: number): number {
    let bits = 0
    for (let r = 0; r < ROWS; r++) {
      if (this.px[r][c]) bits |= 1 << (STRIDE * r)
    }
    return bits
  }

  /** One plaintext frame per column, ready to encrypt. */
  toFrames(): Uint8Array[] {
    const out: Uint8Array[] = []
    for (let c = 0; c < COLS; c++) {
      const w = this.columnWord(c)
      out.push(column(c, new Uint8Array([(w >> 16) & 0xff, (w >> 8) & 0xff, w & 0xff])))
    }
    return out
  }

  /**
   * Only the columns that differ from `previous`, as [index, frame] pairs.
   *
   * Each column costs a separate BLE write, so sending only what changed is the
   * main lever on frame rate.
   */
  deltaFrames(previous: Grid | null): Array<[number, Uint8Array]> {
    const out: Array<[number, Uint8Array]> = []
    for (let c = 0; c < COLS; c++) {
      const w = this.columnWord(c)
      if (previous && previous.columnWord(c) === w) continue
      out.push([
        c,
        column(c, new Uint8Array([(w >> 16) & 0xff, (w >> 8) & 0xff, w & 0xff])),
      ])
    }
    return out
  }

  /** ASCII preview, top row first, so terminal output matches the lens. */
  render(): string {
    const lines: string[] = []
    for (let r = ROWS - 1; r >= 0; r--) {
      lines.push([...this.px[r]].map((v) => (v ? '#' : '.')).join(''))
    }
    return lines.join('\n')
  }
}
