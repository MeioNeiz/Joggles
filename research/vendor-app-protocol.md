# Saved content, wide buffers, and the opcode inventory

Recovered by reading the decompiled vendor app end to end, so everything here is
what the app **actually emits**, distinguished throughout from what its library
merely defines. This closes several open questions in `notes/protocol.md` and
corrects two entries in the command table.

## Headline findings

1. **`SMVEW 02` is dead code in the vendor app.** It has zero callers. The app's
   persist-to-device path is a previously undocumented **`DATS`/`DATCP`
   length-prefixed bulk handshake**. (The device clearly still honours `SMVEW 02`,
   as hardware testing showed, so this is a gap in the app, not in the firmware.)
2. **The device already buffers and scrolls content far wider than the panel, and
   this is proven, not inferred.** The text path uploads one variable-length
   buffer of up to about 200 columns and then issues a single `MODE` command. It
   never streams frames.
3. **`MODE`'s second byte is a direction flag in the app, not a slot index.** See
   the correction below, which conflicts with the current hypothesis in
   `notes/protocol.md`.
4. **There is no slot index in the protocol as the app uses it.** The upload
   handshake carries a one-byte content *type* and a 16-bit length, nothing more.

## The `DATS`/`DATCP` upload handshake

This is the real "save to device" mechanism, and it is missing from
`notes/protocol.md` entirely.

| Step | Direction | Frame and channel |
| --- | --- | --- |
| 1 | app to device | `DATS <type> <len_hi> <len_lo>`, frame `07 44 41 54 53 tt hh ll`, on `...9600` |
| 2 | device to app | notify `DATSOK` on `...9601` |
| 3 | app to device | stream `len` bytes on `...960a` as count-prefixed 16-byte blocks: `[count][up to 15 data bytes]` |
| 4 | app to device | `DATCP`, frame `05 44 41 54 43 50`, on `...9600` |
| 5 | device to app | notify `DATCPOK` on success, or `ERROR` on failure |

`type` is `1` for the text buffer and `2` for a DIY image. Those are the only two
values that exist in the app. The length is 16-bit, so up to 65535 bytes may be
announced. Inter-block pacing is 50 ms for text and 60 ms for images.

All three reply strings are present verbatim in the firmware image (`DATSOK`,
`DATCPOK`, `ERROR00` at body offset `0x1dbc`), which independently confirms this
handshake is firmware-side and not an app-only abstraction.

`DATCPOK` is the device confirming it has stored and verified the buffer. There is
no slot argument anywhere: one saved buffer per type.

## Channel routing

This resolves the "which bulk characteristic is live" open question.

| Characteristic | Role |
| --- | --- |
| `...9600` | commands, including `DATS` and `DATCP` |
| `...9601` | notify, device replies |
| `...960a` | **`DATS` bulk stream**, count-prefixed blocks |
| `...960b` | **live/real-time channel**: per-column DIY writes and rhythm frames |

So the `[04][column][3 bytes]` format already in `notes/protocol.md` is the
**live** channel format on `...960b`, and it is a different encoding from the
`DATS` stream on `...960a`.

There are three distinct pixel encodings in play, which is worth keeping straight:

- **live column** on `...960b`: `[04][column index][3 bytes]`, two bits per pixel
- **`DATS` type 1 (text)**: flat concatenation of **2-byte columns**, one bit per
  pixel, 16 rows tall
- **`DATS` type 2 (DIY image)**: exactly 72 bytes, 24 columns of 3 bytes, two bits
  per pixel

DIY mode is not required for `DATS` uploads. The text path never enters DIY: it
uploads, then sends `MODE`. Only the live drawing editor uses `SMVEW 01`/`03`.

## Wide buffers are real

The scrolling-text path is the proof:

- Glyphs are emitted as runs of 2-byte columns and concatenated into one flat
  buffer with no truncation to 24 columns.
- That whole buffer goes up in a single `DATS 01 <len>` handshake, where the
  length field *is* the width parameter.
- Only afterwards does the app send one `MODE` command, once.

Input is capped at 40 half-width characters by the app's own text field, which at
roughly 5 columns per character is about **200 columns, or 8 times the panel
width**, in around 400 bytes. That is comfortably inside the 16-bit length field,
so the app's 40-character cap is a UI limit and not a protocol or firmware limit.

The 24-column ceiling on DIY images comes from the drawing canvas being
initialised at 24 by 9, not from the protocol. The live column frame carries a
full byte of column index.

### The one experiment worth running

Upload a **wide custom bitmap via `DATS` type 2 with a length greater than 72
bytes**, then drive it with `MODE`, and watch `...9601` for `DATCPOK` versus
`ERROR`. The mechanism (type byte, arbitrary 16-bit length, device-side `MODE`
animation) is shared with the text path that demonstrably handles wide buffers, so
this is the natural test of whether saved *image* content is width-extendable the
way saved *text* content provably is.

This is also a genuine request/response probe, which matters because our unit
never answers `STYPE`: the handshake gives a definite yes or no on the wire.

## Corrections to the command table

### `MODE` arguments

The live scroll commands come from `getContentCommand(i, i2)`, frame
`06 4d 4f 44 45 <i> <i2>`, and it is called only from the text screen with:

