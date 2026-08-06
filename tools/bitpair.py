#!/usr/bin/env python3
"""Work out what the second bit per pixel means.

Evidence says row = bit // 2 across a 9-row panel, so each pixel owns two bits.
This tests the three plausible readings:

  grayscale  - both bits light the SAME row, at different brightness
  two lenses - even bits drive one lens, odd bits the other
  linear     - they light ADJACENT rows, and the 9-row reading is wrong
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from bleak import BleakClient, BleakScanner  # noqa: E402

from joggles import protocol as p  # noqa: E402

DEFAULT_NAME = "GLASSES-12C3EF"
BULK = p.CHAR_BULK_B
COLS = 24
HOLD = 7.0


async def cmd(client: BleakClient, plaintext: bytes) -> None:
    await client.write_gatt_char(p.CHAR_COMMAND, p.encrypt(plaintext), response=False)
    await asyncio.sleep(0.25)


async def push(client: BleakClient, bits: int) -> None:
    b = bits.to_bytes(3, "big")
    for c in range(COLS):
        await client.write_gatt_char(BULK, p.encrypt(p.column(c, b)), response=False)
        await asyncio.sleep(0.015)


async def show(client, label: str, watch: str, bits: int) -> None:
    print(f"\n--- {label}")
    print(f"    WATCH: {watch}")
    await push(client, bits)
    await asyncio.sleep(HOLD)


async def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NAME
    dev = await BleakScanner.find_device_by_name(target, timeout=20.0)
    if dev is None:
        sys.exit(f"Could not find {target!r}")

    async with BleakClient(dev.address, timeout=30.0) as client:
        print(f"Connected to {dev.name}")
        await cmd(client, p.enter_diy())
        await cmd(client, p.leds(True))

        await show(client, "1. BIT 0 alone",
                   "bottom row. Note WHICH LENS and HOW BRIGHT.", 1 << 0)
        await show(client, "2. BIT 1 alone",
                   "same row as test 1, or one row up? Same lens? Same brightness?",
                   1 << 1)
        await show(client, "3. BITS 0 AND 1 together",
                   "one row or two? brighter than either alone?", 0b11)

        await show(client, "4. EVEN BITS ONLY (0,2,4...16)",
                   "9 rows filling the whole lens, or every other row?",
                   sum(1 << b for b in range(0, 18, 2)))
        await show(client, "5. ODD BITS ONLY (1,3,5...17)",
                   "same as test 4, or the other lens, or offset rows?",
                   sum(1 << b for b in range(1, 18, 2)))

        await push(client, 0)
        await cmd(client, p.exit_diy(save=False))
        print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
