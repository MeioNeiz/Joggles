#!/usr/bin/env python3
"""Find the exact topmost usable bit.

Each test lights ONE bit alone, with nothing else on the display, and blinks it.
The question is binary: does anything appear, yes or no? The highest bit that
still shows a line is the top row, so row count = that bit + 1.
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from bleak import BleakClient, BleakScanner  # noqa: E402

from joggles import protocol as p  # noqa: E402

DEFAULT_NAME = "GLASSES-12C3EF"
BULK = p.CHAR_BULK_B
COLS = 24


async def cmd(client: BleakClient, plaintext: bytes) -> None:
    await client.write_gatt_char(p.CHAR_COMMAND, p.encrypt(plaintext), response=False)
    await asyncio.sleep(0.25)


async def push(client: BleakClient, bits: int) -> None:
    b = bits.to_bytes(3, "big")
    for c in range(COLS):
        await client.write_gatt_char(BULK, p.encrypt(p.column(c, b)), response=False)
        await asyncio.sleep(0.015)


async def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NAME
    dev = await BleakScanner.find_device_by_name(target, timeout=20.0)
    if dev is None:
        sys.exit(f"Could not find {target!r}")

    async with BleakClient(dev.address, timeout=30.0) as client:
        print(f"Connected to {dev.name}\n")
        await cmd(client, p.enter_diy())
        await cmd(client, p.leds(True))

        for bit in (15, 16, 17):
            print(f"=== BIT {bit} ALONE (would be row {bit + 1} counting from bottom)")
            print("    Do you see ANY line at all? Nothing else is lit.")
            for _ in range(7):
                await push(client, 1 << bit)
                await asyncio.sleep(0.6)
                await push(client, 0)
                await asyncio.sleep(0.4)
            print("    ...done\n")
            await asyncio.sleep(1.5)

        print("=== FINALLY: bits 0-15 all lit (a full 16-row block)")
        print("    Does this fill the lens completely, or is there a gap at the top?")
        await push(client, 0x00FFFF)
        await asyncio.sleep(8.0)

        await push(client, 0)
        await cmd(client, p.exit_diy(save=False))
        print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
