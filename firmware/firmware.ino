
// --- Sensor Pins ---
#define SENSOR_1_PIN GPIO_NUM_34
#define SENSOR_2_PIN GPIO_NUM_35
#define SENSOR_3_PIN GPIO_NUM_32
#define LED_PIN 2  // ESP32 built-in LED for status and mode blinks

// --- IR LED Pins ---
#define IR_LED_S1_PIN GPIO_NUM_33
#define IR_LED_S2_PIN GPIO_NUM_25
#define IR_LED_S3_PIN GPIO_NUM_26

#define VERSION "3.4.0-Serial-MultiModeV1"  // Updated version

// --- Mode Definitions ---
typedef enum {
  MODE_ALL_SENSORS,
  MODE_OUTER_SENSORS,
  MODE_INNER_SENSOR
} measurement_mode_t;
volatile measurement_mode_t current_mode = MODE_ALL_SENSORS;

// --- State Definitions (per sensor) ---
typedef enum {
  SENSOR_IDLE,
  SENSOR_AWAITING_CLOSE,
  SENSOR_CLOSED
} sensor_operational_state_t;

// --- Global Variables for Sensor Data ---
volatile sensor_operational_state_t sensor1_state = SENSOR_IDLE;
volatile sensor_operational_state_t sensor2_state = SENSOR_IDLE;
volatile sensor_operational_state_t sensor3_state = SENSOR_IDLE;

volatile unsigned long sensor1_open_time_us = 0;
volatile unsigned long sensor1_close_time_us = 0;
volatile unsigned long sensor2_open_time_us = 0;
volatile unsigned long sensor2_close_time_us = 0;
volatile unsigned long sensor3_open_time_us = 0;
volatile unsigned long sensor3_close_time_us = 0;

// --- Active Sensor Flags (determined by current_mode) ---
volatile bool is_sensor1_active = true;
volatile bool is_sensor2_active = true;
volatile bool is_sensor3_active = true;

// --- Serial Heartbeat Timing ---
unsigned long last_serial_heartbeat_sent_time = 0;
const unsigned long serial_heartbeat_interval = 10000;  // Send heartbeat every 10 seconds

// --- Function Prototypes ---
void update_mode_dependent_config();
void perform_mode_blink(int num_blinks);
void reset_all_sensors_to_idle();

void reset_all_sensors_to_idle() {
  noInterrupts();
  sensor1_state = SENSOR_IDLE;
  sensor2_state = SENSOR_IDLE;
  sensor3_state = SENSOR_IDLE;
  interrupts();

  // Plain text log, Python will show this as "ESP32 Serial (plaintext): ..."
  Serial.println("System reset: All sensors IDLE and ready for new measurement.");
  digitalWrite(LED_PIN, HIGH);
}

void perform_mode_blink(int num_blinks) {
  for (int i = 0; i < num_blinks; i++) {
    digitalWrite(LED_PIN, LOW);
    delay(150);
    digitalWrite(LED_PIN, HIGH);
    delay(150);
  }
  delay(300);
}

