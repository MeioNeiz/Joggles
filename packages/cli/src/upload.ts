#!/usr/bin/env bun
/**
 * Upload our OWN rendered bitmap via DATS, then let the device animate it.
 *
 * The point: the renderer is entirely ours - our font, our layout, any width -
 * and the device stores and scrolls the result with nothing connected.
 */
import { font, protocol as p } from '@joggles/core'
import { Glasses, sleep } from './glasses.js'

const text = process.argv.slice(2).join(' ') || 'JOGGLES'

// Our own renderer. Row 0 is the bottom; DATS holds 14 rows and we use 7.
const src = font.textBitmap(text)
const bitmap = Array.from({ length: 14 }, (_, r) =>
  r < font.HEIGHT ? [...src[r]] : new Array(src[0]?.length ?? 0).fill(0),
)

console.log(`"${text}" -> ${bitmap[0].length} columns (panel is 24)\n`)
for (let r = font.HEIGHT - 1; r >= 0; r--) {
  console.log('  ' + bitmap[r].map((v) => (v ? '#' : '.')).join(''))
}

const g = await Glasses.open({ pacing: 8 })
console.log(`\nconnected to ${g.name}`)

console.log('uploading via DATS...')
const result = await g.upload(bitmap)
console.log(`device replied: ${result}`)

if (result === 'DATCPOK') {
  console.log('\nsetting MODE 01 (static) then MODE 03 (scroll)')
  await g.command(p.frame('MODE', 1, 0))
  await g.command(p.frame('SPEED', 50))
  await sleep(5000)
  await g.command(p.frame('MODE', 3, 0))
  console.log('scrolling - disconnecting in 10s, it should KEEP GOING')
  await sleep(10000)
}

await g.end('keep')
console.log('disconnected')
process.exit(0)
