# Saved content, wide buffers, and the opcode inventory

**Status:** recovered by reading the decompiled vendor app end to end. Everything
here is what the app **actually emits**, kept distinct from what its library merely
defines.
**Scope:** the persist-to-device path, device-side wide-buffer scrolling, the
complete opcode inventory, and every hard limit.
**Related:** `notes/protocol.md` (key, frame format, geometry),
`research/firmware-image-format.md` (firmware and OTA).

## Key facts

| Fact | Value | Confidence |
| --- | --- | --- |
| Real save mechanism | `DATS`/`DATCP` handshake, not `SMVEW 02` | verified from app source |
| `SMVEW 02` in the app | dead code, zero callers, though the device honours it | verified |
| Saved content slots | one buffer per type, no slot index in the protocol | verified |
| Content types | `1` = text, `2` = DIY image | verified |
| Upload length field | 16-bit, so up to 65535 bytes announced | verified |
| Device-side wide scroll | real: the app uploads ~200 columns and scrolls them unattended | verified |
| Flash ceiling for saved content | `0x600` bytes (1.5 KB) at `abs 0x3c000` | derived from firmware literals |
| Main service UUID | `0xfff0`, **not** `0xfee9` | verified |
| `MODE` second byte | direction flag in the app, 0 or 1 only | verified |
| `IMAG` range | 0 to 10 | verified |
| `ANIM` range | 20 to 29 | verified |

## Correction: the main service is 0xfff0

The app's `BleManager.UUID_SERVICE_TEXT` is `0000fff0-0000-1000-8000-00805f9b34fb`,
and that is what `onServicesDiscovered` matches on. `0000fee9` survives only as a
stale default constant in the base library's `AppConfig.java`.

The firmware declares both: `0xfff0` at body `0xc2ec` and `0xfee9` at body `0xc2f8`,
twelve bytes apart in the same table. Our own `packages/core/src/protocol.ts`
already uses `0xfff0` and connects successfully, so `0xfff0` is the one to build
discovery around. The GATT table in `notes/protocol.md` lists `0xfee9` and is the
stale entry.

## The DATS/DATCP upload handshake

This is the real "save to device" mechanism.

| Step | Direction | Frame and channel |
| --- | --- | --- |
| 1 | app to device | `DATS <type> <len_hi> <len_lo>`, frame `07 44 41 54 53 tt hh ll`, on `...9600` |
| 2 | device to app | notify `DATSOK` on `...9601` |
| 3 | app to device | stream `len` bytes on `...960a` as count-prefixed 16-byte blocks: `[count][up to 15 data bytes]` |
| 4 | app to device | `DATCP`, frame `05 44 41 54 43 50`, on `...9600` |
| 5 | device to app | notify `DATCPOK` on success, or `ERROR` on failure |

`type` is `1` for the text buffer and `2` for a DIY image; those are the only values
the app uses. Inter-block pacing is 50 ms for text and 60 ms for images.

All three reply strings are present verbatim in the firmware image at body `0x1dbc`
(`DATSOK`, `DATCPOK`, `ERROR00`), which independently confirms the handshake is
firmware-side rather than an app-only abstraction.

`DATCPOK` is the device confirming it has stored and verified the buffer. There is
no slot argument: one saved buffer per type.

The uploaded content lands in a `0x600`-byte buffer at `abs 0x3c000`, with an 8-byte
metadata record at `abs 0x3c800`, erased at 512-byte granularity. 1536 bytes is 512
columns at 3 bytes per column, or 768 at 2 bytes per column.

## Channel routing

| Characteristic | Role |
| --- | --- |
| `...9600` | commands, including `DATS` and `DATCP` |
| `...9601` | notify, device replies |
| `...960a` | `DATS` bulk stream, count-prefixed blocks |
| `...960b` | live/real-time: per-column DIY writes and rhythm frames |

So the `[04][column][3 bytes]` format documented in `notes/protocol.md` is the
**live** format on `...960b`. The `DATS` stream on `...960a` is a different
encoding.

DIY mode is not required for `DATS` uploads: the text path never enters DIY. DIY
(`SMVEW 01`/`03`) is for the live channel only.

## Three distinct pixel encodings

Worth keeping straight, because they are easy to confuse:

- **live column** on `...960b`: `[04][column index][3 bytes]`, two bits per pixel
- **`DATS` type 1 (text)**: flat concatenation of **2-byte little-endian columns**,
  one bit per pixel, with **14 usable rows in a 7 plus 7 split**: bits 0-6 are rows
  0-6, bits 8-14 are rows 7-13, and bit 7 is unused. Recovered from a real HCI
  capture by `packages/cli/src/dats.ts`. Our panel lights only 9 of those rows, so
  the format is the firmware family's maximum rather than this unit's geometry
- **`DATS` type 2 (DIY image)**: exactly 72 bytes, 24 columns of 3 bytes, two bits
  per pixel

## Wide buffers are real

The scrolling-text path is the proof:

- Glyphs are emitted as runs of 2-byte columns and concatenated into one flat buffer
  with no truncation to 24 columns.
- The whole buffer goes up in a single `DATS 01 <len>` handshake, where the length
  field *is* the width parameter.
- Only afterwards does the app send one `MODE` command, once.

The app's 40-half-width-character input cap works out at roughly **200 columns, or 8
times the panel width**, in around 400 bytes. That is comfortably inside both the
16-bit length field and the 1.5 KB flash buffer, so the 40-character cap is a UI
limit rather than a protocol or firmware one.

The 24-column ceiling on DIY images comes from the drawing canvas being initialised
at 24 by 9, not from the protocol. The live column frame carries a full byte of
column index.

