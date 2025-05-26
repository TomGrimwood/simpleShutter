#ifndef SHUTTER_SENSOR_H
#define SHUTTER_SENSOR_H

#include "driver/gpio.h"
#include "esp_types.h" // For inttypes.h -> uint32_t etc.

// --- Sensor Pins (from .ino, already ESP-IDF style) ---
#define SENSOR_1_PIN GPIO_NUM_34
#define SENSOR_2_PIN GPIO_NUM_35
#define SENSOR_3_PIN GPIO_NUM_32
#define LED_PIN GPIO_NUM_2 // ESP32 built-in LED

// --- IR LED Pins (from .ino) ---
#define IR_LED_S1_PIN GPIO_NUM_33
#define IR_LED_S2_PIN GPIO_NUM_25
#define IR_LED_S3_PIN GPIO_NUM_26

// --- Mode Definitions ---
typedef enum {
  MODE_ALL_SENSORS = 0,
  MODE_OUTER_SENSORS = 1,
  MODE_INNER_SENSOR = 2
} measurement_mode_t;

// --- State Definitions (per sensor) ---
typedef enum {
  SENSOR_IDLE,
  SENSOR_AWAITING_CLOSE,
  SENSOR_CLOSED
} sensor_operational_state_t;

// --- Struct for Shutter Data Payload ---
typedef struct {
  measurement_mode_t mode;
  uint64_t s1_open_us;
  uint64_t s1_close_us;
  uint64_t s2_open_us;
  uint64_t s2_close_us;
  uint64_t s3_open_us;
  uint64_t s3_close_us;
  // Calculated values (optional, can be done by JS or firmware task)
  // uint64_t exposure_s1_us;
  // uint64_t exposure_s2_us;
  // uint64_t exposure_s3_us;
  // uint64_t travel_1_2_us;
  // uint64_t travel_2_3_us;
} shutter_data_values_t;


// --- Function Prototypes ---
void shutter_sensor_init(void);
void shutter_sensor_set_mode(measurement_mode_t new_mode);
void shutter_sensor_reset_all_idle(void);
void shutter_sensor_get_data(shutter_data_values_t* data_out); // Gets current raw times and mode
bool shutter_sensor_is_measurement_complete(void); // Checks if current mode's sensors are all CLOSED
measurement_mode_t shutter_sensor_get_current_mode(void); // Gets current mode
void shutter_sensor_get_raw_times(uint64_t* s1_o, uint64_t* s1_c, uint64_t* s2_o, uint64_t* s2_c, uint64_t* s3_o, uint64_t* s3_c);
void shutter_sensor_get_states(sensor_operational_state_t* st1, sensor_operational_state_t* st2, sensor_operational_state_t* st3);
bool shutter_sensor_is_active(uint8_t sensor_gpio, measurement_mode_t mode_to_check); // Check if a sensor is active in a given mode


#endif // SHUTTER_SENSOR_H
