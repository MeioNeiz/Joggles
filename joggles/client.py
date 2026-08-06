"""Connection handling with the flow control the panel actually needs.

Write-without-response has no flow control: fire 24 column writes back to back
and the controller silently drops some, leaving those columns showing the
previous frame. That shows up as random stuck LEDs during animation.

Two things fix it:
  - pack as many 16-byte blocks into each ATT write as the MTU allows, cutting
    a 24-column frame from 24 writes to 3
  - pace writes so a frame cannot outrun the connection interval
"""
from __future__ import annotations

import asyncio

from bleak import BleakClient, BleakScanner

from . import display as d
from . import protocol as p

DEFAULT_NAME = "GLASSES-12C3EF"

# ATT write payload is MTU minus the 3-byte opcode+handle header.
ATT_OVERHEAD = 3

# Gap between batched writes. Roughly one BLE connection interval; below this
# the controller starts dropping write-without-response packets.
PACING = 0.02


class Glasses:
    def __init__(self, client: BleakClient) -> None:
        self.client = client
        self._blocks_per_write = self._capacity()

    def _capacity(self) -> int:
        # One block per write, always. The panel decodes only the FIRST 16-byte
        # block of an ATT write and drops the rest: batching 11 blocks per write
        # updated columns 0, 11 and 22 only, and silently lost the other 21.
        # Throughput therefore comes from pacing, not from bigger writes.
        return 1

    @classmethod
    async def open(cls, target: str = DEFAULT_NAME, timeout: float = 20.0):
        if len(target) > 30 and target.count("-") == 4:
            address = target
        else:
            dev = await BleakScanner.find_device_by_name(target, timeout=timeout)
            if dev is None:
                raise RuntimeError(
                    f"{target!r} not found. Is it powered on and not held by the phone?"
                )
            address = dev.address
        client = BleakClient(address, timeout=30.0)
        await client.connect()
        return cls(client)

    async def close(self) -> None:
        if self.client.is_connected:
            await self.client.disconnect()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc) -> None:
        await self.close()

    async def command(self, plaintext: bytes) -> None:
        await self.client.write_gatt_char(
            p.CHAR_COMMAND, p.encrypt(plaintext), response=False
        )
        await asyncio.sleep(0.15)

    async def begin(self) -> None:
        """Enter DIY mode with the panel on, ready for pixel writes."""
        await self.command(p.enter_diy())
        await self.command(p.leds(True))

    async def end(self, mode: str = "keep") -> None:
        """Finish a session.

        Leaving DIY mode makes the firmware restore whatever image was saved
        from the vendor app, which looks exactly like stray pixels appearing
        from nowhere. So "keep" is the default: stay in DIY and leave our own
        frame on screen.

            keep    - stay in DIY, our last frame stays up
            off     - blank, then LEDOFF for a known-dark panel
            restore - exit DIY, handing the display back to the saved image
        """
        if mode == "keep":
            return
        if mode == "off":
            await self.show(d.Grid())
            await self.command(p.leds(False))
            return
        if mode == "restore":
            await self.command(p.exit_diy(save=False))
            return
        raise ValueError(f"unknown end mode: {mode!r}")

    async def show(self, grid: d.Grid) -> None:
        """Push one full frame, batched to respect the MTU."""
        blocks = [p.encrypt(f) for f in grid.to_frames()]
        n = self._blocks_per_write
        for i in range(0, len(blocks), n):
            chunk = b"".join(blocks[i:i + n])
            await self.client.write_gatt_char(p.CHAR_BULK_B, chunk, response=False)
            await asyncio.sleep(PACING)

    async def animate(self, frames, delay: float = 0.12) -> None:
        """Play a sequence of grids at a sustainable rate.

        `delay` is a floor, not a target: a frame that takes longer to transmit
        than `delay` is not chased, which is what keeps writes from piling up.
        """
        loop = asyncio.get_running_loop()
        for grid in frames:
            start = loop.time()
            await self.show(grid)
            spent = loop.time() - start
            if spent < delay:
                await asyncio.sleep(delay - spent)
