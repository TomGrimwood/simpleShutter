from flask import Flask, request, jsonify, Response, render_template
import logging
import json
import time
import queue
import threading
import serial
import serial.tools.list_ports

app = Flask(__name__)

# --- Configuration ---
DISTANCE_S1_S2_MM = 20.0
DISTANCE_S2_S3_MM = 20.0
ESP32_HEARTBEAT_TIMEOUT_SECONDS = 30
SERIAL_BAUD_RATE = 115200

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Globals for SSE and ESP32 Heartbeat & Serial Port Management ---
client_queues = []
client_queues_lock = threading.Lock()
last_esp32_heartbeat_time = 0
serial_connection_active = False

# Serial Port Management Globals
SERIAL_PORT = None  # Target COM port, initially None
current_serial_port_in_use = None # Actual port the listener thread is using
serial_reader_thread_instance = None
stop_serial_thread_event = threading.Event()
command_queue = queue.Queue() # For sending commands to ESP32

def is_valid_time(t):
    return t is not None and isinstance(t, (int, float)) and t > 0

def calculate_shutter_data(s1_o, s1_c, s2_o, s2_c, s3_o, s3_c, mode_str):
    results = {
        "measurement_mode": mode_str,
        "raw_times_us": {
            "s1_open": s1_o, "s1_close": s1_c,
            "s2_open": s2_o, "s2_close": s2_c,
            "s3_open": s3_o, "s3_close": s3_c,
        },
        "errors": []
    }

    exposures_us = {}
    exposures_ms = {}
    exposures_s = {}
    shutter_speeds_hz = {}

    sensor_data_map = {
        "s1": (s1_o, s1_c),
        "s2": (s2_o, s2_c),
        "s3": (s3_o, s3_c)
    }
    
    active_sensors_for_mode = []
    if mode_str == "ALL":
        active_sensors_for_mode = ["s1", "s2", "s3"]
    elif mode_str == "OUTER":
        active_sensors_for_mode = ["s1", "s3"]
    elif mode_str == "INNER":
        active_sensors_for_mode = ["s2"]

    for sensor_label in ["s1", "s2", "s3"]:
        o, c = sensor_data_map[sensor_label]
        if sensor_label in active_sensors_for_mode:
            if is_valid_time(o) and is_valid_time(c) and c > o:
                exp_us = c - o
                exposures_us[sensor_label] = exp_us
                exposures_ms[sensor_label] = exp_us / 1000.0
                exp_s_val = exp_us / 1_000_000.0
                exposures_s[sensor_label] = exp_s_val
                shutter_speeds_hz[sensor_label] = (1.0 / exp_s_val) if exp_s_val > 0 else "inf"
            else:
                exposures_us[sensor_label] = None
                exposures_ms[sensor_label] = None
                exposures_s[sensor_label] = None
                shutter_speeds_hz[sensor_label] = None
                if not (o == 0 and c == 0): 
                     results["errors"].append(f"Invalid open/close times for active sensor {sensor_label}: o={o}, c={c}")
        else: 
            exposures_us[sensor_label] = None
            exposures_ms[sensor_label] = None
            exposures_s[sensor_label] = None
            shutter_speeds_hz[sensor_label] = None

    results["exposure_times_us"] = exposures_us
    results["exposure_times_ms"] = exposures_ms
    results["exposure_times_s"] = exposures_s
    results["shutter_speeds_hz_equivalent"] = shutter_speeds_hz

    c1_s1_s2, c1_s2_s3, c1_s1_s3_total = None, None, None
    c2_s1_s2, c2_s2_s3, c2_s1_s3_total = None, None, None

    if mode_str == "ALL":
        if is_valid_time(s1_o) and is_valid_time(s2_o) and s2_o > s1_o: c1_s1_s2 = (s2_o - s1_o) / 1000.0
        else: results["errors"].append("C1 S1->S2: Invalid S1/S2 open times.")
        if is_valid_time(s2_o) and is_valid_time(s3_o) and s3_o > s2_o: c1_s2_s3 = (s3_o - s2_o) / 1000.0
        else: results["errors"].append("C1 S2->S3: Invalid S2/S3 open times.")
        if is_valid_time(s1_o) and is_valid_time(s3_o) and s3_o > s1_o: c1_s1_s3_total = (s3_o - s1_o) / 1000.0

        if is_valid_time(s1_c) and is_valid_time(s2_c) and s2_c > s1_c: c2_s1_s2 = (s2_c - s1_c) / 1000.0
        else: results["errors"].append("C2 S1->S2: Invalid S1/S2 close times.")
        if is_valid_time(s2_c) and is_valid_time(s3_c) and s3_c > s2_c: c2_s2_s3 = (s3_c - s2_c) / 1000.0
        else: results["errors"].append("C2 S2->S3: Invalid S2/S3 close times.")
        if is_valid_time(s1_c) and is_valid_time(s3_c) and s3_c > s1_c: c2_s1_s3_total = (s3_c - s1_c) / 1000.0

    elif mode_str == "OUTER":
        if is_valid_time(s1_o) and is_valid_time(s3_o) and s3_o > s1_o: c1_s1_s3_total = (s3_o - s1_o) / 1000.0
        else: results["errors"].append("C1 S1->S3 (Outer): Invalid S1/S3 open times.")
        if is_valid_time(s1_c) and is_valid_time(s3_c) and s3_c > s1_c: c2_s1_s3_total = (s3_c - s1_c) / 1000.0
        else: results["errors"].append("C2 S1->S3 (Outer): Invalid S1/S3 close times.")

    results["curtain1_travel_times_ms"] = {"s1_to_s2": c1_s1_s2, "s2_to_s3": c1_s2_s3, "s1_to_s3_total": c1_s1_s3_total}
    results["curtain2_travel_times_ms"] = {"s1_to_s2": c2_s1_s2, "s2_to_s3": c2_s2_s3, "s1_to_s3_total": c2_s1_s3_total}

    open_dur_ms = None
    if mode_str in ["ALL", "OUTER"]:
        if is_valid_time(s3_o) and is_valid_time(s1_c):
            if s1_c > s3_o: open_dur_ms = (s1_c - s3_o) / 1000.0
            else: open_dur_ms = 0.0 
        else: results["errors"].append("Cannot calculate shutter fully open duration: S1_close or S3_open missing/invalid for mode.")
    results["open_time_duration_ms"] = open_dur_ms
    
    avg_c1_speed_mps = None
    c1_total_travel_ms_for_speed = results["curtain1_travel_times_ms"]["s1_to_s3_total"]
    if c1_total_travel_ms_for_speed is not None and c1_total_travel_ms_for_speed > 0:
        dist_s1_s3_m = (DISTANCE_S1_S2_MM + DISTANCE_S2_S3_MM) / 1000.0
        if dist_s1_s3_m > 0 :
            time_s1_s3_open_s = c1_total_travel_ms_for_speed / 1000.0
            avg_c1_speed_mps = dist_s1_s3_m / time_s1_s3_open_s
        else: results["errors"].append("Sensor distance S1-S3 is zero, cannot calculate speed.")
    elif mode_str in ["ALL", "OUTER"]:
         results["errors"].append("Cannot calculate C1 avg speed: S1-S3 travel time unavailable.")

    results["average_slit_width_mm"] = None
    valid_exposures_s_list_for_slit = [exposures_s[s] for s in active_sensors_for_mode if exposures_s.get(s) is not None and exposures_s[s] > 0]
    avg_exposure_s_for_slit = None
    if valid_exposures_s_list_for_slit: 
        avg_exposure_s_for_slit = sum(valid_exposures_s_list_for_slit) / len(valid_exposures_s_list_for_slit)

    if mode_str in ["ALL", "OUTER"]:
        if open_dur_ms is not None and open_dur_ms > 0 :
             results["average_slit_width_mm"] = "N/A"
        elif avg_c1_speed_mps is not None and avg_exposure_s_for_slit is not None and avg_exposure_s_for_slit > 0:
            results["average_slit_width_mm"] = round(avg_c1_speed_mps * avg_exposure_s_for_slit * 1000.0, 2)
        else:
            if avg_c1_speed_mps is None: results["errors"].append("Slit width: Avg C1 speed unavailable.")
            if avg_exposure_s_for_slit is None or avg_exposure_s_for_slit <= 0 : results["errors"].append("Slit width: Avg exposure time unavailable/zero.")
    
    valid_exposures_for_consistency = [exposures_s[s] for s in active_sensors_for_mode if exposures_s.get(s) is not None]
    results["exposure_consistency_s_min_max_diff"] = None
    results["exposure_variation_percent_from_avg"] = None
    if len(valid_exposures_for_consistency) > 1 :
        results["exposure_consistency_s_min_max_diff"] = round(max(valid_exposures_for_consistency) - min(valid_exposures_for_consistency), 7)
        if sum(valid_exposures_for_consistency) > 0 :
             avg_exp_consistency = sum(valid_exposures_for_consistency) / len(valid_exposures_for_consistency)
             if avg_exp_consistency > 0:
                 max_dev_from_avg = max(abs(exp - avg_exp_consistency) for exp in valid_exposures_for_consistency)
                 results["exposure_variation_percent_from_avg"] = round((max_dev_from_avg / avg_exp_consistency) * 100.0, 2)
    elif len(valid_exposures_for_consistency) == 1 and mode_str == "INNER":
        results["exposure_variation_percent_from_avg"] = 0.0

    has_any_valid_exposure = any(exposures_ms.get(s) is not None for s in active_sensors_for_mode)
    if not has_any_valid_exposure and mode_str != "INNER":
        all_active_raw_invalid = True
        for s_label in active_sensors_for_mode:
            o_raw, c_raw = sensor_data_map[s_label]
            if is_valid_time(o_raw) or is_valid_time(c_raw):
                all_active_raw_invalid = False
                break
        if all_active_raw_invalid:
            results["errors"].append(f"No valid raw timestamps received for any active sensor in mode {mode_str}.")

    if "errors" in results: 
        unique_errors = []
        for e in results["errors"]:
            if e not in unique_errors: unique_errors.append(e)
        results["errors"] = unique_errors
        if not results["errors"]: del results["errors"]
    return results


