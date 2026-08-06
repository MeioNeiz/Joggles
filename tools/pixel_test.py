#!/usr/bin/env python3
"""Determine panel geometry, bit order and scan direction empirically.

Each pattern is deliberately asymmetric so that what you SEE identifies the
mapping unambiguously. Watch the glasses and note what each one draws.
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from bleak import BleakClient, BleakScanner  # noqa: E402

from joggles import protocol as p  # noqa: E402

DEFAULT_NAME = "GLASSES-12C3EF"
BULK = p.CHAR_BULK_B  # what the reference capture used
COLS = 24  # column count seen in the reference capture
HOLD = 4.0


def on_notify(_sender, data: bytes) -> None:
    for i in range(0, len(data), p.BLOCK):
        block = data[i:i + p.BLOCK]
        if len(block) == p.BLOCK:
            pt = p.decrypt(block)
            n = pt[0]
            print(f"     <- {pt.hex(' ')}  body={pt[1:1 + n]!r}")


async def cmd(client: BleakClient, plaintext: bytes) -> None:
    await client.write_gatt_char(p.CHAR_COMMAND, p.encrypt(plaintext), response=False)
    await asyncio.sleep(0.3)


async def push(client: BleakClient, columns: list[bytes]) -> None:
    """Send one frame, one encrypted block per column."""
    for block in columns:
        await client.write_gatt_char(BULK, p.encrypt(block), response=False)
        await asyncio.sleep(0.02)


def solid(bits: int) -> list[bytes]:
    b = bits.to_bytes(3, "big")
    return [p.column(c, b) for c in range(COLS)]


async def pattern(client, label: str, watch: str, columns: list[bytes]) -> None:
    print(f"\n--- {label}")
    print(f"    WATCH FOR: {watch}")
    await push(client, columns)
    await asyncio.sleep(HOLD)


async def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NAME
    dev = await BleakScanner.find_device_by_name(target, timeout=20.0)
    if dev is None:
        sys.exit(f"Could not find {target!r}")

    async with BleakClient(dev.address, timeout=30.0) as client:
        print(f"Connected to {dev.name}, MTU {client.mtu_size}")
        await client.start_notify(p.CHAR_NOTIFY, on_notify)

        # Retry STYPE with response=True, in case the reply needs an ACKed write.
        print("\nRetrying STYPE with write-with-response...")
        try:
            await client.write_gatt_char(
                p.CHAR_COMMAND, p.encrypt(p.query_type()), response=True
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  (with-response write failed: {exc})")
        await asyncio.sleep(1.5)

        print("\nEntering DIY mode...")
        await cmd(client, p.enter_diy())
        await cmd(client, p.leds(True))
        await cmd(client, p.brightness(3))

        await pattern(
            client, "1. ALL PIXELS ON",
            "whole display lit -> confirms bulk writes are accepted at all",
            solid(0xFFFFFF),
        )

        await pattern(
            client, "2. ALL OFF",
            "display blank",
            solid(0x000000),
        )

        await pattern(
            client, "3. SINGLE COLUMN (index 0) LIT",
            "one vertical line. WHICH EDGE - left or right?",
            [p.column(c, (0xFFFFFF if c == 0 else 0).to_bytes(3, "big"))
             for c in range(COLS)],
        )

        await pattern(
            client, "4. TOP BIT ONLY (MSB of each column)",
            "one horizontal line. TOP or BOTTOM of the lens?",
            solid(0x800000),
        )

        await pattern(
            client, "5. BOTTOM BIT ONLY (LSB of each column)",
            "one horizontal line at the opposite edge to pattern 4",
            solid(0x000001),
        )

        await pattern(
            client, "6. DIAGONAL",
            "a diagonal stripe - tells us both axes at once",
            [p.column(c, (1 << (23 - (c % 24))).to_bytes(3, "big"))
             for c in range(COLS)],
        )

        print("\nExiting DIY without saving.")
        await cmd(client, p.exit_diy(save=False))
        print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