- `MODE 01 00` static
- `MODE 02 <dir>` horizontal scroll
- `MODE 03 <dir>` vertical scroll

where `<dir>` is 0 or 1. The `getRollToLeftCommand`/`getRollToRightCommand`
variants that produced the "`MODE 03 n` = scroll left at speed n" reading in
`notes/protocol.md` are **dead code with zero callers**, and speed has its own
opcode (`SPEED n`) regardless.

**Open tension worth resolving on hardware.** The app source says the second byte
is a direction flag, which contradicts the working hypothesis in
`notes/protocol.md` that it is a content-slot index. But cycling `MODE 01 <n>` for
n = 0..7 was observed to produce different displays. Both observations can be
true if the firmware interprets the second byte more liberally than the app uses
it. The captured HCI log in `captures/` will settle what the app really sends;
note that the app only ever sends 0 or 1 there, so anything richer is firmware
behaviour the app does not exercise.

### `IMAG` and `ANIM` ranges

- **`IMAG 0` to `IMAG 10`**, eleven built-in images.
- **`ANIM 20` to `ANIM 29`**, ten built-in animations. The app adds a hardcoded
  offset of 20, which suggests indices 0 to 19 are reserved in a unified index
  space in the firmware.
- Both banks are **read-only built-ins**. No code path writes to a bank index. The
  Java `ImageData`/`AnimData` arrays are app-side preview thumbnails, rendered
  locally and never uploaded. The real bank content is firmware-resident, and
  there are no bank blobs in the APK assets.

### Opcodes absent from `notes/protocol.md`

From the app's `Command.java`, defined but currently unused, so presumably
firmware-supported: **`COLR`** (colour, length 8), **`LEVL`** (level, length 6),
**`POWR`** (power, length 5).

### Dead code in this build

Defined in the library with zero callers anywhere: `SMVEW 02`, `STYPE` and its
reply parser, `LEDFIRST`/`LEDSECOND`, the `MODE 03`/`04` count form, `MODE 07`,
`MODE 08`/`09`, `MODE 02 hi lo` flashing, `EVERT`, `LIGHTON`/`LIGHTOFF`,
`LEDON`/`LEDOFF`, `STOPR`, `CALL`, `SCHD` and `STSC`.

Actually emitted by the app: `SMVEW 01`/`03`/`00`, `MODE <i> <i2>`, `ANIM 20-29`,
`LOOA`, `IMAG 0-10`, `SPEED n`, `LIGHT n`, `SOUT`, plus the `DATS`/`DATCP`
handshake and the two bulk streams.

Dead in the app does not mean absent from the firmware. Hardware testing already
showed `SMVEW 02` works, so this list is a menu of things to try, not a list of
things to discount.

## Everything the app reads back

Only three notify replies are ever parsed, and all three belong to the `DATS`
handshake: `DATSOK`, `DATCPOK`, `ERROR`. Nothing else on `...9601` is interpreted.

Consequence for the `STYPE` open question: the app **never asks the device for its
geometry**. Its `parseType` only knows 5x36, 12x48, 14x56 and 16x64, none of which
match our 9x24 panel. So there is no alternative geometry query hiding in the app,
and empirical mapping remains the only route.

## Hard limits, with sources

- **Text input:** 40 half-width units, app-side UI cap. CJK counts as 2.
- **`DATS` length field:** 16-bit, so 65535 bytes maximum announced.
- **DIY image:** fixed 72 bytes, 24 columns by 3 bytes, from a 24 by 9 canvas.
- **Glyph rasterisation:** the app rasterises text itself at 12 by 12 using
  bundled TTFs (`assets/fonts/typeface1456.ttf`, 18.6 MB) with a hardcoded glyph
  table for common characters. It does **not** rely on a device font. The firmware
  does carry a small 5-row glyph strip and a "Cool" bitmap for its own built-in
  content, so both exist, serving different purposes.
- **Bulk chunking:** 15 data bytes per 16-byte block, consistent with the
  established one-block-per-write rule.
- **Rhythm mode:** 16-byte frames `[15][subchannel][12 bytes]` streamed on
  `...960b`, not persistent. Twenty mode constants exist, from `MODE_RED_GRADUAL`
  to `MODE_WHITE_FLASH`.
- No max-frames or max-animation-length constant exists, because animations are
  firmware built-ins rather than uploads.

## What this means for the rendering complaint

Better rendering does not need a firmware flash. The device is not a dumb frame
buffer: it accepts a wide buffer through a verified handshake, stores it, and
animates it unattended. The vendor app's limits (40 characters, 24-column images,
one buffer per type, phone-side rasterisation at 12 pixels) are app limits sitting
on top of a protocol that is demonstrably more capable.

The highest-value next steps, none of which risk the hardware:

1. Implement `DATS`/`DATCP` for type 1 and drive it with our own rasteriser, which
   already produces better output than a 12-pixel TTF render for a 6-row band.
2. Test `DATS` type 2 with a buffer wider than 72 bytes, as described above.
3. Sweep the `MODE` second byte and the `COLR`/`LEVL`/`POWR` opcodes, which the
   app never touches.