def process_serial_shutter_data(data):
    global last_esp32_heartbeat_time
    last_esp32_heartbeat_time = time.time()

    mode_str = data.get('mode', "ALL").upper()
    if mode_str not in ["ALL", "OUTER", "INNER"]:
        logging.warning(f"Invalid mode '{mode_str}' received from serial. Defaulting to ALL.")
        mode_str = "ALL"

    s1_open_us = data.get('s1_open')
    s1_close_us = data.get('s1_close')
    s2_open_us = data.get('s2_open')
    s2_close_us = data.get('s2_close')
    s3_open_us = data.get('s3_open')
    s3_close_us = data.get('s3_close')
    
    timestamps_raw = [s1_open_us, s1_close_us, s2_open_us, s2_close_us, s3_open_us, s3_close_us]
    timestamps_processed = []

    for val in timestamps_raw:
        if val is None: 
            timestamps_processed.append(None)
        elif isinstance(val, (int, float)):
             timestamps_processed.append(int(val))
        else: 
            try:
                timestamps_processed.append(int(val))
            except (ValueError, TypeError):
                logging.error(f"Invalid data type for timestamp from serial: {val}. Treating as 0.")
                timestamps_processed.append(0)
    
    s1_o, s1_c, s2_o, s2_c, s3_o, s3_c = timestamps_processed
    calculated_metrics = calculate_shutter_data(s1_o, s1_c, s2_o, s2_c, s3_o, s3_c, mode_str)
    sse_payload = {"shutter_metrics": calculated_metrics}

    with client_queues_lock:
        for q_client in client_queues:
            try:
                q_client.put_nowait(sse_payload)
            except queue.Full:
                logging.warning("A client's SSE queue is full. Message dropped for that client.")