void update_mode_dependent_config() {
  measurement_mode_t mode_to_set;
  noInterrupts();
  mode_to_set = current_mode;
  interrupts();

  char log_msg_buffer[100];        // For JSON log messages
  const char* mode_name_for_json;  // For mode_update JSON

  switch (mode_to_set) {
    case MODE_ALL_SENSORS:
      is_sensor1_active = true;
      is_sensor2_active = true;
      is_sensor3_active = true;
      digitalWrite(IR_LED_S1_PIN, HIGH);
      digitalWrite(IR_LED_S2_PIN, HIGH);
      digitalWrite(IR_LED_S3_PIN, HIGH);
      mode_name_for_json = "ALL";
      sprintf(log_msg_buffer, "{\"type\":\"info\", \"message\":\"Mode set: ALL SENSORS (S1, S2, S3).\"}");
      Serial.println(log_msg_buffer);
      perform_mode_blink(3);
      break;
    case MODE_OUTER_SENSORS:
      is_sensor1_active = true;
      is_sensor2_active = false;
      is_sensor3_active = true;
      digitalWrite(IR_LED_S1_PIN, HIGH);
      digitalWrite(IR_LED_S2_PIN, LOW);
      digitalWrite(IR_LED_S3_PIN, HIGH);
      mode_name_for_json = "OUTER";
      sprintf(log_msg_buffer, "{\"type\":\"info\", \"message\":\"Mode set: OUTER SENSORS (S1, S3).\"}");
      Serial.println(log_msg_buffer);
      perform_mode_blink(2);
      break;
    case MODE_INNER_SENSOR:
      is_sensor1_active = false;
      is_sensor2_active = true;
      is_sensor3_active = false;
      digitalWrite(IR_LED_S1_PIN, LOW);
      digitalWrite(IR_LED_S2_PIN, HIGH);
      digitalWrite(IR_LED_S3_PIN, LOW);
      mode_name_for_json = "INNER";
      sprintf(log_msg_buffer, "{\"type\":\"info\", \"message\":\"Mode set: INNER SENSOR (S2).\"}");
      Serial.println(log_msg_buffer);
      perform_mode_blink(1);
      break;
    default:  // Should not happen
      mode_name_for_json = "UNKNOWN";
      sprintf(log_msg_buffer, "{\"type\":\"error\", \"message\":\"Mode set: UNKNOWN MODE (%d).\"}", mode_to_set);
      Serial.println(log_msg_buffer);
      perform_mode_blink(5);  // Error blink
      break;
  }

  // Send mode update confirmation JSON
  char mode_update_json[100];
  sprintf(mode_update_json, "{\"type\":\"mode_update\", \"current_mode\":\"%s\"}", mode_name_for_json);
  Serial.println(mode_update_json);

  reset_all_sensors_to_idle();
}

void IRAM_ATTR sensor1_isr() {
  if (!is_sensor1_active) return;
  unsigned long current_micros = micros();
  if (digitalRead(SENSOR_1_PIN) == HIGH) {
    sensor1_open_time_us = current_micros;
    sensor1_state = SENSOR_AWAITING_CLOSE;
    if (current_mode == MODE_ALL_SENSORS) {
      if (is_sensor2_active) sensor2_state = SENSOR_IDLE;
      if (is_sensor3_active) sensor3_state = SENSOR_IDLE;
    } else if (current_mode == MODE_OUTER_SENSORS) {
      if (is_sensor3_active) sensor3_state = SENSOR_IDLE;
    }
  } else {
    if (sensor1_state == SENSOR_AWAITING_CLOSE) {
      sensor1_close_time_us = current_micros;
      sensor1_state = SENSOR_CLOSED;
    }
  }
}

void IRAM_ATTR sensor2_isr() {
  if (!is_sensor2_active) return;
  unsigned long current_micros = micros();
  if (digitalRead(SENSOR_2_PIN) == HIGH) {
    if (current_mode == MODE_ALL_SENSORS) {
      if ((sensor1_state == SENSOR_AWAITING_CLOSE || sensor1_state == SENSOR_CLOSED) && sensor2_state == SENSOR_IDLE) {
        sensor2_open_time_us = current_micros;
        sensor2_state = SENSOR_AWAITING_CLOSE;
        if (is_sensor3_active) sensor3_state = SENSOR_IDLE;
      }
    } else if (current_mode == MODE_INNER_SENSOR) {
      if (sensor2_state == SENSOR_IDLE) {
        sensor2_open_time_us = current_micros;
        sensor2_state = SENSOR_AWAITING_CLOSE;
      } else if (sensor2_state == SENSOR_AWAITING_CLOSE || sensor2_state == SENSOR_CLOSED) {
        sensor2_open_time_us = current_micros;
        sensor2_state = SENSOR_AWAITING_CLOSE;
      }
    }
  } else {
    if (sensor2_state == SENSOR_AWAITING_CLOSE) {
      sensor2_close_time_us = current_micros;
      sensor2_state = SENSOR_CLOSED;
    }
  }
}

