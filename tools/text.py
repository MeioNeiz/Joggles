#!/usr/bin/env python3
"""Put your own text on the glasses.

Usage:
    python tools/text.py "HELLO"              # static if it fits, else scrolls
    python tools/text.py "LONG MESSAGE" 0.08  # custom scroll delay
    python tools/text.py --preview "HELLO"    # terminal only, no hardware
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from bleak import BleakClient, BleakScanner  # noqa: E402

from joggles import display as d  # noqa: E402
from joggles import font  # noqa: E402
from joggles import protocol as p  # noqa: E402

DEFAULT_NAME = "GLASSES-12C3EF"
BULK = p.CHAR_BULK_B


def frame_for(bitmap: list[list[int]], offset: int) -> d.Grid:
    """Window `bitmap` at horizontal `offset` into a 9x24 grid."""
    g = d.Grid()
    w = len(bitmap[0]) if bitmap else 0
    for r in range(font.HEIGHT):
        for c in range(d.COLS):
            src = c + offset
            if 0 <= src < w and bitmap[r][src]:
                g.set(font.BASELINE + r, c)
    return g


async def cmd(client: BleakClient, plaintext: bytes) -> None:
    await client.write_gatt_char(p.CHAR_COMMAND, p.encrypt(plaintext), response=False)
    await asyncio.sleep(0.2)


async def push(client: BleakClient, grid: d.Grid) -> None:
    for block in grid.to_frames():
        await client.write_gatt_char(BULK, p.encrypt(block), response=False)


async def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--preview"]
    preview_only = "--preview" in sys.argv
    text = args[0] if args else "HELLO"
    delay = float(args[1]) if len(args) > 1 else 0.09

    bitmap = font.text_bitmap(text)
    w = font.text_width(text)
    print(f"{text!r} -> {w} columns wide, panel is {d.COLS}\n")

    if w <= d.COLS:
        centred = frame_for(bitmap, -((d.COLS - w) // 2))
        print(centred.render())
    else:
        print(frame_for(bitmap, 0).render())
        print("\n(scrolls, too wide to fit)")

    if preview_only:
        return

    dev = await BleakScanner.find_device_by_name(
        args[2] if len(args) > 2 else DEFAULT_NAME, timeout=20.0
    )
    if dev is None:
        sys.exit("Glasses not found")

    async with BleakClient(dev.address, timeout=30.0) as client:
        print(f"\nConnected to {dev.name}")
        await cmd(client, p.enter_diy())
        await cmd(client, p.leds(True))

        if w <= d.COLS:
            await push(client, frame_for(bitmap, -((d.COLS - w) // 2)))
            await asyncio.sleep(25.0)
        else:
            print("Scrolling 3 times, Ctrl-C to stop early...")
            for _ in range(3):
                for off in range(-d.COLS, w + 1):
                    await push(client, frame_for(bitmap, off))
                    await asyncio.sleep(delay)

        await push(client, d.Grid())
        await cmd(client, p.exit_diy(save=False))
        print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
