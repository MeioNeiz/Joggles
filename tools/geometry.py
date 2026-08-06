#!/usr/bin/env python3
"""Pin down exact panel dimensions.

Confirmed so far, from live hardware:
  column 0 = LEFT edge
  bit 0 (LSB) = BOTTOM row, higher bit index = higher up
  bits above the panel height fall off the top of the lens

Unknown: row count, and true column count.

Row test draws horizontal lines at bits 4, 11, 13 and 15. Counting the visible
lines gives the height directly, because the vendor's own panel sizes are
5, 12, 14 and 16 rows:
    1 line  -> 5 rows      (only bit 4 visible)
    2 lines -> 12 rows     (bits 4, 11)
    3 lines -> 14 rows     (bits 4, 11, 13)
    4 lines -> 16 rows     (bits 4, 11, 13, 15)
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from bleak import BleakClient, BleakScanner  # noqa: E402

from joggles import protocol as p  # noqa: E402

DEFAULT_NAME = "GLASSES-12C3EF"
BULK = p.CHAR_BULK_B
HOLD = 5.0


async def cmd(client: BleakClient, plaintext: bytes) -> None:
    await client.write_gatt_char(p.CHAR_COMMAND, p.encrypt(plaintext), response=False)
    await asyncio.sleep(0.3)


async def push(client: BleakClient, columns: list[bytes]) -> None:
    for block in columns:
        await client.write_gatt_char(BULK, p.encrypt(block), response=False)
        await asyncio.sleep(0.02)


async def show(client, label: str, watch: str, cols: list[bytes]) -> None:
    print(f"\n--- {label}")
    print(f"    WATCH: {watch}")
    await push(client, cols)
    await asyncio.sleep(HOLD)


def uniform(bits: int, n: int) -> list[bytes]:
    b = bits.to_bytes(3, "big")
    return [p.column(c, b) for c in range(n)]


async def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NAME
    dev = await BleakScanner.find_device_by_name(target, timeout=20.0)
    if dev is None:
        sys.exit(f"Could not find {target!r}")

    async with BleakClient(dev.address, timeout=30.0) as client:
        print(f"Connected to {dev.name}")
        await cmd(client, p.enter_diy())
        await cmd(client, p.leds(True))

        # --- height ---
        ruler = (1 << 4) | (1 << 11) | (1 << 13) | (1 << 15)
        await show(
            client, "A. ROW RULER - four horizontal lines",
            "COUNT THE LINES (1, 2, 3 or 4). Some may be off the top.",
            uniform(ruler, 24),
        )

        await show(client, "B. blank", "display clears", uniform(0, 24))

        # --- width ---
        half = [
            p.column(c, (0xFFFFFF if c < 12 else 0).to_bytes(3, "big"))
            for c in range(24)
        ]
        await show(
            client, "C. COLUMNS 0-11 ONLY (of 24 sent)",
            "how much of the width lights? HALF, or the WHOLE lens?",
            half,
        )

        await show(client, "D. blank", "display clears", uniform(0, 24))

        await show(
            client, "E. 64 COLUMNS, every 8th lit",
            "COUNT THE VERTICAL LINES - tells us the true column count",
            [
                p.column(c, (0xFFFFFF if c % 8 == 0 else 0).to_bytes(3, "big"))
                for c in range(64)
            ],
        )

        await show(client, "F. blank", "display clears", uniform(0, 64))
        await cmd(client, p.exit_diy(save=False))
        print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
