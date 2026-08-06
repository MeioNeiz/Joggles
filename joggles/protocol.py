"""Funky Glasses+ BLE protocol.

Recovered from the vendor APK (com.pinkysinyeeho.funkyglassesplus):
  - command table  -> model/data/Agreement.java
  - GATT UUIDs     -> com/cdbwsoft/library/AppConfig.java
  - AES key        -> constant inside lib/arm64-v8a/libAES.so

Wire format. Every write is a 16-byte AES-128-ECB block:

    [len][opcode ASCII...][args...][zero padding to 16]

`len` counts the opcode bytes plus its arguments, not the padding. Opcodes are
uppercase ASCII, so a correct decryption is obvious on sight - which is exactly
how the key was recovered.
"""
from __future__ import annotations

from Crypto.Cipher import AES

# Advertised service the vendor app filters on.
SERVICE_UUID = "0000fee9-0000-1000-8000-00805f9b34fb"

# Command channel: 16-byte encrypted frames.
CHAR_COMMAND = "d44bc439-abfd-45a2-b575-925416129600"
# Device -> host notifications (STYPE replies land here).
CHAR_NOTIFY = "d44bc439-abfd-45a2-b575-925416129601"
# Bulk pixel upload. Same encryption, one column per block.
CHAR_BULK_A = "d44bc439-abfd-45a2-b575-92541612960a"
CHAR_BULK_B = "d44bc439-abfd-45a2-b575-92541612960b"

# Manufacturer-data signature the app matches on: ASCII "TR\x00:".
BROADCAST_SIGNATURE = bytes([0x54, 0x52, 0x00, 0x3A])

KEY = bytes.fromhex("34522a5b7a6e492c08090a9d8d2a23f8")

BLOCK = 16

# STYPE reply -> (rows, cols). The device reports its own panel size.
PANEL_SIZES = {
    536: (5, 36),
    1248: (12, 48),
    1456: (14, 56),
    1664: (16, 64),
}


def encrypt(block: bytes) -> bytes:
    if len(block) != BLOCK:
        raise ValueError(f"frame must be {BLOCK} bytes, got {len(block)}")
    return AES.new(KEY, AES.MODE_ECB).encrypt(block)


def decrypt(block: bytes) -> bytes:
    return AES.new(KEY, AES.MODE_ECB).decrypt(block)


def frame(opcode: str, *args: int) -> bytes:
    """Build a plaintext 16-byte frame. Encrypt before writing."""
    body = opcode.encode("ascii") + bytes(args)
    if len(body) > BLOCK - 1:
        raise ValueError(f"frame body too long: {len(body)}")
    return bytes([len(body)]) + body.ljust(BLOCK - 1, b"\x00")


def parse_type(plaintext: bytes) -> tuple[int, int] | None:
    """Decode a STYPE reply into (rows, cols)."""
    n = plaintext[0]
    body = plaintext[1:1 + n].decode("ascii", "replace")
    if not body.startswith("STYPE"):
        return None
    dims = body[5:]
    if "X" not in dims:
        return None
    rows, _, cols = dims.partition("X")
    try:
        return int(rows), int(cols)
    except ValueError:
        return None


# --- Command table, transcribed from Agreement.java -----------------------

def enter_diy() -> bytes:
    """Enter DIY drawing mode. Send before uploading pixels."""
    return frame("SMVEW", 1)


def enter_diy_alt() -> bytes:
    return frame("SMVEW", 3)


def exit_diy(save: bool = False) -> bytes:
    return frame("SMVEW", 2 if save else 0)


def query_type() -> bytes:
    """Ask the panel to report its dimensions. Reply arrives on CHAR_NOTIFY."""
    return frame("STYPE")


def brightness(level: int) -> bytes:
    return frame("LIGHT", level)


def leds(on: bool) -> bytes:
    return frame("LEDON") if on else frame("LEDOFF")


def flashlight(on: bool) -> bytes:
    return frame("LIGHTON") if on else frame("LIGHTOFF")


def speed(value: int) -> bytes:
    return frame("SPEED", value)


def invert() -> bytes:
    return frame("EVERT")


def animation(index: int) -> bytes:
    return frame("ANIM", index)


def animation_loop() -> bytes:
    return frame("LOOA")


def image(index: int) -> bytes:
    return frame("IMAG", index)


def mode(a: int, b: int = 0) -> bytes:
    """Display mode. Known variants below use specific (a, b) pairs."""
    return frame("MODE", a, b)


def mode_static() -> bytes:
    return frame("MODE", 1)


def mode_flash(rate: int) -> bytes:
    return frame("MODE", 2, rate // 256, rate % 256)


def mode_scroll_left(speed_: int) -> bytes:
    return frame("MODE", 3, speed_)


def mode_scroll_right(speed_: int) -> bytes:
    return frame("MODE", 4, speed_)


def stop_rhythm() -> bytes:
    return frame("STOPR")


def exit_rhythm() -> bytes:
    return frame("SOUT")


def select_lens(which: int) -> bytes:
    """Address one lens: 1 = first, 2 = second."""
    if which == 1:
        return frame("LEDFIRST")
    if which == 2:
        return frame("LEDSECOND")
    raise ValueError("lens must be 1 or 2")


def column(index: int, bitmap: bytes) -> bytes:
    """One display column: [04][index][3 bytes of column bitmap].

    Bit order is not yet confirmed against hardware - see notes/protocol.md.
    """
    if len(bitmap) != 3:
        raise ValueError("column bitmap must be 3 bytes")
    return frame("", *([index] + list(bitmap)))


def columns_from_bitmap(pixels: list[list[int]]) -> list[bytes]:
    """Encode a [rows][cols] 0/1 matrix into per-column frames."""
    if not pixels:
        return []
    rows, cols = len(pixels), len(pixels[0])
    if rows > 24:
        raise ValueError("more than 24 rows does not fit 3 bytes per column")
    out = []
    for c in range(cols):
        bits = 0
        for r in range(rows):
            if pixels[r][c]:
                bits |= 1 << (23 - r)
        out.append(column(c, bits.to_bytes(3, "big")))
    return out