void IRAM_ATTR sensor3_isr() {
  if (!is_sensor3_active) return;
  unsigned long current_micros = micros();
  if (digitalRead(SENSOR_3_PIN) == HIGH) {
    if (current_mode == MODE_ALL_SENSORS) {
      if ((sensor2_state == SENSOR_AWAITING_CLOSE || sensor2_state == SENSOR_CLOSED) && sensor3_state == SENSOR_IDLE) {
        sensor3_open_time_us = current_micros;
        sensor3_state = SENSOR_AWAITING_CLOSE;
      }
    } else if (current_mode == MODE_OUTER_SENSORS) {
      if ((sensor1_state == SENSOR_AWAITING_CLOSE || sensor1_state == SENSOR_CLOSED) && sensor3_state == SENSOR_IDLE) {
        sensor3_open_time_us = current_micros;
        sensor3_state = SENSOR_AWAITING_CLOSE;
      }
    }
  } else {
    if (sensor3_state == SENSOR_AWAITING_CLOSE) {
      sensor3_close_time_us = current_micros;
      sensor3_state = SENSOR_CLOSED;
    }
  }
}

// --- Helper Functions for Printing (Local Serial Debug - will be caught by Python) ---
void print_curtain_travel_time(long t1_us, long t2_us, long t3_us) {
  if (t1_us == 0 || t2_us == 0 || t3_us == 0 || t2_us <= t1_us || t3_us <= t2_us) {
    Serial.println("  Local Debug: Travel times: Incomplete or invalid data for S1-S2-S3 sequence");
    return;
  }
  long travel_1_2_us = t2_us - t1_us;
  long travel_2_3_us = t3_us - t2_us;
  Serial.print("  Local Debug: 1->2: ");
  Serial.print(travel_1_2_us);
  Serial.print(" uS  |  ");
  Serial.print("2->3: ");
  Serial.print(travel_2_3_us);
  Serial.println(" uS");
}
void print_outer_travel_time(long s1_time_us, long s3_time_us) {
  if (s1_time_us == 0 || s3_time_us == 0 || s3_time_us <= s1_time_us) {
    Serial.println("  Local Debug: S1->S3 Travel time: Incomplete or invalid data");
    return;
  }
  long travel_1_3_us = s3_time_us - s1_time_us;
  Serial.print("  Local Debug: S1->S3: ");
  Serial.print(travel_1_3_us);
  Serial.println(" uS");
}
void print_exposure_at_sensor(long open_us, long close_us) {
  if (open_us == 0 || close_us == 0 || close_us <= open_us) {
    Serial.println("  Local Debug: Exposure: Invalid or incomplete data");
    return;
  }
  long interval_us = close_us - open_us;
  Serial.print("  Local Debug: Exposure: ");
  Serial.print(interval_us);
  Serial.print(" uS (");

  float milliseconds = interval_us / 1000.0f;
  Serial.print(milliseconds, 3);
  Serial.print(" ms)  |  ");

  if (interval_us > 0) {
    float seconds = interval_us / 1000000.0f;
    long inverse_s = round(1.0f / seconds);
    Serial.print("~1/");
    Serial.print(inverse_s);
    Serial.println(" s");
  } else {
    Serial.println("N/A s");
  }
}
void print_measurement_summary() {
  Serial.println("\n--- Local Debug: Measurement Summary ---");
  measurement_mode_t mode_copy;
  noInterrupts();
  mode_copy = current_mode;
  interrupts();

  unsigned long s1_o_print = sensor1_open_time_us;
  unsigned long s1_c_print = sensor1_close_time_us;
  unsigned long s2_o_print = sensor2_open_time_us;
  unsigned long s2_c_print = sensor2_close_time_us;
  unsigned long s3_o_print = sensor3_open_time_us;
  unsigned long s3_c_print = sensor3_close_time_us;

  if (mode_copy == MODE_OUTER_SENSORS) {
    s2_o_print = 0;
    s2_c_print = 0;
    Serial.println("Curtain 1 (Opening Edge) Travel Times (S1->S3):");
    print_outer_travel_time(s1_o_print, s3_o_print);
    Serial.println("Curtain 2 (Closing Edge) Travel Times (S1->S3):");
    print_outer_travel_time(s1_c_print, s3_c_print);
  } else if (mode_copy == MODE_INNER_SENSOR) {
    s1_o_print = 0;
    s1_c_print = 0;
    s3_o_print = 0;
    s3_c_print = 0;
    Serial.println("Travel times not applicable for single sensor mode.");
  } else {
    Serial.println("Curtain 1 (Opening Edge) Travel Times (S1-S2-S3):");
    print_curtain_travel_time(s1_o_print, s2_o_print, s3_o_print);
    Serial.println("Curtain 2 (Closing Edge) Travel Times (S1-S2-S3):");
    print_curtain_travel_time(s1_c_print, s2_c_print, s3_c_print);
  }

  Serial.println("\nExposure Times at Each Sensor:");
  if (is_sensor1_active) {
    Serial.print("Sensor 1 (Top):");
    print_exposure_at_sensor(s1_o_print, s1_c_print);
  }
  if (is_sensor2_active) {
    Serial.print("Sensor 2 (Mid):");
    print_exposure_at_sensor(s2_o_print, s2_c_print);
  }
  if (is_sensor3_active) {
    Serial.print("Sensor 3 (Bottom):");
    print_exposure_at_sensor(s3_o_print, s3_c_print);
  }
  Serial.println("------------------------------------");
}

