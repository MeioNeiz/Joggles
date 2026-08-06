#!/usr/bin/env python3
"""Test whether captured frames are AES-128-ECB with the known Shining-Mask key.

The d44bc439-abfd-45a2-b575-9254161296xx UUID family is shared across a whole
generation of cheap BLE LED display gear (masks, glasses, badges). That line
encrypts its *command* channel with a hardcoded AES-128-ECB key, while bulk
bitmap data goes to a second characteristic in the clear.
"""
from Crypto.Cipher import AES

# Hardcoded key recovered from the Shining Mask app family.
KEYS = {
    "shining-mask": bytes.fromhex("32672f7974ad43451d9c6c894a0e8764"),
}

CLEAR_CMD = bytes.fromhex("3b3eb0f5954bdabde610174b52bfcecb")


def printable_score(b: bytes) -> float:
    """Fraction of bytes that are plausible ASCII command text."""
    good = sum(1 for c in b if 0x20 <= c < 0x7F or c == 0)
    return good / len(b)


def try_decrypt(name: str, key: bytes, blob: bytes) -> None:
    cipher = AES.new(key, AES.MODE_ECB)
    out = cipher.decrypt(blob)
    score = printable_score(out)
    ascii_view = "".join(chr(c) if 0x20 <= c < 0x7F else "." for c in out)
    print(f"  key={name}")
    print(f"    hex   {out.hex(' ')}")
    print(f"    ascii {ascii_view!r}")
    print(f"    printable score {score:.0%}")
    if score > 0.6:
        print("    *** LOOKS LIKE PLAINTEXT ***")
    # Shining-mask framing: first byte = payload length, then ASCII opcode.
    if 0 < out[0] <= 15:
        opcode = out[1:1 + out[0]]
        guess = "".join(chr(c) if 0x20 <= c < 0x7F else "." for c in opcode)
        print(f"    len-prefix guess: len={out[0]} opcode={guess!r}")


def main() -> None:
    print("=== The 'clear screen' command from the reference capture ===")
    print(f"ciphertext: {CLEAR_CMD.hex(' ')}\n")
    for name, key in KEYS.items():
        try_decrypt(name, key, CLEAR_CMD)

    print("\n=== First blocks of the captured data.csv frame ===")
    import csv
    import pathlib

    path = pathlib.Path(__file__).parent.parent / "reference/ble_hacks/data.csv"
    with path.open() as fh:
        rows = [r for r in csv.reader(fh) if r]

    for name, key in KEYS.items():
        cipher = AES.new(key, AES.MODE_ECB)
        print(f"\n  key={name}")
        for ri, row in enumerate(rows[:3]):
            for ci, cell in enumerate(row[:4]):
                blob = bytes.fromhex(cell.strip())
                out = cipher.decrypt(blob)
                ascii_view = "".join(
                    chr(c) if 0x20 <= c < 0x7F else "." for c in out
                )
                print(f"    r{ri}c{ci}: {out.hex(' ')}  {ascii_view!r}")


if __name__ == "__main__":
    main()
