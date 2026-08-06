#!/usr/bin/env python3
"""Decrypt the captured bulk-channel frames with the recovered key."""
import csv
import pathlib

from Crypto.Cipher import AES

KEY = bytes.fromhex("34522a5b7a6e492c08090a9d8d2a23f8")
HERE = pathlib.Path(__file__).parent.parent


def ascii_view(b: bytes) -> str:
    return "".join(chr(c) if 0x20 <= c < 0x7F else "." for c in b)


def main() -> None:
    path = HERE / "reference/ble_hacks/data.csv"
    with path.open() as fh:
        rows = [r for r in csv.reader(fh) if r and any(c.strip() for c in r)]

    cipher = AES.new(KEY, AES.MODE_ECB)
    print(f"{len(rows)} rows x {len(rows[0])} blocks\n")

    for ri, row in enumerate(rows):
        print(f"--- row {ri} ---")
        joined = bytearray()
        for cell in row:
            cell = cell.strip()
            if not cell:
                continue
            joined += cipher.decrypt(bytes.fromhex(cell))
        # Show the first blocks decrypted, plus a bit-density readout: for a
        # monochrome matrix, popcount per byte is the pixel data.
        head = bytes(joined[:48])
        print(f"  first 48B: {head.hex(' ')}")
        print(f"  ascii    : {ascii_view(head)!r}")
        ones = sum(bin(b).count('1') for b in joined)
        print(f"  {len(joined)} bytes, {ones} bits set ({ones / (len(joined) * 8):.0%})")


if __name__ == "__main__":
    main()
