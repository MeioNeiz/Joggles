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
import { Grid, display, protocol as p } from '@joggles/core'

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

  private constructor(
    private peripheral: any,
    private cmdChar: any,
    private bulkChar: any,
    private pacing: number,
  ) {}

  static async open(opts: Options = {}): Promise<Glasses> {
    const { pacing = 18, timeoutMs = 20000 } = opts
    const peripheral = await findGlasses(timeoutMs)
    await peripheral.connectAsync()
    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [],
      [flat(p.CHAR_COMMAND), flat(p.CHAR_BULK_B)],
    )
    const cmd = characteristics.find((c: any) => c.uuid === flat(p.CHAR_COMMAND))
    const bulk = characteristics.find((c: any) => c.uuid === flat(p.CHAR_BULK_B))
    if (!cmd || !bulk) throw new Error('expected characteristics not found')
    return new Glasses(peripheral, cmd, bulk, pacing)
  }

  get name(): string {
    return this.peripheral.advertisement.localName
  }

  async command(frame: Uint8Array): Promise<void> {
    await this.cmdChar.writeAsync(Buffer.from(p.encrypt(frame)), true)
    await sleep(120)
  }

  /** Write one bulk frame directly, bypassing the Grid's 24-column limit. */
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
    for (const [, frame] of frames) {
      await this.bulkChar.writeAsync(Buffer.from(p.encrypt(frame)), true)
      await sleep(this.pacing)
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
    await this.peripheral.disconnectAsync()
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