def serial_listener(port_to_use, baud_rate):
    global last_esp32_heartbeat_time, serial_connection_active, current_serial_port_in_use, stop_serial_thread_event, command_queue

    current_serial_port_in_use = port_to_use # Update what this thread is trying
    
    if not port_to_use:
        logging.info("Serial listener: No port specified. Thread idling.")
        serial_connection_active = False
        while not stop_serial_thread_event.is_set():
            stop_serial_thread_event.wait(timeout=1) # Check event periodically while idling
        logging.info(f"Serial listener for NULL port stopping as signaled.")
        current_serial_port_in_use = None
        return

    while not stop_serial_thread_event.is_set():
        serial_connection_active = False # Reset connection status at start of each attempt
        logging.info(f"Serial listener: Attempting to connect to ESP32 on {port_to_use} at {baud_rate} baud...")
        try:
            with serial.Serial(port_to_use, baud_rate, timeout=0.5) as ser: # timeout for ser.readline()
                logging.info(f"Serial listener: Successfully connected to ESP32 on {port_to_use}.")
                serial_connection_active = True
                current_serial_port_in_use = port_to_use # Confirm active port
                last_esp32_heartbeat_time = time.time() 
                
                while not stop_serial_thread_event.is_set():
                    if not ser.is_open:
                        logging.warning(f"Serial listener: Port {port_to_use} closed unexpectedly. Re-opening...")
                        serial_connection_active = False
                        break 
                    
                    line = None
                    try:
                        line_bytes = ser.readline() # This will block for timeout=0.5s
                        if stop_serial_thread_event.is_set(): break
                        if line_bytes:
                            line = line_bytes.decode('utf-8', errors='ignore').strip()
                    except serial.SerialException as read_se:
                        logging.error(f"Serial read error on {port_to_use}: {read_se}. Attempting to reconnect...")
                        serial_connection_active = False
                        break # Break inner loop to retry connection
                    except UnicodeDecodeError as ude:
                        logging.warning(f"Unicode decode error from serial on {port_to_use}: {ude}. Line: {line_bytes if 'line_bytes' in locals() else 'N/A'}")
                        continue # Try next line


                    if line:
                        logging.debug(f"Raw serial data from {port_to_use}: {line}")
                        try:
                            data = json.loads(line)
                            last_esp32_heartbeat_time = time.time()
                            data_type = data.get("type")

                            if data_type == "heartbeat":
                                logging.info(f"ESP32 Serial Heartbeat received on {port_to_use}.")
                            elif data_type == "shutter_data":
                                logging.info(f"Received serial shutter data on {port_to_use}: {data}")
                                process_serial_shutter_data(data)
                            elif data_type in ["log", "info", "debug", "warning", "error", "critical"]:
                                log_message = data.get("message", "No message content")
                                log_method_name = data_type 
                                if hasattr(logging, log_method_name) and callable(getattr(logging, log_method_name)):
                                    getattr(logging, log_method_name)(f"ESP32 LOG ({port_to_use}) [{log_method_name.upper()}]: {log_message}")
                                else:
                                    logging.info(f"ESP32 Unmapped Log ({port_to_use}) [Type: {data_type}]: {log_message}")
                            elif data_type == "mode_update":
                                new_mode = data.get("current_mode")
                                logging.info(f"ESP32 mode updated to: {new_mode} on {port_to_use}.")
                                sse_payload = {"esp32_mode_status": {"current_mode": new_mode}}
                                with client_queues_lock:
                                    for q_client in client_queues:
                                        try: q_client.put_nowait(sse_payload)
                                        except queue.Full: logging.warning("A client's SSE queue is full. Mode update message dropped.")
                            else:
                                logging.warning(f"Received unknown JSON data type from ESP32 on {port_to_use}: '{data_type}' in {data}")
                        
                        except json.JSONDecodeError:
                            if line.startswith("{") and line.endswith("}"): 
                                logging.warning(f"Could not decode JSON from serial ({port_to_use}): '{line}'")
                            else: 
                                logging.info(f"ESP32 Serial (plaintext on {port_to_use}): {line}")
                    # else: timeout occurred, loop and check stop_event

                    # Check for commands to send to ESP32
                    if ser.is_open: 
                        try:
                            command_to_send = command_queue.get_nowait() 
                            ser.write(command_to_send.encode('utf-8'))
                            logging.info(f"Sent command to ESP32 on {port_to_use}: {command_to_send.strip()}")
                            command_queue.task_done()
                        except queue.Empty:
                            pass 
                        except serial.SerialException as write_se:
                            logging.error(f"Serial write error on {port_to_use}: {write_se}. Command '{command_to_send.strip() if 'command_to_send' in locals() else 'N/A'}' may not have been sent.")
                        except Exception as e_write:
                            logging.error(f"Unexpected error writing to serial port {port_to_use}: {e_write}", exc_info=True)
                    else: 
                        if not command_queue.empty():
                            logging.warning(f"Serial port {port_to_use} not open. Commands are queued but not being sent.")
                            pass



            # After 'with serial.Serial' block (port closed or error) or if ser.is_open became false
            if stop_serial_thread_event.is_set():
                 logging.info(f"Serial listener for {port_to_use} stopping (after 'with' block or ser.is_open false).")
                 break # Exit outer while loop

        except serial.SerialException as e:
            logging.error(f"Serial listener: Could not open serial port {port_to_use}: {e}")
            serial_connection_active = False # Ensure it's false
        except Exception as e:
            logging.error(f"Serial listener: Unexpected error in outer loop for {port_to_use}: {e}", exc_info=True)
            serial_connection_active = False # Ensure it's false
        
        if stop_serial_thread_event.is_set():
            logging.info(f"Serial listener for {port_to_use} stopping due to event (outer loop bottom).")
            break
        
        logging.info(f"Serial listener: Waiting 5 seconds before retrying connection on {port_to_use} (or exiting if signaled)...")
        stop_serial_thread_event.wait(timeout=5.0) # Interruptible sleep
    
    serial_connection_active = False
    if port_to_use == current_serial_port_in_use : # Only clear if this thread was the one for the active port
        current_serial_port_in_use = None
    logging.info(f"Serial listener thread for {port_to_use if port_to_use else 'NULL port'} has finished.")

