#!/usr/bin/env python3
"""First contact: ask the glasses what they are, then blink them.

Usage:
    python tools/hello.py [address-or-name]
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from bleak import BleakClient, BleakScanner  # noqa: E402

from joggles import protocol as p  # noqa: E402

DEFAULT_NAME = "GLASSES-12C3EF"

replies: list[bytes] = []


def on_notify(_sender, data: bytes) -> None:
    for i in range(0, len(data), p.BLOCK):
        block = data[i:i + p.BLOCK]
        if len(block) != p.BLOCK:
            print(f"  <- partial {block.hex(' ')}")
            continue
        pt = p.decrypt(block)
        n = pt[0]
        body = pt[1:1 + n]
        replies.append(pt)
        ascii_body = body.decode("ascii", "replace")
        print(f"  <- raw {block.hex()}")
        print(f"     dec {pt.hex(' ')}")
        print(f"     len={n} body={ascii_body!r}")


async def resolve(target: str) -> str:
    if len(target) > 30 and target.count("-") == 4:
        return target
    dev = await BleakScanner.find_device_by_name(target, timeout=20.0)
    if dev is None:
        sys.exit(f"Could not find {target!r}. Is it connected to the phone?")
    print(f"Found {dev.name} at {dev.address}")
    return dev.address


async def send(client: BleakClient, plaintext: bytes, label: str) -> None:
    ct = p.encrypt(plaintext)
    n = plaintext[0]
    print(f"-> {label:22} {plaintext[1:1 + n]!r}  ct={ct.hex()}")
    await client.write_gatt_char(p.CHAR_COMMAND, ct, response=False)
    await asyncio.sleep(0.4)


async def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NAME
    address = await resolve(target)

    async with BleakClient(address, timeout=30.0) as client:
        print(f"Connected, MTU {client.mtu_size}\n")
        await client.start_notify(p.CHAR_NOTIFY, on_notify)
        print("Subscribed to notify channel.\n")

        await send(client, p.query_type(), "STYPE (what are you?)")
        await asyncio.sleep(1.5)

        panel = None
        for pt in replies:
            panel = p.parse_type(pt) or panel
        if panel:
            print(f"\n*** PANEL SIZE: {panel[0]} rows x {panel[1]} cols ***\n")
        else:
            print("\n(no STYPE reply decoded yet)\n")

        # Visible proof of control: blink the panel off and on.
        print("Blinking the display so you can see it respond...")
        for _ in range(3):
            await send(client, p.leds(False), "LEDOFF")
            await asyncio.sleep(0.5)
            await send(client, p.leds(True), "LEDON")
            await asyncio.sleep(0.5)

        await asyncio.sleep(1.0)
        print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
