import asyncio
from bleak import BleakScanner, BleakClient

import csv

csv_file = "data.csv"  # Path to your CSV file

# Read the CSV file and store its contents as a 2D array
data = []
with open(csv_file, "r") as file:
    csv_reader = csv.reader(file)
    for row in csv_reader:
        data.append(row)

# # Print the 2D array
# for row in data:
#     print(row)

service_uuid = "0000fff0-0000-1000-8000-00805f9b34fb"

async def handle_notification(sender, data):
    print("Received command:", data)

async def connect_to_device(device_mac):
    try:
        # Connect to the BLE device
        async with BleakClient(device_mac) as client:

            client.w

            await client.write_gatt_char('d44bc439-abfd-45a2-b575-925416129600',bytes.fromhex('3b3eb0f5954bdabde610174b52bfcecb'), response=False)

            for row in data:
                command = row[0]  # Get the command from the first column
                print("Sending command:", command)

                # Convert the command to bytes
                command_bytes = bytes.fromhex(command)

                await client.write_gatt_char('d44bc439-abfd-45a2-b575-92541612960b', command_bytes, response=False)

            # print("Here")
            # # Send multiple commands
            # for command in commands:
            #     
            #     print("Command sent successfully:", command)

    except Exception as e:
        print(f"Error: {str(e)}")

async def scan_and_connect():

    # UUID of the service you want to search for


    try:
        # Start scanning for BLE devices
        scanner = BleakScanner()
        devices = await scanner.discover()

        # Find the target device
        for device in devices:

            if service_uuid in device.details['props']['UUIDs']:

                print(f"{device.address} {device.name}")

                device_mac = device.address

                await connect_to_device(device_mac)


            # if service_uuid in device.metadata["uuids"]:
                


            #     # Connect to the device and send multiple commands
            #     commands = [[0x01, 0x02, 0x03], [0x04, 0x05, 0x06], [0x07, 0x08, 0x09]]  # Example commands
            #     await connect_and_send_commands(commands)
            #     break

        print("Scanning completed.")
    except Exception as e:
        print(f"Error: {str(e)}")

loop = asyncio.get_event_loop()
loop.run_until_complete(scan_and_connect())