def start_serial_listener_thread():
    global serial_reader_thread_instance, SERIAL_PORT, SERIAL_BAUD_RATE, stop_serial_thread_event, serial_connection_active, current_serial_port_in_use, command_queue
    
    logging.info("start_serial_listener_thread called.")
    if serial_reader_thread_instance and serial_reader_thread_instance.is_alive():
        logging.info(f"Existing serial listener thread for '{current_serial_port_in_use}' found. Signalling stop...")
        stop_serial_thread_event.set()
        serial_reader_thread_instance.join(timeout=7.0) # Wait with timeout
        if serial_reader_thread_instance.is_alive():
            logging.warning(f"Serial listener thread for '{current_serial_port_in_use}' did not stop in time!")
        else:
            logging.info(f"Serial listener thread for '{current_serial_port_in_use}' stopped.")
    
    # Clear any pending commands for the old/disconnected port
    while not command_queue.empty():
        try:
            stale_cmd = command_queue.get_nowait()
            logging.info(f"Discarding stale command due to port change/restart: {stale_cmd.strip()}")
            command_queue.task_done()
        except queue.Empty:
            break
    stop_serial_thread_event.clear() 
    serial_connection_active = False # Reset as we are starting anew
    # current_serial_port_in_use will be set by the new thread itself
    
    logging.info(f"Preparing to start new serial listener for target port: '{SERIAL_PORT if SERIAL_PORT else 'None'}'.")
    serial_reader_thread_instance = threading.Thread(
        target=serial_listener, 
        args=(SERIAL_PORT, SERIAL_BAUD_RATE), # Pass the current global target port
        daemon=True
    )
    serial_reader_thread_instance.start()
    logging.info(f"New serial listener thread (re)started for target port '{SERIAL_PORT if SERIAL_PORT else 'None'}'.")


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/get_com_ports', methods=['GET'])
def get_com_ports():
    ports = serial.tools.list_ports.comports()
    port_list = [port.device for port in ports]
    logging.info(f"Available COM ports: {port_list}")
    return jsonify({"ports": port_list})

