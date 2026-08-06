# Funky Glasses+ BLE protocol

**Status: solved.** Both the command and bulk channels are reproduced
byte-for-byte against captured traffic from the real app.

Recovered from the vendor APK `com.pinkysinyeeho.funkyglassesplus` v1.1.8,
pulled from a Pixel 10 Pro and decompiled with jadx. The app is not obfuscated.

## Device

| Field | Value |
| --- | --- |
| Vendor app | `com.pinkysinyeeho.funkyglassesplus` |
| BLE advertised name | `GLASSES-{MAC}` |
| Manufacturer-data signature | `54 52 00 3A` (ASCII `TR\0:`) |
| Transport | BLE GATT, no pairing or bonding |

The app filters scan results on the manufacturer-data signature above, inside
the AD structure of type `0xFF` - see `ble/BleConfig.java`.

## GATT

From `com/cdbwsoft/library/AppConfig.java`.

| UUID | Role |
| --- | --- |
| `0000fee9-0000-1000-8000-00805f9b34fb` | service |
| `d44bc439-abfd-45a2-b575-925416129600` | command write |
| `d44bc439-abfd-45a2-b575-925416129601` | notify (device replies) |
| `d44bc439-abfd-45a2-b575-92541612960a` | bulk pixel upload |
| `d44bc439-abfd-45a2-b575-92541612960b` | bulk pixel upload |
| `00002902-0000-1000-8000-00805f9b34fb` | CCCD, to enable notifications |

## Encryption

**AES-128-ECB**, single hardcoded key, same key on both the command and bulk
channels. Every write is exactly one 16-byte block.

    34522a5b7a6e492c08090a9d8d2a23f8

The key is not a Java string: `csh/tiro/cc/aes.java` is a JNI shim over
`libAES.so`, and `keyExpansionDefault()` loads the constant from the native
image. Recovered by brute-forcing all 13,809 16-byte windows of the 13.8 KB
library against a known ciphertext, using the plaintext framing as the oracle -
exactly one window produced a well-formed frame (`tools/find_key.py`).

The published Shining Mask key `32672f7974ad43451d9c6c894a0e8764` does **not**
work here, despite the shared `d44bc439-...` UUID family.

## Frame format

    [len][opcode ASCII...][args...][zero padding to 16 bytes]

`len` counts opcode plus arguments, excluding padding. Opcodes are uppercase
ASCII, which is what makes a correct decryption self-evident.

Verified end to end: `enter_diy()` encrypts to `3b3eb0f5954bdabde610174b52bfcecb`,
identical to the byte sequence the real app sends.

Note the prior-art capture in `reference/ble_hacks/` labels that frame "clear
screen". It is actually `SMVEW 01` = enter DIY mode.

## Command table

Transcribed from `model/data/Agreement.java`. jadx renders the byte literals as
fastjson2 constant names; resolved values are `D`=68, `G`=71, `H`=72, `M`=77,
`N`=78.

| Command | Frame | Notes |
| --- | --- | --- |
| `STYPE` | `05 STYPE` | query panel size, reply on notify char |
| `SMVEW 01` | `06 SMVEW 01` | enter DIY mode |
| `SMVEW 03` | `06 SMVEW 03` | enter DIY, alternate |
| `SMVEW 02` | `06 SMVEW 02` | exit DIY and save |
| `SMVEW 00` | `06 SMVEW 00` | exit DIY without saving |
| `LIGHT n` | `06 LIGHT n` | brightness |
| `LEDON` / `LEDOFF` | `05` / `06` | panel on/off |
| `LIGHTON` / `LIGHTOFF` | `07` / `08` | flashlight |
| `SPEED n` | `06 SPEED n` | animation speed |
| `EVERT` | `05 EVERT` | invert display |
| `ANIM n` | `05 ANIM n` | built-in animation |
| `LOOA` | `04 LOOA` | loop animations |
| `IMAG n` | `05 IMAG n` | built-in image |
| `MODE 01` | `05 MODE 01` | static |
| `MODE 02 hi lo` | `07 MODE ...` | flashing, 16-bit rate |
| `MODE 03 n` | `06 MODE 03 n` | scroll left |
| `MODE 04 n` | `06 MODE 04 n` | scroll right |
| `MODE 07` | `05 MODE 07` | "RP" mode |
| `MODE 08 n` / `MODE 09 n` | `06` | connect-roll right / left |
| `STOPR` | `05 STOPR` | stop rhythm mode |
| `SOUT` | `04 SOUT` | exit rhythm mode |
| `LEDFIRST` / `LEDSECOND` | `08` / `09` | address lens 1 or 2 |
| `SCHD on h m` | `07 SCHD ...` | scheduled on/off timer |
| `STSC` | `04 STSC` | read timer setting |
| `CALL st t` | `06 CALL ...` | incoming-call display |

## Panel geometry

The device reports its own size. `STYPE` returns an ASCII reply parsed by
`Agreement.parseType()`:

| Reply | Panel |
| --- | --- |
| `STYPE5X36` | 5 x 36 |
| `STYPE12X48` | 12 x 48 |
| `STYPE14X56` | 14 x 56 |
| `STYPE16X64` | 16 x 64 |

Query this first rather than assuming - our unit's size is still unconfirmed.

## Bulk pixel format

One 16-byte block per display column, same encryption:

    [04][column index][3 bytes column bitmap][zero padding]

24 columns per write batch in the reference capture. Three bytes gives 24 bits
of vertical resolution, enough for any of the panel sizes above. Row 6 of the
capture sets 14 consecutive bits, consistent with a 14-row panel.

Verified: `column(0, 030000)` encrypts to `dde2655d6e7a9923a30db0f1f9e97ce4`,
identical to the capture.

## Open questions

- [ ] Our unit's actual panel size (send `STYPE`, read notify)
- [ ] Bit order within the 3-byte column: MSB-first assumed, unverified
- [ ] Which bulk characteristic is live, `...960a` or `...960b`
- [ ] Whether DIY mode must be entered before bulk writes are accepted
- [ ] Text: does the device hold a font, or does the app rasterise and upload?

All of these need the hardware, and are blocked on macOS Bluetooth permission
for the terminal.
