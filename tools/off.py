#!/usr/bin/env python3
"""Blank the panel properly.

Writing an all-zero frame is not the same as turning the panel off. Leaving DIY
mode appears to restore whatever image the firmware had saved, which brings
stray pixels back. LEDOFF kills the display outright, so it is the reliable
way to get to a known-dark state.

Usage:
    python tools/off.py          # LEDOFF
    python tools/off.py --on     # LEDON, blank frame, stay in DIY
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from joggles import display as d  # noqa: E402
from joggles import protocol as p  # noqa: E402
from joggles.client import Glasses  # noqa: E402


async def main() -> None:
    turn_on = "--on" in sys.argv

    async with await Glasses.open() as g:
        print(f"Connected, {g._blocks_per_write} blocks per write")

        if turn_on:
            await g.command(p.enter_diy())
            await g.command(p.leds(True))
            for _ in range(3):
                await g.show(d.Grid())
                await asyncio.sleep(0.25)
            print("Panel on, blank frame, still in DIY mode (not exited).")
        else:
            # Blank first, so nothing is retained, then cut the panel.
            await g.command(p.enter_diy())
            for _ in range(3):
                await g.show(d.Grid())
                await asyncio.sleep(0.25)
            await g.command(p.leds(False))
            print("LEDOFF sent. The panel should now be completely dark.")

        await asyncio.sleep(1.0)


if __name__ == "__main__":
    asyncio.run(main())
