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

### Web Interface - Precision Shutter Diagnostics

The web interface provides a comprehensive suite for shutter diagnostics, offering detailed insights and control over the ESP32 sensor module.

**Main Layout:**

*   **Collapsible Configuration Panel (Left Sidebar):**
    *   **S1-S3 Distance (mm):** Input for the actual physical distance between the outermost sensors (S1 and S3).
    *   **Calibration Target Distance (mm):** Input for the distance used during a calibration phase (if applicable, for calculating a scaling factor).
    *   **Time Scaling Factor:** Displays the calculated factor (Actual Dist. / Calib. Target Dist.), which can be used to adjust timing measurements if the sensor rig was calibrated against a known standard different from its current physical setup.
*   **Main Content Area:**
    *   **Status Bar:** Located at the top, it displays:
        *   ESP32 Connection Status (e.g., "Connected", "Disconnected", "Error").
        *   Current Operational Mode of the ESP32 sensor system (e.g., "All Sensors", "Outer Sensors", "Inner Sensor").
        *   Last Communication Timestamp with the ESP32.
    *   **Tabbed Navigation:** Allows switching between different views:
        *   "Main Analysis" Tab
        *   "Results Log" Tab

**"Main Analysis" Tab:**

This tab presents a detailed breakdown of the latest shutter measurement data:

*   **Exposure & Shutter Speed Table:**
    *   Displays individual exposure times for S1, S2, and S3 in milliseconds (ms).
    *   Shows percentage comparisons of exposure times between S1 vs S2, and S2 vs S3.
    *   Calculates and displays the average exposure time.
    *   Converts exposure times to shutter speed equivalents (e.g., "1/125s", "1/250s", etc.) for each sensor and an average.
*   **Curtain Travel Times & Comparison Table (ms):**
    *   Shows travel times for Curtain 1 (opening/leading edge) and Curtain 2 (closing/trailing edge) between sensor pairs (S1->S2, S2->S3) and the total travel (S1->S3).
    *   Provides intra-curtain percentage variance (e.g., S1->S2 vs S2->S3 for Curtain 1).
    *   Displays inter-curtain percentage difference for each segment and total travel (e.g., Curtain 1 S1->S2 vs Curtain 2 S1->S2).
*   **Analysis & Durations Table:**
    *   **Shutter Fully Open Duration (ms):** An estimation of the effective time the entire frame might be exposed, typically derived from average exposure.
    *   **Avg. Slit Width (mm):** Calculated average width of the shutter slit based on sensor distance, exposure time, and curtain travel time.
    *   **Exposure Variation (% from avg):** A measure of consistency across the sensor points.
*   **Raw Sensor Timestamps Table:**
    *   Displays the raw open and close timestamps (S1, S2, S3) as captured by the ESP32.
    *   Features a **Timestamp Unit Selector** (µs, ms, s) allowing the user to view these raw timestamps in their preferred unit.

**"Results Log" Tab:**

*   This tab provides a table logging key metrics from recent measurements. Each row typically includes a timestamp, mode, key exposure times, average speed, total curtain travel times, calculated slit width, and exposure variation.

**Controls:**

*   **Mode Selection Dropdown (in Status Bar):** Allows the user to switch the ESP32's sensor operation mode:
    *   `All Sensors`: Utilizes S1, S2, and S3.
    *   `Outer Sensors`: Utilizes S1 and S3 only.
    *   `Inner Sensor`: Utilizes S2 only.
    *   *(Changing the mode via the dropdown automatically sends the command to the ESP32 via the "Set Mode" functionality integrated into the selector.)*
*   **Set Mode Button:** (Note: In the described advanced UI, mode changes are often tied directly to the dropdown selection's `onchange` event, implicitly calling the set mode API. If a separate button exists, it applies the dropdown's current value.)
*   **Manual Reset Button (from previous UI):** Triggers a reset of all sensor states on the ESP32, preparing for a new measurement. *(This button might be part of the main UI or configuration panel in the new design)*.
*   **Refresh Data Button (from previous UI):** Manually fetches the latest data from the ESP32. *(This button might be part of the main UI in the new design)*.
*   **Timestamp Unit Selector (in Raw Sensor Timestamps table):** Allows changing the display unit for raw open/close times.

**Auto-Refresh:**

*   The web interface automatically fetches and updates the displayed data from the ESP32 periodically (e.g., every 5 seconds).

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