// --- Main Setup ---
void setup() {
  Serial.begin(115200);  // Baud rate for serial communication
  while (!Serial)
    ;
  Serial.println("{\"type\":\"info\", \"message\":\"ESP32 Shutter Speed Tester - Serial Mode Initializing...\"}");

  char version_msg[100];
  sprintf(version_msg, "{\"type\":\"info\", \"message\":\"Version: %s\"}", VERSION);
  Serial.println(version_msg);


  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  pinMode(IR_LED_S1_PIN, OUTPUT);
  pinMode(IR_LED_S2_PIN, OUTPUT);
  pinMode(IR_LED_S3_PIN, OUTPUT);

  pinMode(SENSOR_1_PIN, INPUT_PULLUP);
  pinMode(SENSOR_2_PIN, INPUT_PULLUP);
  pinMode(SENSOR_3_PIN, INPUT_PULLUP);

  attachInterrupt(digitalPinToInterrupt(SENSOR_1_PIN), sensor1_isr, CHANGE);
  attachInterrupt(digitalPinToInterrupt(SENSOR_2_PIN), sensor2_isr, CHANGE);
  attachInterrupt(digitalPinToInterrupt(SENSOR_3_PIN), sensor3_isr, CHANGE);

  update_mode_dependent_config();

  Serial.println("{\"type\":\"info\", \"message\":\"Setup complete. Waiting for shutter event...\"}");
}

