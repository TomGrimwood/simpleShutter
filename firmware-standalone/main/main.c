#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include <string.h> // For memset
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h" // For mutex
#include "esp_system.h" // Already included but good to be explicit
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_http_server.h"
#include "cJSON.h" // Added for cJSON support

#include "lwip/err.h"
#include "lwip/sys.h"

#include "shutter_sensor.h" // Include for sensor module

// Placeholders for SSID and Password (Consider moving to sdkconfig.defaults fully)
#define EXAMPLE_ESP_WIFI_SSID      "MY_SSID"
#define EXAMPLE_ESP_WIFI_PASS      "MY_PASSWORD"

static const char *TAG = "wifi station"; // Tag for WiFi related logs
static const char *TAG_HTTP = "http server"; // Tag for HTTP server related logs
static const char *TAG_MAIN = "main_app";    // Logging tag for main.c specific logs

// Global struct to hold latest complete measurement
static shutter_data_values_t g_latest_shutter_data;
// Mutex to protect g_latest_shutter_data
static SemaphoreHandle_t g_shutter_data_mutex;

// Embedded file symbols
extern const uint8_t index_html_start[] asm("_binary_index_html_start");
extern const uint8_t index_html_end[]   asm("_binary_index_html_end");
extern const uint8_t app_js_start[]     asm("_binary_app_js_start");
extern const uint8_t app_js_end[]       asm("_binary_app_js_end");

static int s_retry_num = 0;
static bool s_webserver_started = false; // Flag to track if webserver is started
static httpd_handle_t s_server = NULL; // Global handle for the HTTP server

// Forward declaration for start_webserver
static void start_webserver(void);
// Forward declaration for stop_webserver (if needed later)
// static void stop_webserver(void);


// URI handler for serving index.html
static esp_err_t root_get_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG_HTTP, "Serving index.html");
    httpd_resp_set_type(req, "text/html");
    const size_t index_html_size = (index_html_end - index_html_start);
    httpd_resp_send(req, (const char *)index_html_start, index_html_size);
    return ESP_OK;
}

// URI handler for serving app.js
static esp_err_t app_js_get_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG_HTTP, "Serving app.js");
    httpd_resp_set_type(req, "application/javascript");
    const size_t app_js_size = (app_js_end - app_js_start);
    httpd_resp_send(req, (const char *)app_js_start, app_js_size);
    return ESP_OK;
}

static void event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
        ESP_LOGI(TAG, "WIFI_EVENT_STA_START: connecting to the AP");
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGI(TAG, "WIFI_EVENT_STA_DISCONNECTED: disconnected from the AP");
        if (s_retry_num < 5) { // Limited retries
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "retry to connect to the AP");
        } else {
            ESP_LOGI(TAG, "failed to connect to the AP after multiple retries");
            // Optionally, you could trigger a system reboot or other recovery mechanism here
        }
        // Note: If webserver was running, it might need to be stopped or handled here
        // For now, we assume it stops implicitly or is handled by reconnections.
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "IP_EVENT_STA_GOT_IP: got ip:" IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_num = 0; // Reset retry counter on successful connection
        if (!s_webserver_started) {
            start_webserver();
            s_webserver_started = true;
        }
    }
}

