#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_http_server.h"
#include "cJSON.h" // Added for cJSON support

#include "lwip/err.h"
#include "lwip/sys.h"

#include "shutter_sensor.h" // Include for sensor module

// SPIFFS related includes
#include "esp_spiffs.h"
#include <sys/stat.h> // For stat to check file size/existence
#include <fcntl.h>    // For open
#include <unistd.h>   // For close, read

// Placeholders for SSID and Password (Consider moving to sdkconfig.defaults fully)
#define EXAMPLE_ESP_WIFI_SSID      "INYOURWALLS"
#define EXAMPLE_ESP_WIFI_PASS      "SUVASMASH"

static const char *TAG = "wifi station"; // Tag for WiFi related logs
static const char *TAG_HTTP = "http server"; // Tag for HTTP server related logs
static const char *TAG_MAIN = "main_app";    // Logging tag for main.c specific logs
static const char *TAG_SPIFFS = "spiffs";    // Logging tag for SPIFFS

// Global struct to hold latest complete measurement
static shutter_data_values_t g_latest_shutter_data;
// Mutex to protect g_latest_shutter_data
static SemaphoreHandle_t g_shutter_data_mutex;

// Forward declaration for sensor_task
static void sensor_task(void *pvParameters);

// REMOVE Embedded file symbols - they are no longer needed
// extern const uint8_t index_html_start[] asm("_binary_html_index_html_start");
// ... and all other extern declarations for embedded files ...

#define SPIFFS_BASE_PATH "/spiffs" // Base path for SPIFFS mount

static int s_retry_num = 0;
static bool s_webserver_started = false; // Flag to track if webserver is started
static httpd_handle_t s_server = NULL; // Global handle for the HTTP server

// Forward declaration for start_webserver
static void start_webserver(void);
// static void stop_webserver(void); // If needed

// --- Helper function to serve a file from SPIFFS ---
static esp_err_t serve_file_from_spiffs(httpd_req_t *req, const char *filepath, const char *content_type) {
    char full_path[CONFIG_SPIFFS_OBJ_NAME_LEN  + sizeof(SPIFFS_BASE_PATH) + 1];
    snprintf(full_path, sizeof(full_path), "%s%s", SPIFFS_BASE_PATH, filepath);

    ESP_LOGI(TAG_HTTP, "Serving file: %s (maps to %s)", filepath, full_path);

    // Check if file exists
    struct stat st;
    if (stat(full_path, &st) == -1) {
        ESP_LOGE(TAG_HTTP, "File %s not found", full_path);
        httpd_resp_send_404(req);
        return ESP_FAIL;
    }

    int fd = open(full_path, O_RDONLY, 0);
    if (fd == -1) {
        ESP_LOGE(TAG_HTTP, "Failed to open file: %s", full_path);
        httpd_resp_send_500(req); // Internal Server Error
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, content_type);

    // Send file content
    char *chunk = malloc(1024); // Buffer for sending file chunks
    if (!chunk) {
        ESP_LOGE(TAG_HTTP, "Failed to allocate buffer for sending file");
        close(fd);
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    ssize_t read_bytes;
    do {
        read_bytes = read(fd, chunk, 1024);
        if (read_bytes == -1) {
            ESP_LOGE(TAG_HTTP, "Error reading from file: %s", full_path);
            free(chunk);
            close(fd);
            httpd_resp_send_500(req); // Or handle error differently
            return ESP_FAIL;
        }
        if (read_bytes > 0) {
            if (httpd_resp_send_chunk(req, chunk, read_bytes) != ESP_OK) {
                ESP_LOGE(TAG_HTTP, "File sending failed for: %s", full_path);
                free(chunk);
                close(fd);
                // Abort sending file
                httpd_resp_send_chunk(req, NULL, 0); // Finalize chunked response with error
                httpd_resp_send_500(req); // This might not work if headers already sent
                return ESP_FAIL;
            }
        }
    } while (read_bytes > 0);

    free(chunk);
    close(fd);
    ESP_LOGI(TAG_HTTP, "File sending complete: %s", full_path);
    // Finalize chunked response
    httpd_resp_send_chunk(req, NULL, 0);
    return ESP_OK;
}


// URI handler for serving index.html
static esp_err_t root_get_handler(httpd_req_t *req)
{
    // Assuming your index.html is directly under spiffs_web_data
    return serve_file_from_spiffs(req, "/index.html", "text/html");
}

// --- Static CSS Handler ---
static esp_err_t styles_css_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/css/styles.css", "text/css");
}

// --- Static JS Handlers ---
static esp_err_t static_js_api_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/js/api.js", "application/javascript");
}

static esp_err_t static_js_config_panel_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/js/config-panel.js", "application/javascript");
}

static esp_err_t static_js_data_updater_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/js/data-updater.js", "application/javascript");
}

static esp_err_t static_js_main_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/js/main.js", "application/javascript");
}

static esp_err_t static_js_results_log_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/js/results-log.js", "application/javascript");
}

static esp_err_t static_js_sc_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/js/sc.js", "application/javascript");
}

