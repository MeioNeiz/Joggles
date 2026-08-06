/**
 * Laptop-side BLE transport, over noble/CoreBluetooth.
 *
 * Two hardware constraints drive this whole file, both learned the hard way:
 *
 *  1. One 16-byte block per ATT write. The panel decodes only the FIRST block
 *     of a write and discards the rest, so batching silently loses columns.
 *  2. Write-without-response has no flow control, so writes must be paced or
 *     the controller drops them, leaving stale columns lit.
 */
import noble from '@abandonware/noble'
import { Grid, dats, display, protocol as p } from '@joggles/core'

/** noble strips dashes from UUIDs. */
const flat = (uuid: string) => uuid.replace(/-/g, '')

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface Options {
  /** Delay between column writes. Below ~12ms the panel starts dropping them. */
  pacing?: number
  timeoutMs?: number
}

export class Glasses {
  private last: Grid | null = null

  private waiters: Array<(reply: string) => void> = []

  private constructor(
    private peripheral: any,
    private cmdChar: any,
    private bulkChar: any,
    private datsChar: any,
    private notifyChar: any,
    private pacing: number,
  ) {}

  static async open(opts: Options = {}): Promise<Glasses> {
    const { pacing = 18, timeoutMs = 20000 } = opts
    const peripheral = await findGlasses(timeoutMs)
    await peripheral.connectAsync()
    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [],
      [flat(p.CHAR_COMMAND), flat(p.CHAR_BULK_A), flat(p.CHAR_BULK_B), flat(p.CHAR_NOTIFY)],
    )
    const find = (u: string) => characteristics.find((c: any) => c.uuid === flat(u))
    const cmd = find(p.CHAR_COMMAND)
    const bulk = find(p.CHAR_BULK_B)
    // The vendor app uploads DATS payloads to 960a, not 960b.
    const datsCh = find(p.CHAR_BULK_A)
    const notify = find(p.CHAR_NOTIFY)
    if (!cmd || !bulk) throw new Error('expected characteristics not found')
    const g = new Glasses(peripheral, cmd, bulk, datsCh, notify, pacing)
    await g.listen()
    return g
  }

  get name(): string {
    return this.peripheral.advertisement.localName
  }

  /** Subscribe to the notify channel; DATS is handshake-driven. */
  private async listen(): Promise<void> {
    if (!this.notifyChar) return
    this.notifyChar.on('data', (buf: Buffer) => {
      if (buf.length !== p.BLOCK_SIZE) return
      const reply = dats.parseReply(p.decrypt(new Uint8Array(buf)))
      if (!reply) return
      for (const w of this.waiters.splice(0)) w(reply)
    })
    await this.notifyChar.subscribeAsync()
  }

  private waitReply(timeoutMs = 5000): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve('TIMEOUT'), timeoutMs)
      this.waiters.push((r) => {
        clearTimeout(timer)
        resolve(r)
      })
    })
  }

  /**
   * Upload a bitmap for the device to store and animate by itself.
   *
   * Unlike show(), this survives disconnection: the MODE commands display
   * DATS content, not the live DIY buffer.
   */
  async upload(bitmap: number[][]): Promise<string> {
    if (!this.datsChar) throw new Error('960a not available')
    const payload = dats.encodeBitmap(bitmap)

    const ack = this.waitReply()
    await this.cmdChar.writeAsync(Buffer.from(p.encrypt(dats.datsStart(payload.length))), true)
    const started = await ack
    if (started !== 'DATSOK') return `DATS not acknowledged: ${started}`

    for (const block of dats.chunkPayload(payload)) {
      await this.datsChar.writeAsync(Buffer.from(p.encrypt(block)), true)
      await sleep(50) // the vendor app sleeps 50ms between chunks
    }

    const done = this.waitReply()
    await this.cmdChar.writeAsync(Buffer.from(p.encrypt(dats.datsComplete())), true)
    return await done
  }

  async command(frame: Uint8Array): Promise<void> {
    await this.cmdChar.writeAsync(Buffer.from(p.encrypt(frame)), true)
    await sleep(120)
  }

  /**
   * Write one bulk frame directly, bypassing the Grid's 24-column limit.
   *
   * Unacked, so callers driving a whole frame this way must call flush() before
   * disconnecting or the last writes are discarded.
   */
  async command_raw(frame: Uint8Array): Promise<void> {
    await this.bulkChar.writeAsync(Buffer.from(p.encrypt(frame)), true)
    await sleep(this.pacing)
  }

  /** Enter DIY mode with the panel on, ready for pixel writes. */
  async begin(): Promise<void> {
    await this.command(p.enterDIY())
    await this.command(p.leds(true))
    this.last = null
  }

  /** Push a frame. Sends only changed columns unless `full` is set. */
  async show(grid: Grid, full = false): Promise<number> {
    const frames = full
      ? grid.toFrames().map((f, i) => [i, f] as [number, Uint8Array])
      : grid.deltaFrames(this.last)
    for (const [i, [, frame]] of frames.entries()) {
      // noble: second arg is `withoutResponse`. The last write of a frame is
      // acked, so the frame cannot be half-delivered if the caller disconnects
      // or exits immediately afterwards.
      const last = i === frames.length - 1
      await this.bulkChar.writeAsync(Buffer.from(p.encrypt(frame)), !last)
      if (!last) await sleep(this.pacing)
    }
    this.last = grid.clone()
    return frames.length
  }

  /**
   * Finish a session.
   *
   * Leaving DIY mode makes the firmware restore whatever image the vendor app
   * saved, which looks exactly like stray pixels appearing from nowhere. So
   * "keep" is the default.
   */
  async end(mode: 'keep' | 'off' | 'restore' = 'keep'): Promise<void> {
    if (mode === 'off') {
      await this.show(new Grid(), true)
      await this.command(p.leds(false))
    } else if (mode === 'restore') {
      await this.command(p.exitDIY())
    }
    await this.flush()
    await this.peripheral.disconnectAsync()
  }

  /**
   * Force any queued writes out.
   *
   * A write WITH response is acknowledged by the peer, so once it returns every
   * earlier write has necessarily been transmitted. show() already ends with an
   * acked write; this covers raw writers that do not.
   */
  async flush(): Promise<void> {
    await this.cmdChar.writeAsync(Buffer.from(p.encrypt(p.frame('STYPE'))), false)
  }
}

function findGlasses(timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      await noble.stopScanningAsync().catch(() => {})
      reject(new Error('glasses not found - powered on? still held by the phone?'))
    }, timeoutMs)

    const onDiscover = async (peripheral: any) => {
      const name: string = peripheral.advertisement.localName ?? ''
      if (!name.startsWith(p.NAME_PREFIX)) return
      clearTimeout(timer)
      noble.removeListener('discover', onDiscover)
      await noble.stopScanningAsync()
      resolve(peripheral)
    }

    noble.on('discover', onDiscover)
    if (noble._state === 'poweredOn') {
      noble.startScanningAsync([], false).catch(reject)
    } else {
      noble.once('stateChange', async (state: string) => {
        if (state === 'poweredOn') await noble.startScanningAsync([], false).catch(reject)
        else reject(new Error(`bluetooth adapter is ${state}`))
      })
    }
  })
}

export { display, Grid }
