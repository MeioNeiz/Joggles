# Joggles

Reverse engineering and driving app-controlled LED glasses (vendor app: Funky
Glasses+, `com.pinkysinyeeho.funkyglassesplus`) from our own code.

The protocol is **solved** and verified against live hardware. See
`notes/protocol.md` for the full findings, including the AES key, command table,
pixel format and panel geometry.

## Layout

    packages/core    protocol, display, font    pure TS, zero dependencies
    packages/cli     laptop control via noble   Bun + CoreBluetooth
    tools/           APK pull and decompile     shell
    notes/           protocol reference         solved, verified on hardware
    research/        firmware and OTA teardown  plus a runnable image codec

## Quick start

    bun install
    bun test                    # 17 tests, incl. FIPS-197 and captured vectors
    bun cli text "HELLO"
    bun cli edge                # trace the panel silhouette
    bun cli bench               # measure throughput
    bun cli off

### macOS Bluetooth permission

BLE from a terminal requires the *terminal app* to hold Bluetooth permission.
Without it the process dies with SIGABRT and no message.
System Settings > Privacy & Security > Bluetooth.

### Note on `bun install`

`@abandonware/noble` needs a native build, so it is listed in
`trustedDependencies`. Without that Bun skips the build script and the binding
fails to load at runtime.

## Hardware summary

| Property | Value |
| --- | --- |
| Advertised name | `GLASSES-{MAC}` |
| SoC | ARM Cortex-M, 16 KB SRAM, 26 MHz crystal |
| Firmware | `TR1906R04-10`, roughly 66 KB, loaded above a resident bootloader |
| OTA | service `fd00`, Panchip-style profile (no vendor name in the binaries) |
| Panel | 9 rows x 24 columns per lens, two bits per pixel |
| Encryption | AES-128-ECB, one 16-byte block per write; OTA is **not** encrypted |

The OTA image format is solved and both stock images round-trip byte-identically:

    bun research/ota-codec.ts verify firmware/*.bin

Flashing is nonetheless **not** safe yet. See `research/firmware-image-format.md`.

Two physical gaps in the panel: the middle of the top row, and a triangular
nose-bridge notch. `display.alive()` maps them.

## Prior art

- [jrd3n/ble_hacks](https://github.com/jrd3n/ble_hacks) - partial capture of this
  device; `reference/ble_hacks/data.csv` is retained as a test vector.
- [gsuberland/ChemionHacking](https://github.com/gsuberland/ChemionHacking) -
  same class of hardware.