// Function to start the web server
// GET /api/getdata handler
static esp_err_t get_data_handler(httpd_req_t *req) {
    if (xSemaphoreTake(g_shutter_data_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        // Create JSON object
        cJSON *root = cJSON_CreateObject();
        if (!root) {
            xSemaphoreGive(g_shutter_data_mutex);
            httpd_resp_send_500(req);
            return ESP_FAIL;
        }

        const char* mode_str = "UNKNOWN";
        switch (g_latest_shutter_data.mode) {
            case MODE_ALL_SENSORS: mode_str = "ALL"; break;
            case MODE_OUTER_SENSORS: mode_str = "OUTER"; break;
            case MODE_INNER_SENSOR: mode_str = "INNER"; break;
        }
        cJSON_AddStringToObject(root, "mode", mode_str);
        cJSON_AddNumberToObject(root, "s1_open_us", (double)g_latest_shutter_data.s1_open_us);
        cJSON_AddNumberToObject(root, "s1_close_us", (double)g_latest_shutter_data.s1_close_us);
        cJSON_AddNumberToObject(root, "s2_open_us", (double)g_latest_shutter_data.s2_open_us);
        cJSON_AddNumberToObject(root, "s2_close_us", (double)g_latest_shutter_data.s2_close_us);
        cJSON_AddNumberToObject(root, "s3_open_us", (double)g_latest_shutter_data.s3_open_us);
        cJSON_AddNumberToObject(root, "s3_close_us", (double)g_latest_shutter_data.s3_close_us);

        char *json_string = cJSON_PrintUnformatted(root);
        xSemaphoreGive(g_shutter_data_mutex); // Release mutex after copying data to cJSON object

        if (!json_string) {
            cJSON_Delete(root);
            httpd_resp_send_500(req);
            return ESP_FAIL;
        }

        httpd_resp_set_type(req, "application/json");
        httpd_resp_send(req, json_string, strlen(json_string));

        free(json_string);
        cJSON_Delete(root);
    } else {
        ESP_LOGE(TAG_MAIN, "Failed to take data mutex for /api/getdata");
        httpd_resp_send_500(req); // Internal Server Error if mutex timeout
        return ESP_FAIL;
    }
    return ESP_OK;
}

// POST /api/setmode handler
static esp_err_t set_mode_handler(httpd_req_t *req) {
    char buf[100]; // Buffer to store request body
    int ret, remaining = req->content_len;

    // Read request body
    if (remaining > sizeof(buf) - 1) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Request body too large");
        return ESP_FAIL;
    }
    ret = httpd_req_recv(req, buf, remaining);
    if (ret <= 0) { // Error or connection closed
        if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
            httpd_resp_send_408(req);
        }
        return ESP_FAIL;
    }
    buf[ret] = '\0'; // Null-terminate the buffer

    // Parse JSON
    cJSON *root = cJSON_Parse(buf);
    if (!root) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
        return ESP_FAIL;
    }

    cJSON *mode_item = cJSON_GetObjectItem(root, "mode");
    if (!cJSON_IsNumber(mode_item)) {
        cJSON_Delete(root);
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Mode is not a number or missing");
        return ESP_FAIL;
    }

    int mode_val = mode_item->valueint;
    cJSON_Delete(root); // Delete cJSON object after extracting value

    if (mode_val >= 0 && mode_val <= 2) { // Validate mode
        shutter_sensor_set_mode((measurement_mode_t)mode_val);
        ESP_LOGI(TAG_MAIN, "Mode set to %d via API", mode_val);

        // Respond with success
        const char* mode_str_resp = "UNKNOWN";
        switch((measurement_mode_t)mode_val){
            case MODE_ALL_SENSORS: mode_str_resp = "ALL"; break;
            case MODE_OUTER_SENSORS: mode_str_resp = "OUTER"; break;
            case MODE_INNER_SENSOR: mode_str_resp = "INNER"; break;
        }
        char resp_json[100];
        snprintf(resp_json, sizeof(resp_json), "{\"success\":true, \"mode_set\":\"%s\"}", mode_str_resp);
        httpd_resp_set_type(req, "application/json");
        httpd_resp_send(req, resp_json, strlen(resp_json));
        return ESP_OK;
    } else {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid mode value");
        return ESP_FAIL;
    }
}

// POST /api/reset handler
static esp_err_t reset_handler(httpd_req_t *req) {
    shutter_sensor_reset_all_idle();
    ESP_LOGI(TAG_MAIN, "Sensors reset via API");
    const char* resp_json = "{\"success\":true}";
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, resp_json, strlen(resp_json));
    return ESP_OK;
}


