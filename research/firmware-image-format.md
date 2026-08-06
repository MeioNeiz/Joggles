# TR1906R04 firmware: OTA container, internals, and flashing risk

**Status: container format solved and verified.** Both stock images decode to ARM
Cortex-M firmware and re-encode byte-for-byte identically. `research/ota-codec.ts`
reproduces every claim in this section:

    bun research/ota-codec.ts verify firmware/*.bin

## Headline findings

1. **The OTA payload is not encrypted with a bootloader-held key.** It is
   obfuscated with a fixed 128-byte XOR pad derived from a single 32-bit seed.
   Both stock images use the same pad, so it is baked into the bootloader, not
   per-device. This falsifies the "encrypted with a key we don't have" note in
   `CLAUDE.md`.
2. **The header CRC-32 is computed over the deobfuscated body.** So a modified
   image can be made to pass the device's integrity check.
3. **There is no signature check anywhere in the flash path**, and no hardware or
   model ID gate on the device side.
4. Therefore custom firmware is **technically feasible**. Whether it is *safe* is
   a separate question, and the answer today is **no**: we have never seen the
   bootloader, so no recovery path is verified. See "Flashing risk" below.

## Container format

16-byte header, little-endian. Field names taken from the vendor app's
`FileInfo`/`VersionInfo` parser, so these are the vendor's own semantics.

| Offset | Size | Field | Notes |
| --- | --- | --- | --- |
| 0 | 4 | `codeSize` | body length, always file length minus 16 |
| 4 | 4 | `crc32` | CRC-32 of the **deobfuscated** body |
| 8 | 2 | `appVer` | application version |
| 10 | 2 | `devVer` | device version |
| 12 | 2 | `proVer` | protocol version |
| 14 | 1 | `type` | image type/bank selector, `0x01` in both stock images |
| 15 | 1 | unused | |

CRC-32 is the standard one: polynomial `0xedb88320`, init and final xor
`0xffffffff`.

Stock images:

| File | codeSize | crc32 | app | dev | pro | type |
| --- | --- | --- | --- | --- | --- | --- |
| `TR1906R04-1-10_OTA.bin` | 65824 | `0x48a889e3` | 1 | 10 | 10 | 1 |
| `TR1906R04-10_OTA.bin` | 66084 | `0x04acebff` | 3 | 10 | 10 | 1 |

The two files are the same firmware at two versions. Their bodies are identical
from offset 0x2 to 0x146b, then diverge permanently because the newer image is
260 bytes larger and everything after the insertion shifts.

The images in `firmware/` are byte-identical to `assets/TR1906R04-*_OTA.bin`
inside the APK. There is no download path: the app ships its firmware.

## The obfuscation

The pad is 128 bytes. Read it as 32 big-endian 32-bit words, where

    word[n] = rotr32(0x37627996, n)      for n = 0..31

and apply `body[i] ^= pad[i % 128]`. Thirty-two single-bit rotations return to
the seed, which is why the pad repeats every 128 bytes. XOR is an involution, so
the same routine obfuscates and deobfuscates.

### How it was found

Whole-body entropy is 7.83 bits/byte, which looks like real encryption and is
presumably why it was written off previously. The giveaway is in the
autocorrelation instead:

- byte match at lag 128 is **10.4%**, about 26 times the 0.39% chance rate
- a secondary spike at lag 33

Lag 33 is the signature of a per-word one-bit rotation: eight words of one-bit
rotation equals exactly one byte of shift, so `pad[i + 33] == pad[i]` for most
`i`. That fixes the generator shape. Brute-forcing the remaining unknowns (32
phases, two byte orders, two polarities) against a printable-ASCII-run oracle
left exactly one candidate. Entropy falls to 6.45 bits/byte and ARM Thumb code
appears at the top of the body. The high entropy of the obfuscated form is
explained by the pad giving each of the 128 byte positions its own permutation,
which flattens the histogram without adding real entropy.

### Verification

Three independent checks, both images:

1. For all 128 pad positions, the modal plaintext byte is `0x00` (zero-fill
   dominates a firmware image, so a wrong pad byte would show up immediately).
2. The header CRC-32 equals CRC-32 of the deobfuscated body. Cipher-side CRC does
   not match, so this is not a coincidence of framing.
3. Re-encoding the plaintext reproduces the original file byte for byte.

The app streams the stored, still-obfuscated body verbatim and forwards the
stored CRC unchanged (it computes nothing itself). Since the device accepts that
CRC, **the device must deobfuscate before verifying.** That is what proves the
pad lives in the bootloader.

### Building a valid image

Modify the plaintext, then set `codeSize` to its length, set `crc32` to
`CRC32(plaintext)`, XOR with the pad, and keep or bump the version fields.
`encode()` in `research/ota-codec.ts` does exactly this.

## What is inside the firmware

Offsets below are into the **deobfuscated body** of `TR1906R04-10_OTA.bin`.

- **Core:** ARM Cortex-M0, Thumb-only (`MSR MSP`, `MOV sp`, `PUSH {..., lr}`
  prologues). Definitely **not** a Telink TC32 part.
- **SoC: Panchip PAN1020 class**, high confidence but the die marking is
  unverified. The register-map literals are Nuvoton NuMicro derived: FMC/ISPCON at
  `0x5000c000`, plus SYS/CLK, GPIO on a `0x40` port stride, timers, ADC and PWM
  windows, and an LDROM window referenced at `0x00101000`. Flash erases land on
  512-byte boundaries (`0x3c000`, `0x3c200`, `0x3c400`, ...), which is Nuvoton FMC
  page granularity. No literal references flash at or above `0x40000`, so it is a
  **256 KB** part. The BLE stack is RivieraWaves/CEVA derived, betrayed by the
  string `gattc_send_svc_changed_cmd_handler`. The vendor's own Android package is
  named `panchip`, which is the decisive corroboration.
- **SRAM:** 16 KB at `0x20000000`. Initial SP `0x20003910`, and `0x20003ffc`
  appears as a literal, consistent with a top-of-RAM at `0x20004000`.
- **Startup stub** at body `0x10`: loads SP from a literal, then `BX` to
  `0x1f86c`.
- **Clock:** `0x018cba80` = 26,000,000 in the tail config block, so a 26 MHz
  crystal.
- **GATT table** at `0xc1e8` to `0xc348`: the four 128-bit characteristics
  (`...9600`, `...960a`, `...960b`, `...9601`) stored in BLE byte order, the
  `0xfee9` service at `0xc2f8`, and then `0x2800`/`0x2803`/`0x2902` declarations
  with **`0xfd01` at `0xc32c` and `0xfd02` at `0xc33c`**.
- **AES-128 key in plaintext** at `0xc394`: `34522a5b7a6e492c08090a9d8d2a23f8`,
  immediately followed by the AES S-box at `0xc3a4`. This is the same key that
  was previously brute-forced out of `libAES.so`, so the firmware and app share
  one hardcoded key.
- **Protocol reply strings** at `0x1dbc`: `DATSOK`, `DATCPOK`, `ERROR00`. These
  are stored as strings because they are transmitted. Command opcodes
  (`SMVEW`, `IMAG`, `MODE`, ...) appear nowhere as ASCII, not even as 4-character
  fragments, so the dispatcher compares them as immediates.
- **Other strings:** `GLASSES-` (the advertised name prefix), the version string
  (`TR1906R04-10`, and `TR1906R04-01-10` in the older image), `Client To Server`,
  and a debug hard-fault handler with an `r0 = 0x%x` style register dump.
- **Bitmap content:** a 5-row glyph strip at `0x10137`, and at `0x101c4` a
  7-row bitmap stored as 16-bit columns that decodes to the word **"Cool"**,
  which is presumably factory default content.

Content classification of the body: roughly 47 KB of contiguous code from
`0x200`, then alternating code and small-value tables to the end, with 18.9%
zero-fill overall. There are no large bitmap banks, so the built-in `IMAG`/`ANIM`
banks are either compact or stored outside this image.

### Flash layout (partly inferred, flagged)

**Probable load base `0x1f100`.** Three independent consistencies support it: a
stored pointer resolves to the version string, another to `Client To Server`, and
the startup stub's `BX` target `0x1f86c` lands at body offset `0x76c`. Under that
base, 143 stored words resolve to in-image addresses.

Unresolved caveat: the word at body `0x0c` is `0x00016a01`, which has the shape
of a Thumb reset vector but points *below* the probable base. Either it is not a
reset vector, or the base is wrong. Do not treat the base as settled.

If the base is right, roughly **124 KB of flash sits below the application** and
is never transmitted during an OTA. That region must hold the bootloader, and
plausibly a resident BLE controller too, which would explain its size. Repeated
4K-aligned constants at `0x30000`, `0x3c000` and `0x3f000` hint at a data or NVM
region above the application in a 256 KB flash, but the evidence is weak and
these could be arithmetic constants.

## OTA transport protocol

Panchip-style, driven entirely by the application firmware over service `0xfd00`:
`fd01` = data, `fd02` = control with notifications, CCCD `0x2902` on `fd02`.

Control opcodes are `1` version, `2` size, `3` crc, `4` reset. Replies are
prefixed `0x80`. Sequence:

1. MTU request 203, giving a 200-byte packet size.
2. Enable notifications on `fd02`.
3. Write opcode 1. Device replies `0x80 01` plus six version bytes.
4. Write opcode 2 as `[02][type][codeSize x4]`. Device replies `0x80 02 <status>`;
   non-zero aborts.
5. Stream the body over `fd01` as `[index_lo][index_hi][up to 198 bytes]`, with a
   16-bit little-endian packet counter. **The 16-byte file header is never sent.**
   Every packet is acknowledged with `0x80 04`, so this is stop-and-wait with the
   device pacing the transfer.
6. Write opcode 3 as `[03][crc32 x4]`, with a 20 second timeout. Device replies
   `0x80 03 <status>`.
7. On success the device activates and reboots by itself. Opcode 4 (reset) exists
   in the app but is **never sent**.

There is no erase command from the app, no resume logic (a retry restarts from
the beginning), and no signature verification. The OTA channel is also the one
place the app deliberately **bypasses AES**: it writes raw bytes, and routes
notifications from `fd01`/`fd02` around the decrypt step.

The app's only gate is client-side: it reads a plaintext version string, splits on
`-`, and offers an update only when the major field is under 10. Our unit reports
`TR1906R04-10`, so **the vendor app will never offer it an OTA**. The library's
own downgrade and same-version checks are dead code.

## Flashing risk

The reason to be careful is not the image format, which is fully solved. It is
that **we have never seen the bootloader.**

What is in our favour:

- Writes go *upward* from the application base, and the bootloader sits *below*
  it, so even an oversized or malformed image cannot reach the bootloader by
  overrunning.
- The device verifies a CRC over the whole body before activating, so a truncated
  or corrupted transfer should be rejected rather than run.
- The transfer is device-acked packet by packet, so the bootloader is the pacing
  authority and can detect gaps through the 16-bit sequence index.

What is against it, and why this still counts as risky:

- **The OTA service is implemented by the application image**, not only by the
  bootloader: `fd01` and `fd02` are in the application's own GATT table. If the
  bootloader does not independently advertise and accept OTA when the application
  is invalid, then a bad application image means no BLE, and therefore no way
  back over the air.
- **We cannot check whether the bootloader validates the application at boot.**
  The CRC is delivered in a control packet rather than embedded in the body, so
  whether it is retained for a boot-time check is unknown.
- **The vendor app is not a recovery route** for our unit, because of the
  major-version-under-10 gate described above. Our own code could still drive the
  OTA sequence, but only while the device runs enough firmware to answer.
- **No hardware recovery path is known.** No SWD or single-wire debug pad map, no
  UART, no confirmed programmer for this part.

### Recommended order of work

1. **Do not flash anything yet.** Nothing about better rendering requires it: see
   `research/vendor-app-protocol.md`, the device already accepts buffers far wider
   than the panel and animates them unattended.
2. If firmware freedom is genuinely wanted, **establish recovery first**: identify
   the SoC, find the debug pads, and dump the bootloader. Reading it out would
   settle the boot-time validation and OTA-fallback questions before anything is
   risked, and a full flash dump is itself a restore image.
3. Only then consider flashing, and rehearse with a stock image that matches the
   device's current version so that a success is a no-op.

### Safe versus unsafe probes

- **Safe:** anything on the `0xfee9` display service. No flash writes are
  involved and the worst case is a garbled panel, fixed by redrawing or by
  `SMVEW 00`.
- **Low risk but pointless on its own:** OTA opcode 1 (version query). It only
  reads, though it does put the device into an OTA-expectant state, and the
  vendor app proceeds straight to flashing afterwards.
- **Do not send OTA opcode 2 (size) unless committed to completing a correct
  transfer.** That is the point at which the device most plausibly erases.
