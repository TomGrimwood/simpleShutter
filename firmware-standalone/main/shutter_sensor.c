#include "shutter_sensor.h"
#include "esp_log.h"
#include "esp_timer.h" // For esp_timer_get_time()
#include <string.h>    // For memset

#include "freertos/FreeRTOS.h" // For portMUX_TYPE, critical section macros (indirectly)
#include "freertos/portmacro.h"  // For portENTER_CRITICAL_SAFE, portEXIT_CRITICAL_SAFE, etc.
#include "esp_attr.h"          // For IRAM_ATTR
#include "rom/ets_sys.h"       // For ets_printf, often included with FreeRTOS or IDF components


static const char *TAG = "shutter_sensor";

// --- Global Variables for Sensor Data (mirrors .ino, needs thread safety later) ---
static volatile sensor_operational_state_t sensor1_state = SENSOR_IDLE;
static volatile sensor_operational_state_t sensor2_state = SENSOR_IDLE;
static volatile sensor_operational_state_t sensor3_state = SENSOR_IDLE;

static volatile uint64_t sensor1_open_time_us = 0;
static volatile uint64_t sensor1_close_time_us = 0;
static volatile uint64_t sensor2_open_time_us = 0;
static volatile uint64_t sensor2_close_time_us = 0;
static volatile uint64_t sensor3_open_time_us = 0;
static volatile uint64_t sensor3_close_time_us = 0;

static volatile measurement_mode_t current_mode = MODE_ALL_SENSORS;
static volatile bool is_sensor1_active = true;
static volatile bool is_sensor2_active = true;
static volatile bool is_sensor3_active = true;

// Placeholder for proper critical section. ESP-IDF uses portMUX_TYPE_SPINLOCK for true ISR-task safety.
// For task-task or task-ISR where ISR only reads, a mutex might be okay for task side.
// For ISR-ISR or ISR writing, spinlock is needed.
static portMUX_TYPE timer_spinlock = portMUX_INITIALIZER_UNLOCKED;

// Forward declarations for ISR handlers
static void IRAM_ATTR sensor1_isr_handler(void* arg);
static void IRAM_ATTR sensor2_isr_handler(void* arg);
static void IRAM_ATTR sensor3_isr_handler(void* arg);


// --- ISR Handlers ---
static void IRAM_ATTR sensor1_isr_handler(void* arg) {
    uint64_t current_micros = esp_timer_get_time();
    bool pin_level = gpio_get_level(SENSOR_1_PIN);

    portENTER_CRITICAL_ISR(&timer_spinlock);
    if (!is_sensor1_active) {
        portEXIT_CRITICAL_ISR(&timer_spinlock);
        return;
    }

    if (pin_level == HIGH) { // Sensor sees light (shutter opening)
        sensor1_open_time_us = current_micros;
        sensor1_state = SENSOR_AWAITING_CLOSE;
        // Reset subsequent sensors if in specific modes (as per .ino logic)
        if (current_mode == MODE_ALL_SENSORS) {
            if (is_sensor2_active) sensor2_state = SENSOR_IDLE;
            if (is_sensor3_active) sensor3_state = SENSOR_IDLE;
        } else if (current_mode == MODE_OUTER_SENSORS) {
            if (is_sensor3_active) sensor3_state = SENSOR_IDLE;
        }
    } else { // Sensor dark (shutter closing)
        if (sensor1_state == SENSOR_AWAITING_CLOSE) {
            sensor1_close_time_us = current_micros;
            sensor1_state = SENSOR_CLOSED;
        }
    }
    portEXIT_CRITICAL_ISR(&timer_spinlock);
}