static void start_webserver(void)
{
    // s_server is a global static variable
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.lru_purge_enable = true; // Enable LRU purge for inactive connections

    ESP_LOGI(TAG_HTTP, "Starting HTTP server on port: '%d'", config.server_port);
    if (httpd_start(&s_server, &config) == ESP_OK) {
        ESP_LOGI(TAG_HTTP, "HTTP server started successfully, registering URI handlers.");

        // Register URI handler for /
        httpd_uri_t root_uri = {
            .uri      = "/",
            .method   = HTTP_GET,
            .handler  = root_get_handler,
            .user_ctx = NULL
        };
        ESP_ERROR_CHECK(httpd_register_uri_handler(s_server, &root_uri));

        // Register URI handler for /app.js
        httpd_uri_t app_js_uri = {
            .uri      = "/app.js",
            .method   = HTTP_GET,
            .handler  = app_js_get_handler,
            .user_ctx = NULL
        };
        ESP_ERROR_CHECK(httpd_register_uri_handler(s_server, &app_js_uri));

        // Register URI handler for /api/getdata
        static const httpd_uri_t get_data_uri = {
            .uri      = "/api/getdata",
            .method   = HTTP_GET,
            .handler  = get_data_handler,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(s_server, &get_data_uri);

        // Register URI handler for /api/setmode
        static const httpd_uri_t set_mode_uri = {
            .uri      = "/api/setmode",
            .method   = HTTP_POST,
            .handler  = set_mode_handler,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(s_server, &set_mode_uri);

        // Register URI handler for /api/reset
        static const httpd_uri_t reset_uri = {
            .uri      = "/api/reset",
            .method   = HTTP_POST,
            .handler  = reset_handler,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(s_server, &reset_uri);

    } else {
        ESP_LOGE(TAG_HTTP, "Error starting HTTP server!");
        s_server = NULL; // Ensure server handle is NULL if start failed
    }
}

// Function to stop the webserver (example, not strictly needed by current subtask)
// static void stop_webserver(void) { // Example function
//    if (s_server) { // Check if server handle is valid
//        ESP_LOGI(TAG_HTTP, "Stopping HTTP server.");
//        httpd_stop(s_server); // Stop the server
//        ESP_LOGI(TAG_HTTP, "HTTP server stopped.");
//        s_server = NULL;
//        s_webserver_started = false;
//    }
//}

void wifi_init_sta(void)
{
    ESP_LOGI(TAG, "ESP_WIFI_MODE_STA");

    ESP_ERROR_CHECK(esp_netif_init());
    esp_netif_t *sta_netif = esp_netif_create_default_wifi_sta();
    assert(sta_netif); // Ensure sta_netif is not NULL

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &event_handler,
                                                        NULL,
                                                        NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &event_handler,
                                                        NULL,
                                                        NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = EXAMPLE_ESP_WIFI_SSID,
            .password = EXAMPLE_ESP_WIFI_PASS,
            /* Authmode threshold defaults to WPA2 PSK. Note that WEP is not supported. */
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA) );
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config) );
    ESP_ERROR_CHECK(esp_wifi_start() );

    ESP_LOGI(TAG, "wifi_init_sta finished.");
}

void app_main(void)
{
    //Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
      ESP_ERROR_CHECK(nvs_flash_erase());
      ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ESP_ERROR_CHECK(esp_event_loop_create_default());

    // Initialize Shutter Sensor Module
    shutter_sensor_init();

    // Create Mutex for shared data
    g_shutter_data_mutex = xSemaphoreCreateMutex();
    if (g_shutter_data_mutex == NULL) {
        ESP_LOGE(TAG_MAIN, "Failed to create shutter data mutex");
        // Handle error - perhaps by not starting the sensor task or web server
    } else {
        ESP_LOGI(TAG_MAIN, "Shutter data mutex created successfully");
    }

    // Create Sensor Task
    BaseType_t task_created = xTaskCreate(sensor_task, "sensor_task", 4096, NULL, 5, NULL);
    if (task_created != pdPASS) {
        ESP_LOGE(TAG_MAIN, "Failed to create sensor_task.");
        // Handle error
    } else {
        ESP_LOGI(TAG_MAIN, "sensor_task created successfully.");
    }

    wifi_init_sta();
}

