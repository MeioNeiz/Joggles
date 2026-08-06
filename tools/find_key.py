#!/usr/bin/env python3
"""Recover the AES key by brute-forcing 16-byte windows of libAES.so.

The key is a constant inside the native library, reached through a GOT pointer,
so it is somewhere in the file image. We know the plaintext shape from
Agreement.java - [len][ASCII opcode chars][args][zero padding] - which is a
strong enough oracle to recognise the right key without chasing relocations.
"""
import pathlib
import sys

from Crypto.Cipher import AES

HERE = pathlib.Path(__file__).parent.parent
SO = HERE / "native/libAES.so"

# Ciphertext captured from the real app (jrd3n/ble_hacks), sent to the command
# characteristic. Whatever it decrypts to must be a well-formed frame.
KNOWN_CT = bytes.fromhex("3b3eb0f5954bdabde610174b52bfcecb")


def is_valid_frame(pt: bytes) -> bool:
    """A frame is [len][opcode ASCII...][args...] zero-padded to 16 bytes."""
    n = pt[0]
    if not 3 <= n <= 15:
        return False
    # Opcode is uppercase ASCII letters; args after it may be arbitrary bytes.
    letters = 0
    for c in pt[1:1 + n]:
        if 0x41 <= c <= 0x5A:
            letters += 1
        else:
            break
    if letters < 3:
        return False
    # Everything past the declared length must be zero padding.
    return all(b == 0 for b in pt[1 + n:])


def main() -> None:
    if not SO.exists():
        sys.exit(f"missing {SO}")
    blob = SO.read_bytes()
    print(f"{SO.name}: {len(blob)} bytes, {len(blob) - 15} candidate windows\n")

    hits = []
    for off in range(len(blob) - 15):
        key = blob[off:off + 16]
        try:
            pt = AES.new(key, AES.MODE_ECB).decrypt(KNOWN_CT)
        except ValueError:
            continue
        if is_valid_frame(pt):
            n = pt[0]
            opcode = pt[1:1 + n].decode("ascii", "replace")
            hits.append((off, key, pt, opcode))
            print(f"*** HIT at file offset 0x{off:04x}")
            print(f"    key       {key.hex()}")
            print(f"    plaintext {pt.hex(' ')}")
            print(f"    len={n} opcode={opcode!r}\n")

    if not hits:
        print("No key found. The cipher may not be plain AES-128-ECB, or the")
        print("key is derived rather than stored verbatim.")
        return

    print(f"{len(hits)} candidate key(s).")


if __name__ == "__main__":
    main()
