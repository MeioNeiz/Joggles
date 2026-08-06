# Funky Glasses+ BLE protocol - findings log

Running record of what we know. Append as we learn; mark guesses as guesses.

## Device

| Field | Value | Confidence |
| --- | --- | --- |
| Product | Bluetooth LED Glasses | confirmed |
| Vendor app (Android) | `com.pinkysinyeeho.funkyglassesplus` | confirmed |
| Vendor app (iOS) | Funky Glasses, App Store id `1481682053` | confirmed |
| BLE advertised name | `GLASSES-{MAC}` | third-party report |
| Transport | BLE GATT, no pairing/bonding | inferred |

## GATT layout

From [jrd3n/ble_hacks](https://github.com/jrd3n/ble_hacks) - third-party capture,
not yet verified against our unit.

| UUID | Role | Confidence |
| --- | --- | --- |
| `0000fff0-0000-1000-8000-00805f9b34fb` | advertised service | reported |
| `d44bc439-abfd-45a2-b575-925416129600` | command write (their "handle 12") | reported |
| `d44bc439-abfd-45a2-b575-92541612960b` | bulk data write (their "handle 18") | reported |

The `d44bc439-abfd-45a2-b575-9254161296xx` family is shared across a generation
of cheap BLE LED display gear (Shining Mask, LED badges, these glasses). In that
family the layout is usually:

- `...9600` command channel, 16-byte AES-128-ECB blocks
- `...9601` notify channel, device responses
- `...960a` / `...960b` bulk bitmap upload, often plaintext

## Captured frames

`reference/ble_hacks/data.csv` - 9 rows x 24 cells, each cell a 16-byte hex
block. Shape suggests one display frame, but the row/column meaning is unproven.

Clear-screen / init command sent to `...9600`:

    3b3eb0f5954bdabde610174b52bfcecb

## Encryption

**Open question.** The 16-byte block size and high entropy point at AES-128-ECB,
matching the Shining Mask family.

Tested and **ruled out**: the published Shining Mask key
`32672f7974ad43451d9c6c894a0e8764`. Decrypting the clear-screen command with it
yields `bfd4ddcb6fc6ea54446710a638e2da3a` - 38% printable, no length-prefix
structure, i.e. still noise. Same for the data.csv blocks.

So it is one of:
1. AES-128-ECB with a different hardcoded key -> recover from the APK
2. A different cipher or a simple obfuscation/XOR scheme
3. Not encrypted at all, just a dense binary framing we have not decoded

Resolving this is the single highest-value next step, and the APK decompile
answers it directly: these apps hardcode the key as a string or byte array.

Grep targets once decompiled:

    AES / SecretKeySpec / Cipher.getInstance / ECB / NoPadding
    32-hex-char string literals
    byte[] initialisers near writeCharacteristic calls

## Display geometry

Unknown. Need to establish: pixel width x height, colour depth (mono? RGB?),
scan order (row-major? column-major? serpentine?).

Fastest way to determine: send a single lit pixel and watch where it lands.

## Open questions

- [ ] Real GATT tree on our unit (run `tools/enumerate.py`)
- [ ] Encryption scheme and key
- [ ] Frame format: header, opcode, length, checksum
- [ ] Display geometry and scan order
- [ ] Does it need a handshake/auth before accepting frames?
- [ ] Text rendering: does the device have a font, or does the app send bitmaps?