@app.route('/set_com_port', methods=['POST'])
def set_com_port_route():
    global SERIAL_PORT, serial_connection_active, last_esp32_heartbeat_time
    
    data = request.get_json()
    new_port_target = data.get('port')

    if not new_port_target or new_port_target == "null" or new_port_target == "None":
        new_port_target = None
        logging.info("Request to set COM port to None (disconnect).")
    else:
        if not isinstance(new_port_target, str):
            return jsonify({"status": "error", "message": "Invalid port format."}), 400
        logging.info(f"Request to set COM port to: {new_port_target}")

    if new_port_target == SERIAL_PORT:
        message = f"Port already targeted to {SERIAL_PORT or 'None'}."
        logging.info(message)
        return jsonify({"status": "no_change", "message": message})

    SERIAL_PORT = new_port_target # Update global TARGET port
    
    # Reset status flags immediately. serial_listener will update them.
    serial_connection_active = False
    last_esp32_heartbeat_time = 0 

    start_serial_listener_thread() # This will handle stopping old and starting new listener

    return jsonify({"status": "success", "message": f"Target port set to {SERIAL_PORT or 'None'}. Serial listener restarting."})

@app.route('/set_mode', methods=['POST'])
def set_esp_mode():
    global command_queue, serial_connection_active
    data = request.get_json()
    mode_id = data.get('mode')

    if mode_id is None or not isinstance(mode_id, int) or not (0 <= mode_id <= 2):
        return jsonify({"status": "error", "message": "Invalid mode ID."}), 400

    if not serial_connection_active or SERIAL_PORT is None:
         return jsonify({"status": "error", "message": f"ESP32 not connected on {SERIAL_PORT or 'any port'}. Cannot set mode."}), 503

    command_str = f"M{mode_id}\n"
    try:
        command_queue.put(command_str)
        logging.info(f"Queued command for ESP32: {command_str.strip()}")
        return jsonify({"status": "success", "message": f"Mode change command {mode_id} queued."})
    except Exception as e:
        logging.error(f"Error queueing mode change command: {e}")
        return jsonify({"status": "error", "message": "Failed to queue mode change command."}), 500


