# Joggles

App-controlled LED glasses (vendor app: Funky Glasses+). Protocol solved, verified on
hardware. Key, command table, frame format: `notes/protocol.md`.

- Bun + TS only. No Python, no Go
- `packages/core` pure TS, zero deps. `packages/cli` noble/CoreBluetooth
- `bun test` | `bun cli <text|edge|off|bench|stress>`

## Mental model

Glasses render on-device, not a dumb frame buffer: scroll (`MODE 03/04`), built-in
`ANIM`/`IMAG` banks, persistent saved content. BLE is the upload channel. Prefer
upload-once + device-side animation over streaming frames.

## Gotchas

- ONE 16-byte block per ATT write. Panel decodes first block only, silently drops the
  rest. Never batch
- Write-without-response has no flow control. Pace writes or columns go stale
- Pacing-bound not hardware-bound (bench: 18ms 2.2fps, 1ms 33.7fps). 18ms was a bad
  guess. Safe floor not yet confirmed visually
- Exiting DIY (`SMVEW 00`) restores the vendor-saved image. Looks like stray pixels.
  Default `end('keep')`
- BLE = one connection. Close phone app before connecting from laptop
- macOS: terminal app needs Bluetooth permission or SIGABRT, no message
- `@abandonware/noble` needs `trustedDependencies` or binding fails at runtime

## Geometry

9 rows x 24 cols per lens. row 0 = bottom, col 0 = left. row r -> bit 2r (2 bits per
pixel, odd bit unknown). Dead: middle 6 of top row, triangular nose notch bottom.
`display.alive()`.

## Unverified

Device-side scroll from a wide uploaded buffer, `LEDFIRST`/`LEDSECOND` lens select,
odd-bit meaning, `STYPE` never answers on our unit.

## Don't

- Flash firmware. OTA images encrypted with a bootloader-held key we don't have. Stock
  images in `firmware/` are recovery only
- Commit vendor binaries: `apk/`, `decompiled/`, `native/`, `firmware/` (gitignored)
