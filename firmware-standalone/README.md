# ESP32 Standalone Firmware & Web Interface

This project implements a standalone firmware for the ESP32 that hosts a web interface. It features a detailed shutter sensor model, ported from an Arduino sketch, which captures high-resolution timing data for three optical sensors. The firmware provides API endpoints for interaction and a web UI for real-time data display and control.
The web interface is designed to display shutter speed sensor readings, calculated exposure times, and curtain travel times.

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

### Web Interface Controls & Display

The web interface provides the following controls and displays:

*   **Controls:**
    *   **Mode Selection Dropdown:** Allows selecting the sensor measurement mode:
        *   `All Sensors (S1, S2, S3)`: Uses all three sensors.
        *   `Outer Sensors (S1, S3)`: Uses only the top and bottom sensors.
        *   `Inner Sensor (S2)`: Uses only the middle sensor.
    *   **Set Mode Button:** Applies the selected mode to the ESP32.
    *   **Manual Reset Button:** Triggers a reset of all sensor states on the ESP32, preparing for a new measurement.
    *   **Refresh Data Button:** Manually fetches the latest data from the ESP32.
*   **Status Bar:**
    *   **Current Mode:** Displays the active measurement mode on the ESP32 (e.g., "ALL", "OUTER", "INNER").
    *   **Status:** Shows messages from the web UI (e.g., "Fetching data...", "Mode successfully set.", "Error...").
*   **Data Display:**
    *   **Sensor Open/Close Times:** Raw timestamps in microseconds (µs) when each active sensor beam is broken (open) and restored (close).
        *   S1 (Top): `s1_open_us`, `s1_close_us`
        *   S2 (Middle): `s2_open_us`, `s2_close_us`
        *   S3 (Bottom): `s3_open_us`, `s3_close_us`
    *   **Calculated Exposure Times:**
        *   For each active sensor, the duration the sensor was obscured, displayed in µs and as a fractional second (e.g., `~1/125s`).
    *   **Curtain Travel Times:**
        *   Calculated time taken for the leading (opening) edge and trailing (closing) edge of the shutter curtains to travel between sensor pairs (e.g., S1 -> S2, S2 -> S3, S1 -> S3).
*   **Auto-Refresh:** The web interface automatically refreshes the displayed data every 5 seconds.

## API Endpoints

The firmware exposes the following HTTP API endpoints:

### `/api/getdata`

*   **Method:** `GET`
*   **Purpose:** Fetches the latest sensor readings and the current operational mode of the ESP32.
*   **Response:** JSON object.
    *   Example:
        ```json
        {
          "mode": "ALL",
          "s1_open_us": 1000,
          "s1_close_us": 2000,
          "s2_open_us": 1500,
          "s2_close_us": 2500,
          "s3_open_us": 2000,
          "s3_close_us": 3000
        }
        ```
    *   Fields:
        *   `mode`: (string) Current measurement mode - "ALL", "OUTER", or "INNER".
        *   `s1_open_us`, `s1_close_us`: (number) Timestamps for sensor 1.
        *   `s2_open_us`, `s2_close_us`: (number) Timestamps for sensor 2.
        *   `s3_open_us`, `s3_close_us`: (number) Timestamps for sensor 3.
        *   (Values are 0 if not yet recorded or not applicable to the current mode).

### `/api/setmode`

*   **Method:** `POST`
*   **Purpose:** Sets the sensor measurement mode on the ESP32.
*   **Request Body:** JSON object.
    *   Example: `{"mode": 1}`
    *   Fields:
        *   `mode`: (number)
            *   `0`: MODE_ALL_SENSORS
            *   `1`: MODE_OUTER_SENSORS
            *   `2`: MODE_INNER_SENSOR
*   **Response:**
    *   On success: `{"success":true, "mode_set":"<MODE_STRING>"}` (e.g., `{"success":true, "mode_set":"OUTER"}`)
    *   On error: JSON object describing the error (e.g., invalid mode value).

### `/api/reset`

*   **Method:** `POST`
*   **Purpose:** Resets all sensor states to idle, preparing for a new measurement sequence.
*   **Request Body:** None.
*   **Response:**
    *   On success: `{"success":true}`
    *   On error: JSON object describing the error.