static esp_err_t static_js_ui_helpers_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/js/t.js", "application/javascript");
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
        }
        // Webserver started flag will prevent restart if it was never started
        // If it was started, it will be re-initialized on IP_EVENT_STA_GOT_IP
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "IP_EVENT_STA_GOT_IP: got ip:" IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_num = 0; // Reset retry counter on successful connection
        if (!s_webserver_started && s_server == NULL) { // Start server only if not already started
            start_webserver();
            // s_webserver_started = true; // Set inside start_webserver on success
        }
    }
}

// --- GET /api/getdata handler (remains the same) ---
static esp_err_t get_data_handler(httpd_req_t *req) {
    if (xSemaphoreTake(g_shutter_data_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
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
        xSemaphoreGive(g_shutter_data_mutex);

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
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    return ESP_OK;
}

// --- POST /api/setmode handler (remains the same) ---
static esp_err_t set_mode_handler(httpd_req_t *req) {
    char buf[100];
    int ret, remaining = req->content_len;
    if (remaining > sizeof(buf) - 1) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Request body too large");
        return ESP_FAIL;
    }
    ret = httpd_req_recv(req, buf, remaining);
    if (ret <= 0) {
        if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
            httpd_resp_send_408(req);
        }
        return ESP_FAIL;
    }
    buf[ret] = '\0';
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
    cJSON_Delete(root);
    if (mode_val >= 0 && mode_val <= 2) {
        shutter_sensor_set_mode((measurement_mode_t)mode_val);
        ESP_LOGI(TAG_MAIN, "Mode set to %d via API", mode_val);
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

// --- POST /api/reset handler (remains the same) ---
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
    if (s_server != NULL) {
        ESP_LOGI(TAG_HTTP, "Webserver already started.");
        return;
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.lru_purge_enable = true;
    config.uri_match_fn = httpd_uri_match_wildcard; // Optional: if you need wildcard matching for other routes later
    config.max_uri_handlers  = 15;

    ESP_LOGI(TAG_HTTP, "Starting HTTP server on port: '%d'", config.server_port);
    if (httpd_start(&s_server, &config) == ESP_OK) {
        ESP_LOGI(TAG_HTTP, "HTTP server started successfully, registering URI handlers.");
        s_webserver_started = true; // Set flag after successful start

        httpd_uri_t root_uri = { "/", HTTP_GET, root_get_handler, NULL };
        httpd_register_uri_handler(s_server, &root_uri);

        static const httpd_uri_t styles_css_uri = { "/static/css/styles.css", HTTP_GET, styles_css_get_handler, NULL };
        httpd_register_uri_handler(s_server, &styles_css_uri);
        
        static const httpd_uri_t static_js_api_uri = { "/static/js/api.js", HTTP_GET, static_js_api_get_handler, NULL };
        httpd_register_uri_handler(s_server, &static_js_api_uri);
        static const httpd_uri_t static_js_config_panel_uri = { "/static/js/config-panel.js", HTTP_GET, static_js_config_panel_get_handler, NULL };
        httpd_register_uri_handler(s_server, &static_js_config_panel_uri);
        static const httpd_uri_t static_js_data_updater_uri = { "/static/js/data-updater.js", HTTP_GET, static_js_data_updater_get_handler, NULL };
        httpd_register_uri_handler(s_server, &static_js_data_updater_uri);
        static const httpd_uri_t static_js_main_uri = { "/static/js/main.js", HTTP_GET, static_js_main_get_handler, NULL };
        httpd_register_uri_handler(s_server, &static_js_main_uri);
        static const httpd_uri_t static_js_results_log_uri = { "/static/js/results-log.js", HTTP_GET, static_js_results_log_get_handler, NULL };
        httpd_register_uri_handler(s_server, &static_js_results_log_uri);
        static const httpd_uri_t static_js_sc_uri = { "/static/js/sc.js", HTTP_GET, static_js_sc_get_handler, NULL };
        httpd_register_uri_handler(s_server, &static_js_sc_uri);
        static const httpd_uri_t static_js_ui_helpers_uri = { "/static/js/t.js", HTTP_GET, static_js_ui_helpers_get_handler, NULL };
        httpd_register_uri_handler(s_server, &static_js_ui_helpers_uri);

        static const httpd_uri_t get_data_uri = { "/api/getdata", HTTP_GET, get_data_handler, NULL };
        httpd_register_uri_handler(s_server, &get_data_uri);
        static const httpd_uri_t set_mode_uri = { "/api/setmode", HTTP_POST, set_mode_handler, NULL };
        httpd_register_uri_handler(s_server, &set_mode_uri);
        static const httpd_uri_t reset_uri = { "/api/reset", HTTP_POST, reset_handler, NULL };
        httpd_register_uri_handler(s_server, &reset_uri);

    } else {
        ESP_LOGE(TAG_HTTP, "Error starting HTTP server!");
        s_server = NULL; 
        s_webserver_started = false;
    }
}

void wifi_init_sta(void)
{
    ESP_LOGI(TAG, "ESP_WIFI_MODE_STA");
    ESP_ERROR_CHECK(esp_netif_init());
    esp_netif_t *sta_netif = esp_netif_create_default_wifi_sta();
    assert(sta_netif);
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, NULL));
    wifi_config_t wifi_config = {
        .sta = {
            .ssid = EXAMPLE_ESP_WIFI_SSID,
            .password = EXAMPLE_ESP_WIFI_PASS,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA) );
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config) );
    ESP_ERROR_CHECK(esp_wifi_start() );
    ESP_LOGI(TAG, "wifi_init_sta finished.");
}

