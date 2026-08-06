# This is the main controller for the control of the glasses

# goals
# 1. create a class, if the use doesnt specifiy a MAC then then search an look for known UUID
# 2. connect to device and send commands to specific handles
# 3. allow the user to send to individual pixels

import time
import bleak
import asyncio

class BLE_GLASSES:

    def __init__(self, mac_address=None):
        self.service_uuid = "0000fff0-0000-1000-8000-00805f9b34fb"
        self.handle_12 = "d44bc439-abfd-45a2-b575-925416129600"
        self.handle_18 = "d44bc439-abfd-45a2-b575-92541612960b"
        self.mac_address = mac_address
        self.device = None
        self.client = None  # Variable to store the client connection
        
        if self.mac_address:
            asyncio.run(self.connect_by_mac())
        else:
            asyncio.run(self.connect_by_uuid())  # Use asyncio.run() to run the asynchronous method
        
    async def connect_by_mac(self):
        self.device = await bleak.BleakScanner.find_device_by_address(self.mac_address)
        self.client = bleak.BleakClient(self.device)

    async def connect_by_uuid(self):
        devices = await bleak.BleakScanner.discover()
        for device in devices:
            if self.service_uuid in device.details['props']['UUIDs']:
                print(f"Connecting to {device.address} - {device.name}")
                self.device = device
                self.client = bleak.BleakClient(self.device)
                break
        else:
            raise ValueError(f"No device found with the specified UUID: {self.service_uuid}")

    async def send_to_handle(self, handle_uuid, message_data):
        await self.client.connect()  # Connect to the BLE device (if not already connected)

        # Convert the message data to bytes (assuming it's in hexadecimal format)
        message_bytes = bytes.fromhex(message_data)

        # Write the data to the specified handle
        await self.client.write_gatt_char(handle_uuid, message_bytes)

    def disconnect(self):
        if self.client and self.client.is_connected:
            self.client.disconnect()

    def clear_screen(self):
       asyncio.run(self.send_to_handle(self.handle_12, "3b3eb0f5954bdabde610174b52bfcecb"))

    def clear_screen(self):
       asyncio.run(self.send_to_handle(self.handle_12, "3b3eb0f5954bdabde610174b52bfcecb"))

    def light_pixel(self, pixel_coordinates):
        # Assuming pixel_coordinates is a list of coordinates like [3, 5]
        asyncio.run(self.send_to_handle(self.handle_12, message_data))

if __name__ == "__main__":
    # Example usage:
    # Create an instance with a MAC address
    #my_glasses = BLE_GLASSES(mac_address="00:3A:FE:00:CA:87")
    my_glasses = BLE_GLASSES()

    my_glasses.clear_screen()

    my_glasses.disconnect()