@app.route('/stream')
def stream():
    def event_stream():
        my_queue = queue.Queue(maxsize=10)
        with client_queues_lock:
            client_queues.append(my_queue)
        logging.info(f"Client connected to SSE stream. Total clients: {len(client_queues)}")

        try:
            # Send initial status immediately
            # This logic is duplicated below for periodic updates
            current_time_init = time.time()
            esp32_is_online_heartbeat_init = serial_connection_active and \
                                       (last_esp32_heartbeat_time > 0) and \
                                       (current_time_init - last_esp32_heartbeat_time < ESP32_HEARTBEAT_TIMEOUT_SECONDS)
            effective_online_status_init = serial_connection_active and esp32_is_online_heartbeat_init and (SERIAL_PORT is not None)
            
            status_text_init = "Initializing..."
            if SERIAL_PORT is None:
                status_text_init = "Select COM Port"
            elif not serial_connection_active:
                status_text_init = f"Connecting to {SERIAL_PORT}..."
            elif serial_connection_active:
                if not esp32_is_online_heartbeat_init:
                    status_text_init = f"Connected to {SERIAL_PORT}. Awaiting data..." if last_esp32_heartbeat_time == 0 else f"ESP32 unresponsive on {SERIAL_PORT}"
                else:
                    status_text_init = f"ESP32 Online ({SERIAL_PORT})"

            initial_payload = {
                "esp32_connection": {
                    "online": effective_online_status_init,
                    "last_seen_timestamp": last_esp32_heartbeat_time if last_esp32_heartbeat_time > 0 else None,
                    "status_text": status_text_init,
                    "current_port": SERIAL_PORT,
                    "active_port": current_serial_port_in_use
                }
            }
            # Also try to send initial mode if we have it (e.g. if ESP32 sends it right on connect)
            # This is a bit tricky as mode is usually reported by ESP32 after connection.
            # For now, the frontend will update it when it receives the first mode_update SSE.
            yield f"data: {json.dumps(initial_payload)}\n\n"


            while True:
                shutter_payload_from_queue = None
                try:
                    shutter_payload_from_queue = my_queue.get(block=True, timeout=1) 
                    if shutter_payload_from_queue:
                         my_queue.task_done()
                except queue.Empty:
                    pass 

                current_time = time.time()
                esp32_is_online_heartbeat = serial_connection_active and \
                                  (last_esp32_heartbeat_time > 0) and \
                                  (current_time - last_esp32_heartbeat_time < ESP32_HEARTBEAT_TIMEOUT_SECONDS)
                
                effective_online_status = serial_connection_active and esp32_is_online_heartbeat and (SERIAL_PORT is not None)
                status_text = "N/A"

                if SERIAL_PORT is None:
                    status_text = "Select COM Port"
                elif not serial_connection_active:
                    if current_serial_port_in_use == SERIAL_PORT and SERIAL_PORT is not None: # Actively trying the target port
                        status_text = f"Connecting to {SERIAL_PORT}..."
                    elif current_serial_port_in_use is not None and SERIAL_PORT is not None: # Thread is on an old port, switching
                        status_text = f"Switching from {current_serial_port_in_use} to {SERIAL_PORT}..."
                    elif SERIAL_PORT is not None: # Target port is set, but thread might be starting or failed on it
                        status_text = f"Attempting {SERIAL_PORT}..."
                    else: # SERIAL_PORT is not None, but current_serial_port_in_use is None (thread starting up)
                        status_text = f"Initializing for {SERIAL_PORT}..."
                elif serial_connection_active: # Port is open (current_serial_port_in_use should match SERIAL_PORT)
                    if not esp32_is_online_heartbeat:
                         if last_esp32_heartbeat_time == 0:
                            status_text = f"Connected to {SERIAL_PORT}. Awaiting data..."
                         else:
                            status_text = f"ESP32 unresponsive on {SERIAL_PORT} (Last seen: {time.strftime('%H:%M:%S', time.localtime(last_esp32_heartbeat_time))})"
                    else:
                         status_text = f"ESP32 Online ({SERIAL_PORT})"
                
                esp32_status_payload = {
                    "esp32_connection": {
                        "online": effective_online_status,
                        "last_seen_timestamp": last_esp32_heartbeat_time if last_esp32_heartbeat_time > 0 else None,
                        "status_text": status_text,
                        "current_port": SERIAL_PORT, 
                        "active_port": current_serial_port_in_use
                    }
                }

                final_payload = {}
                if shutter_payload_from_queue: # This can be shutter_metrics OR esp32_mode_status
                    final_payload.update(shutter_payload_from_queue)
                
                # Always include esp32_connection status
                final_payload.update(esp32_status_payload) 
                
                yield f"data: {json.dumps(final_payload)}\n\n"

        except GeneratorExit:
            logging.info("Client disconnected from SSE stream (GeneratorExit).")
        except Exception as e:
            logging.error(f"Error in SSE stream: {e}", exc_info=True)
        finally:
            with client_queues_lock:
                if my_queue in client_queues: 
                    client_queues.remove(my_queue)
            logging.info(f"Cleaned up client queue. Total clients remaining: {len(client_queues)}")

    return Response(event_stream(), mimetype="text/event-stream")


if __name__ == '__main__':
    import os
    if not os.path.exists('templates'):
        os.makedirs('templates')
    if not os.path.exists('templates/index.html'):
        logging.error("templates/index.html not found. Please create it.")
        with open('templates/index.html', 'w') as f:
            f.write("<h1>Error: templates/index.html is missing.</h1>")
    
    logging.info("--- Serial Port Information ---")
    logging.info("Available serial ports will be fetched by the client UI.")
    logging.info("-------------------------------")

    SERIAL_PORT = None # Ensure starts with no port selected
    start_serial_listener_thread() # Start the listener (it will idle if SERIAL_PORT is None)
    
    logging.info(f"Starting Flask server on http://0.0.0.0:5000. ESP32 Heartbeat Timeout: {ESP32_HEARTBEAT_TIMEOUT_SECONDS}s")
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True, use_reloader=False)