#!/usr/bin/env bun
/**
 * Laptop control for the glasses.
 *
 *   bun cli text "HELLO"     scroll or centre text
 *   bun cli edge             trace the panel silhouette
 *   bun cli bench            measure the real frame rate
 *   bun cli off              blank the panel
 */
import { Grid, display, font, protocol as p } from '@joggles/core'
import { Glasses, sleep } from './glasses.js'

function frameFor(bitmap: number[][], offset: number): Grid {
  const g = new Grid()
  const w = bitmap[0]?.length ?? 0
  for (let r = 0; r < font.HEIGHT; r++) {
    for (let c = 0; c < display.COLS; c++) {
      const src = c + offset
      if (src >= 0 && src < w && bitmap[r][src]) g.set(font.BASELINE + r, c)
    }
  }
  return g
}

async function cmdText(text: string): Promise<void> {
  const bitmap = font.textBitmap(text)
  const w = font.textWidth(text)
  console.log(`${JSON.stringify(text)} -> ${w} columns, panel is ${display.COLS}\n`)

  const glasses = await Glasses.open()
  console.log(`connected to ${glasses.name}`)
  await glasses.begin()

  if (w <= display.COLS) {
    const centred = frameFor(bitmap, -Math.floor((display.COLS - w) / 2))
    console.log(centred.render())
    await glasses.show(centred, true)
    await sleep(20000)
  } else {
    console.log('scrolling 3 times...')
    for (let pass = 0; pass < 3; pass++) {
      for (let off = -display.COLS; off <= w; off++) {
        await glasses.show(frameFor(bitmap, off))
      }
    }
  }
  await glasses.end('keep')
}

async function cmdEdge(): Promise<void> {
  const g = new Grid()
  for (const [r, c] of display.edgePixels()) g.set(r, c)
  console.log(g.render())
  const glasses = await Glasses.open()
  await glasses.begin()
  await glasses.show(g, true)
  console.log('edge trace displayed')
  await glasses.end('keep')
}

async function cmdOff(): Promise<void> {
  const glasses = await Glasses.open()
  await glasses.begin()
  await glasses.end('off')
  console.log('panel off')
}

/**
 * Measure real throughput. This decides what the app can be: a text-and-presets
 * controller, or something that animates.
 */
async function cmdBench(): Promise<void> {
  console.log('measuring frame rate at several pacings\n')
  console.log('pacing   full-frame fps   delta fps (sparse)   verdict')
  console.log('-'.repeat(62))

  for (const pacing of [18, 12, 8, 5, 3, 1]) {
    const glasses = await Glasses.open({ pacing })
    await glasses.begin()

    // Full frames: every column rewritten, the worst case.
    const full: Grid[] = []
    for (let i = 0; i < 6; i++) {
      const g = new Grid()
      for (let c = 0; c < display.COLS; c++) g.set(2 + (i % 5), c)
      full.push(g)
    }
    let t0 = performance.now()
    for (const g of full) await glasses.show(g, true)
    const fullFps = (full.length / (performance.now() - t0)) * 1000

    // Sparse: a single moving pixel, the best case for delta updates.
    const sparse: Grid[] = []
    for (let i = 0; i < 12; i++) {
      const g = new Grid()
      g.set(4, i * 2)
      sparse.push(g)
    }
    await glasses.show(sparse[0], true)
    t0 = performance.now()
    for (const g of sparse) await glasses.show(g)
    const deltaFps = (sparse.length / (performance.now() - t0)) * 1000

    const verdict =
      deltaFps >= 15 ? 'animation viable' : deltaFps >= 8 ? 'usable' : 'too slow'
    console.log(
      `${String(pacing).padStart(4)}ms   ${fullFps.toFixed(1).padStart(12)}   ` +
        `${deltaFps.toFixed(1).padStart(18)}   ${verdict}`,
    )
    await glasses.end('keep')
    await sleep(500)
  }
  console.log('\nIf sparse fps stays high as pacing drops, we are pacing-bound')
  console.log('and can simply go faster. If it plateaus, the panel is the limit.')
}


/**
 * Visual reliability check. The bench measures send rate; this finds the pacing
 * at which the panel stops keeping up, which only a human can see.
 */
async function cmdStress(): Promise<void> {
  console.log('A vertical bar sweeps left-to-right at each pacing.')
  console.log('Watch for: tearing, columns left lit behind the bar, stutter.\n')

  for (const pacing of [12, 8, 5, 3, 2, 1]) {
    console.log(`=== pacing ${pacing}ms - sweeping 4 times`)
    const glasses = await Glasses.open({ pacing })
    await glasses.begin()
    await glasses.show(new Grid(), true)
    for (let pass = 0; pass < 4; pass++) {
      for (let c = 0; c < display.COLS; c++) {
        const g = new Grid()
        for (let r = 0; r < display.ROWS; r++) g.set(r, c)
        await glasses.show(g)
      }
    }
    await glasses.show(new Grid(), true)
    await glasses.end('keep')
    console.log('    done\n')
    await sleep(1500)
  }
  console.log('At which pacing did it start looking wrong?')
}

const [cmd, ...rest] = process.argv.slice(2)
try {
  switch (cmd) {
    case 'text':
      await cmdText(rest.join(' ') || 'HELLO')
      break
    case 'edge':
      await cmdEdge()
      break
    case 'off':
      await cmdOff()
      break
    case 'stress':
      await cmdStress()
      break
    case 'bench':
      await cmdBench()
      break
    default:
      console.log('usage: bun cli <text|edge|off|bench|stress> [args]')
      process.exit(1)
  }
  process.exit(0)
} catch (err) {
  console.error('error:', (err as Error).message)
  process.exit(1)
}
