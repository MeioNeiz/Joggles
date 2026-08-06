#!/usr/bin/env bun
/** Show all four brightness levels at once, as vertical bands. */
import { Grid, display, protocol as p } from '@joggles/core'
import { Glasses, sleep } from './glasses.js'

const g = new Grid()
// Four bands across the panel, one per level, in the gap-free row band.
for (let c = 0; c < display.COLS; c++) {
  const level = Math.floor(c / 6) // 0,1,2,3 across 24 columns
  for (let r = 2; r <= 7; r++) g.set(r, c, level)
}
console.log('levels 0,1,2,3 as six-column bands, left to right:\n')
console.log(g.render())

const glasses = await Glasses.open({ pacing: 8 })
console.log(`\nconnected to ${glasses.name}`)
await glasses.begin()
await glasses.show(g, true)
console.log('holding 20s - do you see four distinct brightness steps?')
await sleep(20000)
await glasses.end('keep')
process.exit(0)