### The one experiment worth running

Upload a wide custom bitmap via **`DATS` type 2 with a length greater than 72
bytes**, then drive it with `MODE`, watching `...9601` for `DATCPOK` versus `ERROR`.
The mechanism (type byte, arbitrary 16-bit length, device-side `MODE` animation) is
shared with the text path that demonstrably handles wide buffers.

This is also a genuine request/response probe, which matters because our unit never
answers `STYPE`: the handshake gives a definite yes or no on the wire.

## Corrections to the command table

### MODE arguments

The live scroll commands come from `getContentCommand(i, i2)`, frame
`06 4d 4f 44 45 <i> <i2>`, called only from the text screen with:

- `MODE 01 00` static
- `MODE 02 <dir>` horizontal scroll
- `MODE 03 <dir>` vertical scroll

where `<dir>` is 0 or 1. The `getRollToLeftCommand`/`getRollToRightCommand` variants
that produced the "`MODE 03 n` = scroll left at speed n" reading are **dead code**,
and speed has its own opcode (`SPEED n`) regardless.

**Open tension.** The app source says the second byte is a direction flag, which
conflicts with the hypothesis that it is a content-slot index. But cycling
`MODE 01 <n>` for n = 0..7 was observed to produce different displays on hardware.
Both can hold if the firmware interprets the byte more liberally than the app uses
it. The app only ever sends 0 or 1, so anything richer is firmware behaviour the app
does not exercise.

### IMAG and ANIM ranges

- **`IMAG 0` to `IMAG 10`**, eleven built-in images.
- **`ANIM 20` to `ANIM 29`**, ten built-in animations. The app adds a hardcoded
  offset of 20, suggesting indices 0 to 19 are reserved in a unified index space.
- Both banks are **read-only built-ins**. No code path writes to a bank index. The
  Java `ImageData`/`AnimData` arrays are app-side preview thumbnails rendered
  locally, never uploaded, and there are no bank blobs in the APK assets. The real
  bank content is firmware-resident.

### Opcodes absent from notes/protocol.md

From the app's `Command.java`, defined but unused, so presumably firmware-supported:
**`COLR`** (colour, length 8), **`LEVL`** (level, length 6), **`POWR`** (power,
length 5).

### Dead code in this build

Defined in the library with zero callers: `SMVEW 02`, `STYPE` and its reply parser,
`LEDFIRST`/`LEDSECOND`, the `MODE 03`/`04` count form, `MODE 07`, `MODE 08`/`09`,
`MODE 02 hi lo` flashing, `EVERT`, `LIGHTON`/`LIGHTOFF`, `LEDON`/`LEDOFF`, `STOPR`,
`CALL`, `SCHD` and `STSC`.

Actually emitted by the app: `SMVEW 01`/`03`/`00`, `MODE <i> <i2>`, `ANIM 20-29`,
`LOOA`, `IMAG 0-10`, `SPEED n`, `LIGHT n`, `SOUT`, plus the `DATS`/`DATCP` handshake
and the two bulk streams.

**Dead in the app does not mean absent from the firmware.** Hardware testing already
showed `SMVEW 02` works, so this is a menu of things to try, not a list to discount.

## What the app reads back

Only three notify replies are ever parsed, and all three belong to the `DATS`
handshake: `DATSOK`, `DATCPOK`, `ERROR`. Nothing else on `...9601` is interpreted.

Consequence for the `STYPE` question: the app **never asks the device for its
geometry**. Its `parseType` only knows 5x36, 12x48, 14x56 and 16x64, none of which
match our 9x24 panel. There is no alternative geometry query hiding in the app, so
empirical mapping remains the only route.

## Hard limits, with sources

- **Text input:** 40 half-width units, an app-side UI cap. CJK counts as 2.
- **`DATS` length field:** 16-bit, so 65535 bytes maximum announced.
- **Flash buffer for saved content:** `0x600` bytes at `abs 0x3c000`.
- **DIY image:** fixed 72 bytes, 24 columns by 3 bytes, from a 24 by 9 canvas.
- **Glyph rasterisation:** the app rasterises text itself at 12 by 12 using bundled
  TTFs (`assets/fonts/typeface1456.ttf`, 18.6 MB) plus a hardcoded glyph table. It
  does **not** rely on a device font. The firmware does carry a small 5-row glyph
  strip and a "Cool" bitmap for its own built-in content, so both exist and serve
  different purposes.
- **Bulk chunking:** 15 data bytes per 16-byte block, consistent with the
  one-block-per-write rule.
- **Rhythm mode:** 16-byte frames `[15][subchannel][12 bytes]` streamed on
  `...960b`, not persistent. Twenty mode constants exist, `MODE_RED_GRADUAL` to
  `MODE_WHITE_FLASH`.
- No max-frames or max-animation-length constant exists, because animations are
  firmware built-ins rather than uploads.

## What this means for the rendering complaint

Better rendering does not need a firmware flash. The device is not a dumb frame
buffer: it accepts a wide buffer through a verified handshake, stores it in 1.5 KB of
flash, and animates it unattended.

The vendor app's limits (40 characters, 24-column images, one buffer per type,
phone-side rasterisation at 12 pixels) are app limits sitting on top of a protocol
that is demonstrably more capable.

Highest-value next steps, none of which risk the hardware:

1. Implement `DATS`/`DATCP` for type 1 and drive it with our own rasteriser, which
   already produces better output than a 12-pixel TTF render for a 6-row band.
2. Test `DATS` type 2 with a buffer wider than 72 bytes.
3. Sweep the `MODE` second byte, and the `COLR`/`LEVL`/`POWR` opcodes the app never
   touches.
