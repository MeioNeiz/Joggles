/**
 * OTA container codec for TR1906R04 firmware images.
 *
 * The payload is not encrypted with a key we lack: it is XOR-obfuscated with a
 * fixed 128-byte pad derived from one 32-bit seed, and the header CRC-32 covers
 * the DEOBFUSCATED body. Both facts are verified against the two stock images.
 * See research/firmware-image-format.md.
 *
 *   bun research/ota-codec.ts verify firmware/*.bin
 *   bun research/ota-codec.ts decode firmware/TR1906R04-10_OTA.bin out.bin
 *   bun research/ota-codec.ts encode out.bin rebuilt.bin
 */

const SEED = 0x37627996
const PAD_LEN = 128

const rotr = (v: number, n: number) => ((v >>> n) | (v << (32 - n))) >>> 0

export const pad = (() => {
  const p = new Uint8Array(PAD_LEN)
  for (let n = 0; n < 32; n++) {
    const w = rotr(SEED, n)
    p[n * 4] = (w >>> 24) & 0xff
    p[n * 4 + 1] = (w >>> 16) & 0xff
    p[n * 4 + 2] = (w >>> 8) & 0xff
    p[n * 4 + 3] = w & 0xff
  }
  return p
})()

/** Involution: same operation deobfuscates and reobfuscates. */
export function deobfuscate(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length)
  for (let i = 0; i < body.length; i++) out[i] = body[i] ^ pad[i % PAD_LEN]
  return out
}

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (const x of b) {
    c = (c ^ x) >>> 0
    for (let k = 0; k < 8; k++) c = c & 1 ? ((c >>> 1) ^ 0xedb88320) >>> 0 : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

export interface Header {
  codeSize: number
  crc32: number
  appVer: number
  devVer: number
  proVer: number
  type: number
}

export function parseHeader(file: Uint8Array): Header {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength)
  return {
    codeSize: dv.getUint32(0, true),
    crc32: dv.getUint32(4, true),
    appVer: dv.getUint16(8, true),
    devVer: dv.getUint16(10, true),
    proVer: dv.getUint16(12, true),
    type: file[14],
  }
}

/** Build a flashable image from plaintext firmware. Recomputes size and CRC. */
export function encode(plain: Uint8Array, h: Omit<Header, 'codeSize' | 'crc32'>): Uint8Array {
  const out = new Uint8Array(16 + plain.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, plain.length, true)
  dv.setUint32(4, crc32(plain), true)
  dv.setUint16(8, h.appVer, true)
  dv.setUint16(10, h.devVer, true)
  dv.setUint16(12, h.proVer, true)
  out[14] = h.type
  out.set(deobfuscate(plain), 16)
  return out
}

const hex8 = (n: number) => '0x' + n.toString(16).padStart(8, '0')

async function verify(paths: string[]) {
  for (const path of paths) {
    const file = new Uint8Array(await Bun.file(path).arrayBuffer())
    const h = parseHeader(file)
    const plain = deobfuscate(file.slice(16))

    const sizeOk = h.codeSize === file.length - 16
    const crcOk = crc32(plain) === h.crc32
    const rebuilt = encode(plain, h)
    const rtOk = rebuilt.length === file.length && rebuilt.every((v, i) => v === file[i])

    // every pad position should be dominated by 0x00 in the plaintext
    let badPos = 0
    for (let j = 0; j < PAD_LEN; j++) {
      const hist = new Array(256).fill(0)
      for (let i = j; i < plain.length; i += PAD_LEN) hist[plain[i]]++
      let mode = 0
      for (let v = 1; v < 256; v++) if (hist[v] > hist[mode]) mode = v
      if (mode !== 0) badPos++
    }

    console.log(`${path}`)
    console.log(`  codeSize ${h.codeSize} (${sizeOk ? 'matches file length' : 'MISMATCH'})`)
    console.log(`  crc32    ${hex8(h.crc32)} over deobfuscated body: ${crcOk ? 'MATCH' : 'MISMATCH'}`)
    console.log(`  version  app=${h.appVer} dev=${h.devVer} pro=${h.proVer} type=${h.type}`)
    console.log(`  pad positions with non-zero modal byte: ${badPos}/${PAD_LEN}`)
    console.log(`  re-encode byte-identical to original: ${rtOk}`)
  }
}

const [cmd, ...rest] = Bun.argv.slice(2)
if (cmd === 'verify') {
  await verify(rest)
} else if (cmd === 'decode') {
  const file = new Uint8Array(await Bun.file(rest[0]).arrayBuffer())
  await Bun.write(rest[1], deobfuscate(file.slice(16)))
  console.log(JSON.stringify(parseHeader(file), null, 2))
} else if (cmd === 'encode') {
  const plain = new Uint8Array(await Bun.file(rest[0]).arrayBuffer())
  await Bun.write(rest[1], encode(plain, { appVer: 3, devVer: 10, proVer: 10, type: 1 }))
  console.log(`wrote ${rest[1]}: ${plain.length} body bytes, crc32 ${hex8(crc32(plain))}`)
} else {
  console.log('usage: ota-codec.ts <verify|decode|encode> ...')
}