// Function to initialize SPIFFS
static void init_spiffs(void)
{
    ESP_LOGI(TAG_SPIFFS, "Initializing SPIFFS");

    esp_vfs_spiffs_conf_t conf = {
      .base_path = "/spiffs", // Use the defined base path
      .partition_label = NULL,   // Label of the SPIFFS partition from partitions.csv
      .max_files = 14,               // Max number of open files. Adjust as needed.
      .format_if_mount_failed = false // Format if mounting fails (e.g. first time)
    };

    // Use settings defined above to initialize and mount SPIFFS filesystem.
    // Note: esp_vfs_spiffs_register is an all-in-one convenience function.
    esp_err_t ret = esp_vfs_spiffs_register(&conf);

    if (ret != ESP_OK) {
        if (ret == ESP_FAIL) {
            ESP_LOGE(TAG_SPIFFS, "Failed to mount or format filesystem");
        } else if (ret == ESP_ERR_NOT_FOUND) {
            ESP_LOGE(TAG_SPIFFS, "Failed to find SPIFFS partition. Check partition table.");
        } else {
            ESP_LOGE(TAG_SPIFFS, "Failed to initialize SPIFFS (%s)", esp_err_to_name(ret));
        }
        return; // Critical error, web server cannot serve files
    }

    size_t total = 0, used = 0;
    ret = esp_spiffs_info(conf.partition_label, &total, &used);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG_SPIFFS, "Failed to get SPIFFS partition information (%s)", esp_err_to_name(ret));
    } else {
        ESP_LOGI(TAG_SPIFFS, "Partition size: total: %d, used: %d", total, used);
    }

    ESP_LOGI(TAG, "Reading hello.txt");

    // Open for reading hello.txt
    FILE* f = fopen("/spiffs/html/index.html", "r");
    if (f == NULL) {
        ESP_LOGE(TAG, "Failed to open index.html");
        return;
    }

    char buf[64];
    memset(buf, 0, sizeof(buf));
    fread(buf, 1, sizeof(buf), f);
    fclose(f);

    // Display the read contents from the file
    ESP_LOGI(TAG, "Read from index.html: %s", buf);
}


void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
      ESP_ERROR_CHECK(nvs_flash_erase());
      ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ESP_ERROR_CHECK(esp_event_loop_create_default());

    // Initialize SPIFFS *before* trying to start the webserver which depends on it
    init_spiffs();

    shutter_sensor_init();

    g_shutter_data_mutex = xSemaphoreCreateMutex();
    if (g_shutter_data_mutex == NULL) {
        ESP_LOGE(TAG_MAIN, "Failed to create shutter data mutex");
    } else {
        ESP_LOGI(TAG_MAIN, "Shutter data mutex created successfully");
    }

    BaseType_t task_created = xTaskCreate(sensor_task, "sensor_task", 4096, NULL, 5, NULL);
    if (task_created != pdPASS) {
        ESP_LOGE(TAG_MAIN, "Failed to create sensor_task.");
    } else {
        ESP_LOGI(TAG_MAIN, "sensor_task created successfully.");
    }

    wifi_init_sta(); 
    // Webserver will be started by the WiFi event handler upon getting an IP
}

// Sensor processing task (remains the same)
static void sensor_task(void *pvParameters) {
    ESP_LOGI(TAG_MAIN, "Sensor task started.");
    shutter_data_values_t current_measurement_data; 
    memset(&current_measurement_data, 0, sizeof(shutter_data_values_t));

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
            gpio_set_level(LED_PIN, 0); 
        } else {
            gpio_set_level(LED_PIN, 1); 
        }
        if (measurement_is_complete) {
            ESP_LOGI(TAG_MAIN, "Measurement complete detected by sensor_task.");
            gpio_set_level(LED_PIN, 0); 
            shutter_sensor_get_data(&current_measurement_data);
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
                g_latest_shutter_data = current_measurement_data; 
                xSemaphoreGive(g_shutter_data_mutex);
                ESP_LOGI(TAG_MAIN, "Global shutter data updated with new measurement.");
            } else if (g_shutter_data_mutex == NULL) {
                ESP_LOGE(TAG_MAIN, "Mutex not initialized, cannot update global data!");
            } else {
                ESP_LOGE(TAG_MAIN, "Failed to take mutex, cannot update global data!");
            }
            shutter_sensor_reset_all_idle(); 
            gpio_set_level(LED_PIN, 1);      
        }
        vTaskDelay(pdMS_TO_TICKS(50)); 
    }
}