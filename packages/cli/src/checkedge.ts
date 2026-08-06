import { COLS, Grid, ROWS, alive, edgePixels } from '@joggles/core'

const g = new Grid()
for (const [r, c] of edgePixels()) g.set(r, c)
const on = (r: number, c: number) => g.get(r, c) > 0

// 1. Any 2x2 solid block means the outline is thicker than one pixel there.
const blocks: string[] = []
for (let r = 0; r < ROWS - 1; r++)
  for (let c = 0; c < COLS - 1; c++)
    if (on(r, c) && on(r + 1, c) && on(r, c + 1) && on(r + 1, c + 1))
      blocks.push(`(${r},${c})`)

// 2. A lit pixel with no dead/outside neighbour is interior fill, not outline.
const interior: string[] = []
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    if (!on(r, c)) continue
    const exposed = !alive(r + 1, c) || !alive(r - 1, c) || !alive(r, c + 1) || !alive(r, c - 1)
    if (!exposed) interior.push(`(${r},${c})`)
  }

// 3. Every live pixel on the true perimeter must be lit - no gaps in the trace.
const missing: string[] = []
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    if (!alive(r, c)) continue
    const exposed = !alive(r + 1, c) || !alive(r - 1, c) || !alive(r, c + 1) || !alive(r, c - 1)
    if (exposed && !on(r, c)) missing.push(`(${r},${c})`)
  }

const lit = edgePixels().length
console.log(`lit pixels: ${lit}`)
console.log(`2x2 solid blocks (thickness > 1): ${blocks.length ? blocks.join(' ') : 'none'}`)
console.log(`interior pixels (corner fill):    ${interior.length ? interior.join(' ') : 'none'}`)
console.log(`perimeter pixels missed:          ${missing.length ? missing.join(' ') : 'none'}`)
console.log(`\nverdict: ${!blocks.length && !interior.length && !missing.length ? 'exact 1px silhouette' : 'NOT exact'}`)
