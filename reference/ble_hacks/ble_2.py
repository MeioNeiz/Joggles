import asyncio
from bleak import BleakClient

address = "00:3A:FE:00:CA:87"  # Replace with the actual device address

handle_18 = "d44bc439-abfd-45a2-b575-92541612960b"
handle_12 = "d44bc439-abfd-45a2-b575-925416129600"

import csv

csv_file = "src/ble_hacks/GLASSES/data.csv"  # Path to your CSV file

# Read the CSV file and store its contents as a 2D array
data = []
with open(csv_file, "r") as file:
    csv_reader = csv.reader(file)
    for row in csv_reader:
        data.append(row)

# print(data[0][0])

async def run_commands():
    async with BleakClient(address) as client:
        # Update connection parameters
        # await client.write_gatt_char(0x2906, bytearray([300, 0, 8, 0, 16, 0]))

        # Write command to handle 12
        await client.write_gatt_char(handle_12, bytearray.fromhex("3b3eb0f5954bdabde610174b52bfcecb"))
        # await client.write_gatt_char(handle_12, bytearray.fromhex("3b3eb0f5954bdabde610174b52bfcecb"))

        # await client.write_gatt_char(handle_18, bytearray.fromhex("9489bbf28722b2d461ac631ff3144e64"))

        # Write command to handle 18 
        for y in range(3,5):

            print(f"y = {y}",end="\t")

            for x in range(0,24):

                print(f"x = {x}")
                await client.write_gatt_char(handle_18, bytearray.fromhex(data[y][x]))

                # response = input(":")

                # if response == "":
                #     pass
                # else:
                #     data[y][x] = ""

                # await client.write_gatt_char(handle_18, bytearray.fromhex(data[5][x]))

                # await client.write_gatt_char(handle_18, bytearray.fromhex(data[5][x]))

                await asyncio.sleep(0.2)  # Delay to allow time for responses

                await client.write_gatt_char(handle_12, bytearray.fromhex("3b3eb0f5954bdabde610174b52bfcecb"))

            

        # You can add more commands here if needed

        # await asyncio.sleep(5)  # Delay to allow time for responses

        # await client.write_gatt_char(handle_12, bytearray.fromhex("3b3eb0f5954bdabde610174b52bfcecb"))

    print("Done, Good though")

asyncio.run(run_commands())