// --- Main Loop ---
void loop() {
  // --- Serial Heartbeat ---
  if (millis() - last_serial_heartbeat_sent_time > serial_heartbeat_interval) {
    Serial.println("{\"type\":\"heartbeat\"}");
    last_serial_heartbeat_sent_time = millis();
  }

  bool measurement_in_progress_local = false;
  noInterrupts();
  if ((is_sensor1_active && sensor1_state == SENSOR_AWAITING_CLOSE) || (is_sensor2_active && sensor2_state == SENSOR_AWAITING_CLOSE) || (is_sensor3_active && sensor3_state == SENSOR_AWAITING_CLOSE)) {
    measurement_in_progress_local = true;
  }
  interrupts();

  if (measurement_in_progress_local) {
    digitalWrite(LED_PIN, LOW);
  } else {
    noInterrupts();
    bool all_relevant_sensors_idle = true;
    if (is_sensor1_active && sensor1_state != SENSOR_IDLE) all_relevant_sensors_idle = false;
    if (is_sensor2_active && sensor2_state != SENSOR_IDLE) all_relevant_sensors_idle = false;
    if (is_sensor3_active && sensor3_state != SENSOR_IDLE) all_relevant_sensors_idle = false;
    interrupts();
    if (all_relevant_sensors_idle) {
      digitalWrite(LED_PIN, HIGH);
    }
  }

  bool measurement_complete = false;
  measurement_mode_t mode_copy_loop;
  noInterrupts();
  mode_copy_loop = current_mode;
  switch (mode_copy_loop) {
    case MODE_ALL_SENSORS:
      if (sensor1_state == SENSOR_CLOSED && sensor2_state == SENSOR_CLOSED && sensor3_state == SENSOR_CLOSED) {
        measurement_complete = true;
      }
      break;
    case MODE_OUTER_SENSORS:
      if (sensor1_state == SENSOR_CLOSED && sensor3_state == SENSOR_CLOSED) {
        measurement_complete = true;
      }
      break;
    case MODE_INNER_SENSOR:
      if (sensor2_state == SENSOR_CLOSED) {
        measurement_complete = true;
      }
      break;
  }
  interrupts();

  if (measurement_complete) {
    digitalWrite(LED_PIN, LOW);

    unsigned long s1_o, s1_c, s2_o, s2_c, s3_o, s3_c;
    const char* mode_str_tosend;

    noInterrupts();
    s1_o = sensor1_open_time_us;
    s1_c = sensor1_close_time_us;
    s2_o = sensor2_open_time_us;
    s2_c = sensor2_close_time_us;
    s3_o = sensor3_open_time_us;
    s3_c = sensor3_close_time_us;
    measurement_mode_t final_mode_check = current_mode;
    interrupts();

    switch (final_mode_check) {
      case MODE_ALL_SENSORS: mode_str_tosend = "ALL"; break;
      case MODE_OUTER_SENSORS:
        mode_str_tosend = "OUTER";
        s2_o = 0;
        s2_c = 0;
        break;
      case MODE_INNER_SENSOR:
        mode_str_tosend = "INNER";
        s1_o = 0;
        s1_c = 0;
        s3_o = 0;
        s3_c = 0;
        break;
      default: mode_str_tosend = "UNKNOWN"; break;
    }

    print_measurement_summary();  // For local debug (will show up in Python logs as non-JSON)

    bool has_valid_data_to_send = false;
    if ((is_sensor1_active && s1_o > 0 && s1_c > s1_o) || (is_sensor2_active && s2_o > 0 && s2_c > s2_o) || (is_sensor3_active && s3_o > 0 && s3_c > s3_o)) {
      has_valid_data_to_send = true;
    }

    if (has_valid_data_to_send) {
      char json_payload[350];
      sprintf(json_payload,
              "{\"type\":\"shutter_data\", \"mode\":\"%s\", \"s1_open\":%lu, \"s1_close\":%lu, \"s2_open\":%lu, \"s2_close\":%lu, \"s3_open\":%lu, \"s3_close\":%lu}",
              mode_str_tosend, s1_o, s1_c, s2_o, s2_c, s3_o, s3_c);
      Serial.println(json_payload);  // Send data over Serial as JSON
      // Serial.println("{\"type\":\"info\", \"message\":\"Shutter data sent over serial.\"}"); // Optional JSON log
    } else {
      Serial.println("{\"type\":\"warning\", \"message\":\"No valid sensor data to send over serial.\"}");
    }

    reset_all_sensors_to_idle();
  }

  // --- Handle Incoming Serial Commands ---
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command.startsWith("M")) {
      int mode_val = command.substring(1).toInt();
      if (mode_val >= 0 && mode_val < 3) {
        measurement_mode_t new_mode = (measurement_mode_t)mode_val;
        bool needs_update = false;
        noInterrupts();
        if (current_mode != new_mode) {
          current_mode = new_mode;
          needs_update = true;
        }
        interrupts();

        if (needs_update) {
          char log_msg[100];
          sprintf(log_msg, "{\"type\":\"info\", \"message\":\"Mode change command via Serial: M%d. Updating.\"}", mode_val);
          Serial.println(log_msg);
          update_mode_dependent_config();
        } else {
          char log_msg[100];
          sprintf(log_msg, "{\"type\":\"info\", \"message\":\"Mode change command via Serial: M%d. Already in this mode.\"}", mode_val);
          Serial.println(log_msg);
        }
      } else {
        char log_msg[100];
        sprintf(log_msg, "{\"type\":\"warning\", \"message\":\"Invalid mode value in command: %s\"}", command.c_str());
        Serial.println(log_msg);
      }
    } else if (command == "r" || command == "R") {
      Serial.println("{\"type\":\"info\", \"message\":\"Manual reset via Serial command.\"}");
      reset_all_sensors_to_idle();
    } else if (command.length() > 0) {
      char log_msg[100];
      sprintf(log_msg, "{\"type\":\"warning\", \"message\":\"Unknown serial command: %s\"}", command.c_str());
      Serial.println(log_msg);
    }
  }
  delay(10);
}