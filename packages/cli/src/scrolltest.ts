import { Grid, display, font, protocol as p } from '@joggles/core'
import { Glasses, sleep } from './glasses.js'

// Previous test wrote indices 0..49 into what looks like a 24-column buffer and
// corrupted it. Retry with content that fits, to see whether device-side scroll
// is clean and usable.
const g = await Glasses.open({ pacing: 8 })
console.log(`connected to ${g.name}`)
await g.begin()

const draw = async (text: string) => {
  const bmp = font.textBitmap(text)
  const grid = new Grid()
  const w = font.textWidth(text)
  for (let r = 0; r < font.HEIGHT; r++)
    for (let c = 0; c < w && c < display.COLS; c++)
      if (bmp[r][c]) grid.set(font.BASELINE + r, c)
  console.log(grid.render())
  await g.show(grid, true)
}

console.log('=== "ABC 123" (fits in 24 cols), static for 8s')
await draw('ABC 123')
await sleep(8000)

console.log('\n=== now MODE 03 (device scroll left) for 15s')
console.log('    Does ABC 123 scroll cleanly and stay readable?')
await g.command(p.scrollLeft(3))
await sleep(15000)

console.log('\n=== MODE 01 (static) to stop it')
await g.command(p.modeStatic())
await sleep(3000)

await g.end('keep')
console.log('done')
process.exit(0)
