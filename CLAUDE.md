# Joggles

LED glasses, vendor app Funky Glasses+. Protocol solved, verified on hardware. Detail:
`notes/protocol.md`, `research/` (firmware, OTA, saved content).

- Bun + TS only. No Python, no Go
- `packages/core` pure TS, zero deps. `packages/cli` noble/CoreBluetooth
- `bun test` | `bun cli <text|edge|off|bench|stress>`

## Mental model

Renders on-device. Upload once, let it animate; don't stream. Saved store is separate
from the DIY live buffer; `MODE` shows the saved store. Wide buffers work (~200 cols,
scrolls unattended).

Channels: `9600` cmds | `9601` notify | `960a` DATS bulk | `960b` live per-column.
Save: `DATS <type> <len16>` -> `DATSOK` -> 15-byte blocks -> `DATCP` -> `DATCPOK`.
type 1 text (2-byte cols), 2 image (3-byte cols). One buffer per type, no slots.
`SMVEW 02` also saves (app never sends it).

## Gotchas

- ONE 16-byte block per ATT write. Panel decodes first only, drops rest silently
- Write-without-response has no flow control. Pace writes or columns go stale
- Pacing-bound not hardware-bound. Safe floor unknown
- `SMVEW 00` restores the saved image, looks like stray pixels. Default `end('keep')`
- `MODE` while in DIY switches to saved content, discards the live buffer
- BLE = one connection. Close phone app first

## Geometry

9 rows x 24 cols/lens. row 0 bottom, col 0 left. row r -> bit 2r, 2bpp. Dead: top-row
mid-6, nose notch. `display.alive()`.

## Unverified

`MODE` 2nd byte (direction in app, n=0..7 differ on hw), `DATS` type 2 >72 bytes,
`LEDFIRST`/`LEDSECOND`, odd bit, `COLR`/`LEVL`/`POWR`, `STYPE`.

## Don't

- Flash firmware. Format solved (XOR pad + CRC32, no signature) but no verified
  recovery path, and OTA lives in the app image: bad flash may be permanent
- Commit vendor binaries: `apk/`, `decompiled/`, `native/`, `firmware/`
