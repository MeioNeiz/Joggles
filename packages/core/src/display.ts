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
 * Each pixel is TWO bits, and the odd bit is brightness - confirmed on hardware
 * by comparing 0b01 against 0b11. So the panel is 4-level greyscale, not
 * monochrome. The vendor's own frame data only ever uses OFF or MAX.
 */
export const PIXEL_OFF = 0b00
export const PIXEL_DIM = 0b01
export const PIXEL_MID = 0b10
export const PIXEL_ON = 0b11

/** Highest pixel level, for callers scaling into the range. */
export const MAX_LEVEL = 3

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

  /** Set a pixel. `level` is 0-3; `true` means full brightness. */
  set(row: number, col: number, level: boolean | number = PIXEL_ON): this {
    if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
      const v = level === true ? PIXEL_ON : level === false ? 0 : level
      this.px[row][col] = Math.max(0, Math.min(MAX_LEVEL, Math.round(v)))
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

  /**
   * The 24-bit word for one column, in the panel's bit layout.
   *
   * Each pixel owns two bits. The vendor's own animation data (AnimData.java)
   * only ever uses 0b00 or 0b11, never a single bit, so we write 0b11 to match.
   * Writing only the even bit lights the LED too, but is not something the
   * firmware ever does itself.
   */
  columnWord(c: number): number {
    let bits = 0
    for (let r = 0; r < ROWS; r++) {
      bits |= (this.px[r][c] & PIXEL_ON) << (STRIDE * r)
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
    const shade = ['.', '-', '+', '#'] // one glyph per brightness level
    const lines: string[] = []
    for (let r = ROWS - 1; r >= 0; r--) {
      lines.push([...this.px[r]].map((v) => shade[v] ?? '#').join(''))
    }
    return lines.join('\n')
  }
}
