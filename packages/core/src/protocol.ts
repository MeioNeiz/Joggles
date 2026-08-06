/**
 * Funky Glasses+ BLE wire format.
 *
 * Recovered from the vendor APK; see notes/protocol.md. Every write is exactly
 * one 16-byte AES-128-ECB block:
 *
 *     [len][opcode ASCII...][args...][zero padding to 16]
 *
 * `len` counts opcode plus arguments, excluding padding.
 */
import { decryptBlock, encryptBlock, expandKey } from './aes.js'

export const SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb'
export const CHAR_COMMAND = 'd44bc439-abfd-45a2-b575-925416129600'
export const CHAR_NOTIFY = 'd44bc439-abfd-45a2-b575-925416129601'
export const CHAR_BULK_A = 'd44bc439-abfd-45a2-b575-92541612960a'
export const CHAR_BULK_B = 'd44bc439-abfd-45a2-b575-92541612960b'

/** Panchip OTA. Present on the device; writing here can brick it. */
export const SERVICE_OTA = '0000fd00-0000-1000-8000-00805f9b34fb'

export const BLOCK_SIZE = 16
export const NAME_PREFIX = 'GLASSES-'

/** Manufacturer-data marker the vendor app filters on: "TR\0:". */
export const SIGNATURE = new Uint8Array([0x54, 0x52, 0x00, 0x3a])

/** Hardcoded in the vendor's libAES.so, recovered by brute-forcing the image. */
export const KEY = new Uint8Array([
  0x34, 0x52, 0x2a, 0x5b, 0x7a, 0x6e, 0x49, 0x2c,
  0x08, 0x09, 0x0a, 0x9d, 0x8d, 0x2a, 0x23, 0xf8,
])

const ROUND_KEYS = expandKey(KEY)

export const encrypt = (frame: Uint8Array): Uint8Array => encryptBlock(ROUND_KEYS, frame)
export const decrypt = (block: Uint8Array): Uint8Array => decryptBlock(ROUND_KEYS, block)

/** Build a plaintext frame from an ASCII opcode and its arguments. */
export function frame(opcode: string, ...args: number[]): Uint8Array {
  const body = [...opcode].map((c) => c.charCodeAt(0)).concat(args)
  if (body.length > BLOCK_SIZE - 1) {
    throw new Error(`frame body too long: ${body.length}`)
  }
  const out = new Uint8Array(BLOCK_SIZE)
  out[0] = body.length
  out.set(body, 1)
  return out
}

/** The meaningful bytes of a plaintext frame, padding stripped. */
export function body(f: Uint8Array): Uint8Array {
  const n = f[0]
  return n > f.length - 1 ? new Uint8Array(0) : f.subarray(1, 1 + n)
}

const ascii = (b: Uint8Array) => String.fromCharCode(...b)

// --- Command table, transcribed from the vendor app's Agreement.java ---

export const enterDIY = () => frame('SMVEW', 1)
export const enterDIYAlt = () => frame('SMVEW', 3)
export const exitDIY = () => frame('SMVEW', 0)
export const exitDIYSave = () => frame('SMVEW', 2)
export const queryType = () => frame('STYPE')
export const brightness = (level: number) => frame('LIGHT', level)
export const speed = (v: number) => frame('SPEED', v)
export const invert = () => frame('EVERT')
export const animation = (i: number) => frame('ANIM', i)
export const animationLoop = () => frame('LOOA')
export const image = (i: number) => frame('IMAG', i)
export const modeStatic = () => frame('MODE', 1)
export const modeFlash = (rate: number) => frame('MODE', 2, (rate >> 8) & 0xff, rate & 0xff)
export const scrollLeft = (s: number) => frame('MODE', 3, s)
export const scrollRight = (s: number) => frame('MODE', 4, s)
export const stopRhythm = () => frame('STOPR')
export const exitRhythm = () => frame('SOUT')
export const leds = (on: boolean) => (on ? frame('LEDON') : frame('LEDOFF'))
export const flashlight = (on: boolean) => (on ? frame('LIGHTON') : frame('LIGHTOFF'))

/** Address one lens: 1 or 2. Untested against hardware. */
export function lens(which: 1 | 2): Uint8Array {
  return which === 1 ? frame('LEDFIRST') : frame('LEDSECOND')
}

/** One bulk pixel frame: [04][index][3 bytes of column bitmap]. */
export function column(index: number, bitmap: Uint8Array): Uint8Array {
  if (bitmap.length !== 3) throw new Error('column bitmap must be 3 bytes')
  return frame('', index, bitmap[0], bitmap[1], bitmap[2])
}

/** Decode a STYPE reply. Our unit never answers, but the firmware family does. */
export function parseType(f: Uint8Array): { rows: number; cols: number } | null {
  const text = ascii(body(f))
  if (!text.startsWith('STYPE')) return null
  const [r, c] = text.slice(5).split('X')
  const rows = Number(r)
  const cols = Number(c)
  return Number.isFinite(rows) && Number.isFinite(cols) && c !== undefined
    ? { rows, cols }
    : null
}
