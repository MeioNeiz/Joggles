#!/usr/bin/env python3
"""Interactive BLE poking tool: connect, listen on every notify char, send hex.

Usage:
    python tools/probe.py <address-or-name> [write-char-uuid]

At the prompt:
    01 02 ff        send those three bytes
    "hello"         send an ASCII string
    :char <uuid>    switch the write target
    :chars          list writable characteristics
    :repeat 5 01 02 send the frame 5 times
    :quit
"""
import asyncio
import shlex
import sys

from bleak import BleakClient, BleakScanner


def parse_payload(text: str) -> bytes | None:
    text = text.strip()
    if not text:
        return None
    if text.startswith(('"', "'")):
        return shlex.split(text)[0].encode()
    try:
        return bytes.fromhex(text.replace(",", " "))
    except ValueError:
        print(f"  ! not valid hex or a quoted string: {text!r}")
        return None


async def resolve(target: str) -> str:
    if len(target) > 30 and target.count("-") == 4:
        return target
    if target.count(":") == 5:
        return target
    print(f"Scanning for {target!r}...")
    dev = await BleakScanner.find_device_by_name(target, timeout=15.0)
    if dev is None:
        sys.exit(f"No device named {target!r}. Run tools/scan.py first.")
    return dev.address


async def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    address = await resolve(sys.argv[1])
    write_uuid = sys.argv[2] if len(sys.argv) > 2 else None

    async with BleakClient(address, timeout=30.0) as client:
        print(f"Connected to {address}, MTU {client.mtu_size}")

        writable = []
        for service in client.services:
            for char in service.characteristics:
                if {"write", "write-without-response"} & set(char.properties):
                    writable.append(char)
                if "notify" in char.properties:
                    def cb(sender, data, uuid=char.uuid):
                        print(f"\n  <- {uuid}: {data.hex(' ')}  {data!r}")
                    try:
                        await client.start_notify(char, cb)
                        print(f"  listening on {char.uuid}")
                    except Exception as exc:  # noqa: BLE001
                        print(f"  could not subscribe to {char.uuid}: {exc}")

        if not writable:
            sys.exit("No writable characteristics - nothing to probe.")

        if write_uuid is None:
            # Write-without-response is the usual bulk data path; prefer it.
            preferred = [c for c in writable if "write-without-response" in c.properties]
            target_char = (preferred or writable)[0]
        else:
            match = [c for c in writable if c.uuid.lower() == write_uuid.lower()]
            if not match:
                sys.exit(f"{write_uuid} is not writable on this device.")
            target_char = match[0]

        print(f"\nWriting to {target_char.uuid} [{','.join(target_char.properties)}]")
        print("Type hex bytes and watch the glasses. :quit to exit.\n")

        loop = asyncio.get_running_loop()
        while True:
            try:
                line = await loop.run_in_executor(None, input, "> ")
            except (EOFError, KeyboardInterrupt):
                break
            line = line.strip()

            if line in (":quit", ":q"):
                break
            if line == ":chars":
                for c in writable:
                    mark = " *" if c is target_char else "  "
                    print(f"{mark}{c.uuid}  [{','.join(c.properties)}]")
                continue
            if line.startswith(":char "):
                want = line.split(maxsplit=1)[1].strip().lower()
                match = [c for c in writable if c.uuid.lower() == want]
                if match:
                    target_char = match[0]
                    print(f"  now writing to {target_char.uuid}")
                else:
                    print("  no such writable characteristic")
                continue
            if line.startswith(":repeat "):
                parts = line.split(maxsplit=2)
                if len(parts) < 3:
                    print("  usage: :repeat <n> <hex bytes>")
                    continue
                count = int(parts[1])
                payload = parse_payload(parts[2])
                if payload is None:
                    continue
                for _ in range(count):
                    await client.write_gatt_char(target_char, payload, response=False)
                    await asyncio.sleep(0.05)
                print(f"  -> sent {count}x {payload.hex(' ')}")
                continue

            payload = parse_payload(line)
            if payload is None:
                continue
            try:
                await client.write_gatt_char(target_char, payload, response=False)
                print(f"  -> {payload.hex(' ')} ({len(payload)} bytes)")
            except Exception as exc:  # noqa: BLE001
                print(f"  ! write failed: {exc}")

        print("\nDisconnecting.")


if __name__ == "__main__":
    asyncio.run(main())