// Sensor processing task
static void sensor_task(void *pvParameters) {
    ESP_LOGI(TAG_MAIN, "Sensor task started.");
    shutter_data_values_t current_measurement_data; // Local variable for current measurement
    memset(&current_measurement_data, 0, sizeof(shutter_data_values_t));
    // bool measurement_was_in_progress = false; // Not strictly needed with current LED logic

    while (1) {
        bool measurement_is_complete = shutter_sensor_is_measurement_complete();
        sensor_operational_state_t s1_state, s2_state, s3_state;
        shutter_sensor_get_states(&s1_state, &s2_state, &s3_state);
        measurement_mode_t current_mode_task = shutter_sensor_get_current_mode();

        bool measurement_in_progress_now = false;
        if ( (shutter_sensor_is_active(SENSOR_1_PIN, current_mode_task) && s1_state == SENSOR_AWAITING_CLOSE) ||
             (shutter_sensor_is_active(SENSOR_2_PIN, current_mode_task) && s2_state == SENSOR_AWAITING_CLOSE) ||
             (shutter_sensor_is_active(SENSOR_3_PIN, current_mode_task) && s3_state == SENSOR_AWAITING_CLOSE) ) {
            measurement_in_progress_now = true;
        }

        if (measurement_in_progress_now) {
            gpio_set_level(LED_PIN, 0); // LED ON (active LOW) when measuring
            // measurement_was_in_progress = true;
        } else {
            // If not in progress now, it's either idle or just completed.
            // If it just completed, it will be handled below. If idle, LED OFF.
            gpio_set_level(LED_PIN, 1); // LED OFF (active HIGH) when idle
        }

        if (measurement_is_complete) {
            ESP_LOGI(TAG_MAIN, "Measurement complete detected by sensor_task.");
            gpio_set_level(LED_PIN, 0); // Keep LED ON (active low) briefly while processing

            shutter_sensor_get_data(&current_measurement_data);

            // Log the detailed data
            ESP_LOGI(TAG_MAIN, "Mode: %d", current_measurement_data.mode);
            if (shutter_sensor_is_active(SENSOR_1_PIN, current_mode_task)) {
                ESP_LOGI(TAG_MAIN, "S1: %llu us -> %llu us", current_measurement_data.s1_open_us, current_measurement_data.s1_close_us);
                if (current_measurement_data.s1_close_us > current_measurement_data.s1_open_us) {
                    ESP_LOGI(TAG_MAIN, "S1 Exposure: %llu us", current_measurement_data.s1_close_us - current_measurement_data.s1_open_us);
                }
            }
            if (shutter_sensor_is_active(SENSOR_2_PIN, current_mode_task)) {
                ESP_LOGI(TAG_MAIN, "S2: %llu us -> %llu us", current_measurement_data.s2_open_us, current_measurement_data.s2_close_us);
                if (current_measurement_data.s2_close_us > current_measurement_data.s2_open_us) {
                    ESP_LOGI(TAG_MAIN, "S2 Exposure: %llu us", current_measurement_data.s2_close_us - current_measurement_data.s2_open_us);
                }
            }
            if (shutter_sensor_is_active(SENSOR_3_PIN, current_mode_task)) {
                ESP_LOGI(TAG_MAIN, "S3: %llu us -> %llu us", current_measurement_data.s3_open_us, current_measurement_data.s3_close_us);
                if (current_measurement_data.s3_close_us > current_measurement_data.s3_open_us) {
                    ESP_LOGI(TAG_MAIN, "S3 Exposure: %llu us", current_measurement_data.s3_close_us - current_measurement_data.s3_open_us);
                }
            }

            if (g_shutter_data_mutex != NULL && xSemaphoreTake(g_shutter_data_mutex, portMAX_DELAY) == pdTRUE) {
                g_latest_shutter_data = current_measurement_data; // Copy to global
                xSemaphoreGive(g_shutter_data_mutex);
                ESP_LOGI(TAG_MAIN, "Global shutter data updated with new measurement.");
            } else if (g_shutter_data_mutex == NULL) {
                ESP_LOGE(TAG_MAIN, "Mutex not initialized, cannot update global data!");
            } else {
                ESP_LOGE(TAG_MAIN, "Failed to take mutex, cannot update global data!");
            }

            shutter_sensor_reset_all_idle(); // Reset for next measurement
            gpio_set_level(LED_PIN, 1);      // LED OFF (idle) after processing
            // measurement_was_in_progress = false;
        }
        vTaskDelay(pdMS_TO_TICKS(50)); // Check status periodically
    }
}
