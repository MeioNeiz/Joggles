#!/usr/bin/env python3
"""Draw a box border to verify the full pixel mapping at once.

Working model, from live hardware:
    9 rows, 24 columns
    row 0 = bottom, row 8 = top
    row r occupies bit 2*r of the 3-byte column  (two bits per pixel)
    column 0 = left edge

If that model is right, test 1 draws a rectangle hugging the lens edges exactly.
Anything else - gaps, doubled lines, half a box - tells us where it is wrong.
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from bleak import BleakClient, BleakScanner  # noqa: E402

from joggles import protocol as p  # noqa: E402

DEFAULT_NAME = "GLASSES-12C3EF"
BULK = p.CHAR_BULK_B
ROWS, COLS = 9, 24
HOLD = 8.0


def blank() -> list[list[int]]:
    return [[0] * COLS for _ in range(ROWS)]


def to_columns(grid: list[list[int]], stride: int = 2) -> list[bytes]:
    """Pack a [row][col] grid into per-column frames. row r -> bit stride*r."""
    out = []
    for c in range(COLS):
        bits = 0
        for r in range(ROWS):
            if grid[r][c]:
                bits |= 1 << (stride * r)
        out.append(p.column(c, bits.to_bytes(3, "big")))
    return out


def box() -> list[list[int]]:
    g = blank()
    for c in range(COLS):
        g[0][c] = 1
        g[ROWS - 1][c] = 1
    for r in range(ROWS):
        g[r][0] = 1
        g[r][COLS - 1] = 1
    return g


def box_with_corner() -> list[list[int]]:
    """Box plus a solid 3x3 block in the TOP-LEFT, to pin orientation."""
    g = box()
    for r in range(ROWS - 3, ROWS):
        for c in range(3):
            g[r][c] = 1
    return g


def arrow_up() -> list[list[int]]:
    """A chevron pointing at the top of the lens."""
    g = blank()
    mid = COLS // 2
    for i in range(4):
        g[ROWS - 1 - i][mid - i] = 1
        g[ROWS - 1 - i][mid + i] = 1
    return g


async def cmd(client: BleakClient, plaintext: bytes) -> None:
    await client.write_gatt_char(p.CHAR_COMMAND, p.encrypt(plaintext), response=False)
    await asyncio.sleep(0.25)


async def push(client: BleakClient, cols: list[bytes]) -> None:
    for block in cols:
        await client.write_gatt_char(BULK, p.encrypt(block), response=False)
        await asyncio.sleep(0.015)


async def show(client, label: str, watch: str, cols: list[bytes]) -> None:
    print(f"\n--- {label}")
    print(f"    WATCH: {watch}")
    await push(client, cols)
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

        await show(client, "1. BOX (stride 2 - the working model)",
                   "a clean rectangle framing the lens. Gaps? Doubled edges?",
                   to_columns(box(), stride=2))

        await show(client, "2. BOX (stride 1 - the alternative)",
                   "if THIS one is the clean box instead, the model is 1 bit "
                   "per pixel and the panel is taller than 9 rows",
                   to_columns(box(), stride=1))

        await show(client, "3. BOX + SOLID TOP-LEFT CORNER",
                   "is the solid block in the TOP-LEFT? confirms orientation",
                   to_columns(box_with_corner(), stride=2))

        await show(client, "4. CHEVRON POINTING UP",
                   "does it point to the TOP of the lens?",
                   to_columns(arrow_up(), stride=2))

        await push(client, to_columns(blank()))
        await cmd(client, p.exit_diy(save=False))
        print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