static void IRAM_ATTR sensor2_isr_handler(void* arg) {
    uint64_t current_micros = esp_timer_get_time();
    bool pin_level = gpio_get_level(SENSOR_2_PIN);

    portENTER_CRITICAL_ISR(&timer_spinlock);
    if (!is_sensor2_active) {
        portEXIT_CRITICAL_ISR(&timer_spinlock);
        return;
    }

    if (pin_level == HIGH) {
        if (current_mode == MODE_ALL_SENSORS) {
            if ((sensor1_state == SENSOR_AWAITING_CLOSE || sensor1_state == SENSOR_CLOSED) && sensor2_state == SENSOR_IDLE) {
                sensor2_open_time_us = current_micros;
                sensor2_state = SENSOR_AWAITING_CLOSE;
                if (is_sensor3_active) sensor3_state = SENSOR_IDLE;
            }
        } else if (current_mode == MODE_INNER_SENSOR) {
             // For inner sensor mode, S2 can trigger independently or re-trigger
            sensor2_open_time_us = current_micros;
            sensor2_state = SENSOR_AWAITING_CLOSE;
        }
    } else {
        if (sensor2_state == SENSOR_AWAITING_CLOSE) {
            sensor2_close_time_us = current_micros;
            sensor2_state = SENSOR_CLOSED;
        }
    }
    portEXIT_CRITICAL_ISR(&timer_spinlock);
}

