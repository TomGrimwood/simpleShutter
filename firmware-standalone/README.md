# ESP32 Standalone Firmware & Web Interface

This project implements a standalone firmware for the ESP32 that hosts a web interface.
The current web interface is designed to (eventually) display shutter speed sensor readings and calculations.

## Prerequisites

*   ESP-IDF (Espressif IoT Development Framework). This project is generally compatible with ESP-IDF v4.x or later. Ensure your ESP-IDF environment is properly set up. (Refer to official ESP-IDF documentation).

## Configuration

1.  **WiFi Credentials**:
    The WiFi SSID and Password need to be configured for the ESP32 to connect to your network.
    The default placeholders are in `sdkconfig.defaults`:
    ```
    CONFIG_ESP_WIFI_SSID="MY_ESP_WIFI_SSID"
    CONFIG_ESP_WIFI_PASSWORD="MY_ESP_WIFI_PASSWORD"
    ```
    You can override these by:
    *   Creating your own `sdkconfig` file in the project root and setting these values.
    *   Running `idf.py menuconfig`, navigating to "Example Connection Configuration", and setting the SSID and Password.
    *   Directly editing `sdkconfig.defaults` (less recommended for personal settings).

## Build and Flash

1.  **Open a terminal** with the ESP-IDF environment activated.
2.  **Navigate to this project directory** (`firmware-standalone`).
3.  **Build the project**:
    ```bash
    idf.py build
    ```
4.  **Flash the firmware to your ESP32**:
    Replace `(PORT)` with your ESP32's serial port (e.g., `/dev/ttyUSB0` on Linux, `COM3` on Windows).
    ```bash
    idf.py -p (PORT) flash
    ```
    You can also use `idf.py -p (PORT) flash monitor` to view serial output immediately after flashing.

## Accessing the Web Interface

1.  Once the ESP32 is flashed and successfully connects to your WiFi network, it will print its IP address to the serial monitor.
    Look for a line like: `I (wifi station): got ip:192.168.X.X`
2.  Open a web browser on a device connected to the same network.
3.  Navigate to `http://<ESP32_IP_ADDRESS>/` (replacing `<ESP32_IP_ADDRESS>` with the actual IP).
