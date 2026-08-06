#!/usr/bin/env python3
"""Put your own text on the glasses.

Usage:
    python tools/text.py "HELLO"                # static if it fits, else scrolls
    python tools/text.py --clear                # blank the panel
    python tools/text.py --static "F"           # hold one frame, no scrolling
    python tools/text.py --mirror "HELLO"       # flip horizontally
    python tools/text.py --preview "HELLO"      # terminal only, no hardware
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from joggles import display as d  # noqa: E402
from joggles import font  # noqa: E402
from joggles.client import Glasses  # noqa: E402


def frame_for(bitmap: list[list[int]], offset: int, mirror: bool = False) -> d.Grid:
    """Window `bitmap` at horizontal `offset` into a 9x24 grid."""
    g = d.Grid()
    w = len(bitmap[0]) if bitmap else 0
    for r in range(font.HEIGHT):
        for c in range(d.COLS):
            src = c + offset
            if 0 <= src < w and bitmap[r][src]:
                g.set(font.BASELINE + r, (d.COLS - 1 - c) if mirror else c)
    return g


async def main() -> None:
    argv = sys.argv[1:]
    flags = {a for a in argv if a.startswith("--")}
    args = [a for a in argv if not a.startswith("--")]

    if "--clear" in flags:
        async with await Glasses.open() as g:
            print("Clearing (repeated, to beat any dropped writes)...")
            await g.begin()
            for _ in range(3):
                await g.show(d.Grid())
                await asyncio.sleep(0.3)
            await g.end(mode="keep")
        print("Cleared (stayed in DIY, so the saved image cannot come back).")
        return

    text = args[0] if args else "HELLO"
    delay = float(args[1]) if len(args) > 1 else 0.12
    mirror = "--mirror" in flags

    bitmap = font.text_bitmap(text)
    w = font.text_width(text)
    fits = w <= d.COLS or "--static" in flags
    print(f"{text!r} -> {w} columns wide, panel is {d.COLS}\n")

    centred = frame_for(bitmap, -((d.COLS - w) // 2), mirror)
    print(centred.render())

    if "--preview" in flags:
        return

    async with await Glasses.open() as g:
        print(f"\nConnected, {g._blocks_per_write} blocks per write")
        await g.begin()

        if fits:
            for _ in range(3):  # resend: cheap insurance against a dropped write
                await g.show(centred)
                await asyncio.sleep(0.2)
            print("Holding 25s...")
            await asyncio.sleep(25.0)
        else:
            print("Scrolling 3 times...")
            frames = [
                frame_for(bitmap, off, mirror)
                for off in range(-d.COLS, w + 1)
            ]
            for _ in range(3):
                await g.animate(frames, delay=delay)

        await g.end(mode="keep")
        print("Done. Frame left on screen; run tools/off.py to blank.")


if __name__ == "__main__":
    asyncio.run(main())
