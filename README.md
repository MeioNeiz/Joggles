# Joggles

Reverse engineering the BLE protocol of app-controlled LED glasses (vendor app:
Funky Glasses+, `com.pinkysinyeeho.funkyglassesplus`) so they can be driven from
our own code.

End goal: a Web Bluetooth app, written on the laptop, run from Chrome on Android.

Findings live in `notes/protocol.md`.

## Setup

    python3 -m venv .venv
    .venv/bin/pip install bleak pycryptodome

Also needs `adb` and `jadx` (`brew install android-platform-tools jadx`).

### macOS Bluetooth permission

BLE from Python requires the *terminal app* to hold Bluetooth permission.
Without it the process dies with SIGABRT (exit 134) and no message.

System Settings > Privacy & Security > Bluetooth > enable your terminal.

## Tools

| Tool | Purpose |
| --- | --- |
| `tools/scan.py [secs]` | Find the glasses. Looks for `GLASSES-*` and the fff0 service. |
| `tools/enumerate.py <addr>` | Dump the full GATT tree, flag writable characteristics. |
| `tools/probe.py <addr> [uuid]` | Interactive: send hex, watch notify traffic. |
| `tools/android_pull.sh [pkg]` | List installed packages / pull the vendor APK. |
| `tools/decompile.sh <pkg>` | jadx decompile + grep for UUIDs and frame builders. |
| `tools/crack_aes.py` | Test candidate AES keys against captured frames. |

## Method

1. **Scan** for the device, confirm the advertised name and service UUID.
2. **Enumerate** GATT to find the write and notify characteristics.
3. **Decompile the APK** - the protocol, including any hardcoded crypto key, is
   written in the app's own source. This is far faster than black-box guessing.
4. **Capture ground truth** with an Android Bluetooth HCI snoop log: drive the
   real app, then read the exact bytes in Wireshark.
5. **Replay** captured frames from `probe.py` to confirm understanding.
6. **Build** the Web Bluetooth app once frames are reproducible.

### Important BLE constraint

BLE allows **one connection at a time**. While the phone app holds the glasses,
the Mac cannot connect. Force-close the vendor app (or turn off phone Bluetooth)
before scanning from the laptop.

These glasses will most likely never appear in macOS Bluetooth settings. That is
normal and not a problem - BLE GATT devices are connected to programmatically,
not paired like headphones.

## Prior art

- [jrd3n/ble_hacks](https://github.com/jrd3n/ble_hacks) - partial capture of this
  exact device, mirrored in `reference/ble_hacks/`.
- [gsuberland/ChemionHacking](https://github.com/gsuberland/ChemionHacking) -
  same class of hardware, useful for frame-format patterns.