static void IRAM_ATTR sensor3_isr_handler(void* arg) {
    uint64_t current_micros = esp_timer_get_time();
    bool pin_level = gpio_get_level(SENSOR_3_PIN);

    portENTER_CRITICAL_ISR(&timer_spinlock);
    if (!is_sensor3_active) {
        portEXIT_CRITICAL_ISR(&timer_spinlock);
        return;
    }

    if (pin_level == HIGH) {
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
    portEXIT_CRITICAL_ISR(&timer_spinlock);
}

// --- Mode and Reset Functions ---
static void shutter_sensor_update_mode_config_internal() {
    // This function MUST be called with the timer_spinlock ALREADY HELD
    // Note: Since this is called by functions that are now using _SAFE, 
    // if this function were public and callable from ISR, it would need its own logic.
    // But it's static and only called from task context functions.
    // ESP_LOGI(TAG, "Updating mode config for mode: %d", current_mode); // REMOVE THIS
    switch (current_mode) {
        case MODE_ALL_SENSORS:
            is_sensor1_active = true; is_sensor2_active = true; is_sensor3_active = true;
            gpio_set_level(IR_LED_S1_PIN, 1); gpio_set_level(IR_LED_S2_PIN, 1); gpio_set_level(IR_LED_S3_PIN, 1);
            break;
        case MODE_OUTER_SENSORS:
            is_sensor1_active = true; is_sensor2_active = false; is_sensor3_active = true;
            gpio_set_level(IR_LED_S1_PIN, 1); gpio_set_level(IR_LED_S2_PIN, 0); gpio_set_level(IR_LED_S3_PIN, 1);
            break;
        case MODE_INNER_SENSOR:
            is_sensor1_active = false; is_sensor2_active = true; is_sensor3_active = false;
            gpio_set_level(IR_LED_S1_PIN, 0); gpio_set_level(IR_LED_S2_PIN, 1); gpio_set_level(IR_LED_S3_PIN, 0);
            break;
        default: // Should not happen
            ESP_LOGE(TAG, "Unknown mode: %d", current_mode);
            is_sensor1_active = false; is_sensor2_active = false; is_sensor3_active = false;
            gpio_set_level(IR_LED_S1_PIN, 0); gpio_set_level(IR_LED_S2_PIN, 0); gpio_set_level(IR_LED_S3_PIN, 0);
            break;
    }
    // Reset states after mode change
    sensor1_state = SENSOR_IDLE; sensor2_state = SENSOR_IDLE; sensor3_state = SENSOR_IDLE;
    sensor1_open_time_us = 0; sensor1_close_time_us = 0;
    sensor2_open_time_us = 0; sensor2_close_time_us = 0;
    sensor3_open_time_us = 0; sensor3_close_time_us = 0;
    // ESP_LOGI(TAG, "Mode config updated. S1_active:%d, S2_active:%d, S3_active:%d", is_sensor1_active, is_sensor2_active, is_sensor3_active); // REMOVE THIS
}

void shutter_sensor_set_mode(measurement_mode_t new_mode) {
    ESP_LOGI(TAG, "Attempting to set mode to %d. Old mode was %d.", new_mode, current_mode); // Log before critical section
    
    portENTER_CRITICAL_SAFE(&timer_spinlock);
    current_mode = new_mode;
    // Capture active states for logging *after* exiting critical section
    bool s1_active_after, s2_active_after, s3_active_after;
    shutter_sensor_update_mode_config_internal(); // This no longer logs internally
    s1_active_after = is_sensor1_active; // Read protected values while still in critical section
    s2_active_after = is_sensor2_active;
    s3_active_after = is_sensor3_active;
    portEXIT_CRITICAL_SAFE(&timer_spinlock);
    
    ESP_LOGI(TAG, "Mode set to %d. Active sensors: S1=%d, S2=%d, S3=%d", new_mode, s1_active_after, s2_active_after, s3_active_after);
}

void shutter_sensor_reset_all_idle(void) {
    portENTER_CRITICAL_SAFE(&timer_spinlock);
    sensor1_state = SENSOR_IDLE; sensor2_state = SENSOR_IDLE; sensor3_state = SENSOR_IDLE;
    sensor1_open_time_us = 0; sensor1_close_time_us = 0;
    sensor2_open_time_us = 0; sensor2_close_time_us = 0;
    sensor3_open_time_us = 0; sensor3_close_time_us = 0;
    // Re-apply IR LED states based on current_mode as shutter_sensor_update_mode_config_internal() does
    shutter_sensor_update_mode_config_internal(); 
    portEXIT_CRITICAL_SAFE(&timer_spinlock);
    ESP_LOGI(TAG, "All sensors reset to IDLE and mode re-applied.");
}

// --- Data Access ---
void shutter_sensor_get_data(shutter_data_values_t* data_out) {
    if (!data_out) return;
    portENTER_CRITICAL_SAFE(&timer_spinlock); 
    data_out->mode = current_mode;
    data_out->s1_open_us = sensor1_open_time_us;
    data_out->s1_close_us = sensor1_close_time_us;
    data_out->s2_open_us = sensor2_open_time_us;
    data_out->s2_close_us = sensor2_close_time_us;
    data_out->s3_open_us = sensor3_open_time_us;
    data_out->s3_close_us = sensor3_close_time_us;
    portEXIT_CRITICAL_SAFE(&timer_spinlock);
}

void shutter_sensor_get_raw_times(uint64_t* s1_o, uint64_t* s1_c, uint64_t* s2_o, uint64_t* s2_c, uint64_t* s3_o, uint64_t* s3_c) {
    portENTER_CRITICAL_SAFE(&timer_spinlock);
    if(s1_o) { *s1_o = sensor1_open_time_us; }
    if(s1_c) { *s1_c = sensor1_close_time_us; }
    if(s2_o) { *s2_o = sensor2_open_time_us; }
    if(s2_c) { *s2_c = sensor2_close_time_us; }
    if(s3_o) { *s3_o = sensor3_open_time_us; }
    if(s3_c) { *s3_c = sensor3_close_time_us; }
    portEXIT_CRITICAL_SAFE(&timer_spinlock);
}

void shutter_sensor_get_states(sensor_operational_state_t* st1, sensor_operational_state_t* st2, sensor_operational_state_t* st3) {
    portENTER_CRITICAL_SAFE(&timer_spinlock);
    if(st1) { *st1 = sensor1_state; }
    if(st2) { *st2 = sensor2_state; }
    if(st3) { *st3 = sensor3_state; }
    portEXIT_CRITICAL_SAFE(&timer_spinlock);
}


measurement_mode_t shutter_sensor_get_current_mode(void) {
    portENTER_CRITICAL_SAFE(&timer_spinlock);
    measurement_mode_t mode_snap = current_mode;
    portEXIT_CRITICAL_SAFE(&timer_spinlock);
    return mode_snap;
}

bool shutter_sensor_is_measurement_complete(void) {
    bool complete = false;
    portENTER_CRITICAL_SAFE(&timer_spinlock);
    measurement_mode_t mode_snap = current_mode;
    sensor_operational_state_t s1s_snap = sensor1_state;
    sensor_operational_state_t s2s_snap = sensor2_state;
    sensor_operational_state_t s3s_snap = sensor3_state;
    bool s1_active_snap = is_sensor1_active;
    bool s2_active_snap = is_sensor2_active;
    bool s3_active_snap = is_sensor3_active;
    uint64_t s1_ct_snap = sensor1_close_time_us;
    uint64_t s2_ct_snap = sensor2_close_time_us;
    uint64_t s3_ct_snap = sensor3_close_time_us;

    portEXIT_CRITICAL_SAFE(&timer_spinlock);

    switch (mode_snap) {
        case MODE_ALL_SENSORS:
            if (s1_active_snap && s1s_snap != SENSOR_CLOSED) return false;
            if (s2_active_snap && s2s_snap != SENSOR_CLOSED) return false;
            if (s3_active_snap && s3s_snap != SENSOR_CLOSED) return false;
            // Ensure all active sensors are indeed closed
            complete = (!s1_active_snap || s1s_snap == SENSOR_CLOSED) &&
                       (!s2_active_snap || s2s_snap == SENSOR_CLOSED) &&
                       (!s3_active_snap || s3s_snap == SENSOR_CLOSED);
            break;
        case MODE_OUTER_SENSORS:
            if (s1_active_snap && s1s_snap != SENSOR_CLOSED) return false;
            if (s3_active_snap && s3s_snap != SENSOR_CLOSED) return false;
            complete = (!s1_active_snap || s1s_snap == SENSOR_CLOSED) &&
                       (!s3_active_snap || s3s_snap == SENSOR_CLOSED);
            break;
        case MODE_INNER_SENSOR:
            if (s2_active_snap && s2s_snap != SENSOR_CLOSED) return false;
            complete = (!s2_active_snap || s2s_snap == SENSOR_CLOSED);
            break;
        default:
            return false; // Unknown mode
    }
    
    if (complete) {
        bool any_data_relevant_to_mode = false;
        if (mode_snap == MODE_ALL_SENSORS && s1_active_snap && s1_ct_snap > 0 && s2_active_snap && s2_ct_snap > 0 && s3_active_snap && s3_ct_snap > 0) any_data_relevant_to_mode = true;
        else if (mode_snap == MODE_OUTER_SENSORS && s1_active_snap && s1_ct_snap > 0 && s3_active_snap && s3_ct_snap > 0) any_data_relevant_to_mode = true;
        else if (mode_snap == MODE_INNER_SENSOR && s2_active_snap && s2_ct_snap > 0) any_data_relevant_to_mode = true;
        
        // If a sensor is not active in this mode, we don't care if it has a close time.
        // The primary check is that all *active* sensors for the current mode are in SENSOR_CLOSED state.
        // The any_data_relevant_to_mode check then ensures that these active sensors actually recorded a close time.
        return any_data_relevant_to_mode;
    }
    return false;
}

// Helper function to check if a sensor is active in a given mode
// This is a public function that can be called from other modules like main.c
bool shutter_sensor_is_active(uint8_t sensor_gpio, measurement_mode_t mode_to_check) {
    // The mode_to_check is passed in, so we determine activity based on that,
    // not necessarily the *current* global mode of the sensor module.
    // This allows checking, for example, if SENSOR_1_PIN would be active *if* the mode were MODE_OUTER_SENSORS.
    // However, the sensor_task will likely call this with shutter_sensor_get_current_mode().

    // This logic is based on how shutter_sensor_update_mode_config_internal sets
    // is_sensorX_active based on current_mode. This function itself doesn't need a spinlock
    // as it's not accessing shared global state directly, rather interpreting the mode_to_check.
    switch (mode_to_check) {
        case MODE_ALL_SENSORS:
            return (sensor_gpio == SENSOR_1_PIN || sensor_gpio == SENSOR_2_PIN || sensor_gpio == SENSOR_3_PIN);
        case MODE_OUTER_SENSORS:
            return (sensor_gpio == SENSOR_1_PIN || sensor_gpio == SENSOR_3_PIN);
        case MODE_INNER_SENSOR:
            return (sensor_gpio == SENSOR_2_PIN);
        default:
            return false;
    }
    // Note: The original implementation sketch for this function suggested reading
    // the volatile is_sensorX_active flags. However, those flags reflect the *current*
    // operational mode's active sensors. If the goal is to check against a *specific*
    // mode (mode_to_check), then the logic should be as above.
    // If the goal is to check against the *current actual* state of is_sensorX_active,
    // then a getter for those specific flags would be needed, e.g.,
    // bool get_is_sensor1_active_internal() { portENTER_CRITICAL(...); bool val = is_sensor1_active; portEXIT_CRITICAL(...); return val;}
    // For the sensor_task, it will get the current_mode and then check against that, so the above is fine.
}


// --- Initialization ---
void shutter_sensor_init(void) {
    ESP_LOGI(TAG, "Initializing shutter sensor module...");

    // Configure sensor pins
    gpio_config_t io_conf_sensor = {
        .intr_type = GPIO_INTR_ANYEDGE,
        .mode = GPIO_MODE_INPUT,
        .pin_bit_mask = (1ULL<<SENSOR_1_PIN) | (1ULL<<SENSOR_2_PIN) | (1ULL<<SENSOR_3_PIN),
        .pull_down_en = GPIO_PULLDOWN_DISABLE, // Explicitly disable pull-down
        .pull_up_en = GPIO_PULLUP_ENABLE,     // Explicitly enable pull-up
    };
    gpio_config(&io_conf_sensor);

    // Configure LED and IR LED pins
    gpio_config_t io_conf_output = {
        .intr_type = GPIO_INTR_DISABLE,
        .mode = GPIO_MODE_OUTPUT,
        .pin_bit_mask = (1ULL<<LED_PIN) | (1ULL<<IR_LED_S1_PIN) | (1ULL<<IR_LED_S2_PIN) | (1ULL<<IR_LED_S3_PIN),
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .pull_up_en = GPIO_PULLUP_DISABLE,
    };
    gpio_config(&io_conf_output);

    // Install ISR service
    esp_err_t ret = gpio_install_isr_service(ESP_INTR_FLAG_SHARED | ESP_INTR_FLAG_IRAM);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) { 
        ESP_LOGE(TAG, "gpio_install_isr_service failed: %s. Trying with different flags or stopping.", esp_err_to_name(ret));
        // Attempt fallback if specific flags caused issue, or handle error appropriately
        ret = gpio_install_isr_service(0); // Default flags
         if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
            ESP_LOGE(TAG, "Fallback gpio_install_isr_service failed: %s", esp_err_to_name(ret));
            return; // Critical failure
        }
    }
    if (ret == ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG, "ISR service already installed.");
    }


    // Add ISR handlers
    gpio_isr_handler_add(SENSOR_1_PIN, sensor1_isr_handler, (void*) SENSOR_1_PIN);
    gpio_isr_handler_add(SENSOR_2_PIN, sensor2_isr_handler, (void*) SENSOR_2_PIN);
    gpio_isr_handler_add(SENSOR_3_PIN, sensor3_isr_handler, (void*) SENSOR_3_PIN);

    // Set initial mode and configuration
    bool s1_active_init, s2_active_init, s3_active_init;
    measurement_mode_t initial_mode_log;

    portENTER_CRITICAL_SAFE(&timer_spinlock);
    initial_mode_log = current_mode; // Read before it's potentially changed by update_mode_config
    shutter_sensor_update_mode_config_internal(); // Sets initial IR LED states and active flags
    s1_active_init = is_sensor1_active; // Read protected values
    s2_active_init = is_sensor2_active;
    s3_active_init = is_sensor3_active;
    portEXIT_CRITICAL_SAFE(&timer_spinlock);
    
    ESP_LOGI(TAG, "Initial mode config applied for mode: %d. Active sensors: S1=%d, S2=%d, S3=%d", initial_mode_log, s1_active_init, s2_active_init, s3_active_init);
    
    gpio_set_level(LED_PIN, 1); // Default LED OFF (idle state) for active-low LED
    ESP_LOGI(TAG, "Shutter sensor module initialized.");
}
