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
#include "cJSON.h"

#include "lwip/err.h"
#include "lwip/sys.h"

#include "shutter_sensor.h"

#include "esp_spiffs.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

#define EXAMPLE_ESP_WIFI_SSID      "INYOURWALLS" // Replace with your SSID
#define EXAMPLE_ESP_WIFI_PASS      "SUVASMASH"   // Replace with your Password

static const char *TAG = "wifi station";
static const char *TAG_HTTP = "http server";
static const char *TAG_MAIN = "main_app";
static const char *TAG_SPIFFS = "spiffs";

static shutter_data_values_t g_latest_shutter_data;
static SemaphoreHandle_t g_shutter_data_mutex;

static void sensor_task(void *pvParameters);

#define SPIFFS_BASE_PATH "/spiffs"

static int s_retry_num = 0;
static bool s_webserver_started = false;
static httpd_handle_t s_server = NULL;

static void start_webserver(void);

static esp_err_t serve_file_from_spiffs(httpd_req_t *req, const char *filepath, const char *content_type) {
    char full_path[CONFIG_SPIFFS_OBJ_NAME_LEN  + sizeof(SPIFFS_BASE_PATH) + 1];
    snprintf(full_path, sizeof(full_path), "%s%s", SPIFFS_BASE_PATH, filepath);

    ESP_LOGD(TAG_HTTP, "Attempting to serve file: %s (maps to %s)", filepath, full_path);

    struct stat st;
    if (stat(full_path, &st) == -1) {
        ESP_LOGE(TAG_HTTP, "File %s not found", full_path);
        httpd_resp_send_404(req);
        return ESP_FAIL;
    }

    int fd = open(full_path, O_RDONLY, 0);
    if (fd == -1) {
        ESP_LOGE(TAG_HTTP, "Failed to open file: %s", full_path);
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, content_type);
    // Cache control: instruct browser to revalidate files, useful for development
    // For production, you might use longer cache times or ETags.
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store, must-revalidate");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");


    char *chunk = malloc(1024);
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
            httpd_resp_send_500(req);
            return ESP_FAIL;
        }
        if (read_bytes > 0) {
            if (httpd_resp_send_chunk(req, chunk, read_bytes) != ESP_OK) {
                ESP_LOGE(TAG_HTTP, "File sending failed for: %s", full_path);
                free(chunk);
                close(fd);
                httpd_resp_send_chunk(req, NULL, 0);
                // httpd_resp_send_500(req); // Might not work if headers already sent
                return ESP_FAIL;
            }
        }
    } while (read_bytes > 0);

    free(chunk);
    close(fd);
    ESP_LOGD(TAG_HTTP, "File sending complete: %s", full_path);
    httpd_resp_send_chunk(req, NULL, 0);
    return ESP_OK;
}

static esp_err_t root_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/index.html", "text/html");
}

static esp_err_t styles_css_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/css/styles.css", "text/css");
}

static esp_err_t static_js_ui_helpers_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/js/ui-helpers.js", "application/javascript");
}
static esp_err_t static_js_shutter_calculations_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/static/js/shutter-calcs.js", "application/javascript");
}

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


static void event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
        ESP_LOGI(TAG, "WIFI_EVENT_STA_START: connecting to the AP");
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGI(TAG, "WIFI_EVENT_STA_DISCONNECTED: disconnected from the AP");
        if (s_webserver_started && s_server != NULL) { // Stop server if it was running
            // httpd_stop(s_server); // Consider if stop/start is needed or if it handles disconnects gracefully
            // s_server = NULL;
            // s_webserver_started = false;
            ESP_LOGI(TAG_HTTP, "Webserver potentially affected by disconnect.");
        }
        if (s_retry_num < 5) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "Retrying to connect to the AP (%d/5)", s_retry_num);
        } else {
            ESP_LOGE(TAG, "Failed to connect to the AP after %d retries.", s_retry_num);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "IP_EVENT_STA_GOT_IP: got ip:" IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_num = 0;
        if (!s_webserver_started && s_server == NULL) {
            start_webserver();
        }
    }
}

static esp_err_t get_data_handler(httpd_req_t *req) {
    // (Content of this function is unchanged from original)
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
        ESP_LOGE(TAG_HTTP, "Failed to take data mutex for /api/getdata");
        httpd_resp_send_500(req); // Or HTTPD_503_SERVICE_UNAVAILABLE
        return ESP_FAIL;
    }
    return ESP_OK;
}

static esp_err_t set_mode_handler(httpd_req_t *req) {
    // (Content of this function is unchanged from original)
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
    if (mode_val >= 0 && mode_val <= 2) { // Assuming 0, 1, 2 are valid modes
        shutter_sensor_set_mode((measurement_mode_t)mode_val);
        ESP_LOGI(TAG_HTTP, "Mode set to %d via API", mode_val);
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

static esp_err_t reset_handler(httpd_req_t *req) {
    // (Content of this function is unchanged from original)
    shutter_sensor_reset_all_idle();
    ESP_LOGI(TAG_HTTP, "Sensors reset via API");
    const char* resp_json = "{\"success\":true}";
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, resp_json, strlen(resp_json));
    return ESP_OK;
}


static void start_webserver(void) {
    if (s_server != NULL) {
        ESP_LOGI(TAG_HTTP, "Webserver already started.");
        return;
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.lru_purge_enable = true;
    config.max_uri_handlers = 16; // Adjusted slightly, 12 used + room for future
    // config.uri_match_fn = httpd_uri_match_wildcard; // Not strictly needed for current exact paths

    ESP_LOGI(TAG_HTTP, "Starting HTTP server on port: '%d'", config.server_port);
    if (httpd_start(&s_server, &config) == ESP_OK) {
        ESP_LOGI(TAG_HTTP, "HTTP server started successfully, registering URI handlers.");
        s_webserver_started = true;

        httpd_uri_t root_uri = { "/", HTTP_GET, root_get_handler, NULL };
        httpd_register_uri_handler(s_server, &root_uri);

        static const httpd_uri_t styles_css_uri = { "/static/css/styles.css", HTTP_GET, styles_css_get_handler, NULL };
        httpd_register_uri_handler(s_server, &styles_css_uri);
        
        // Handlers for renamed JS files
        static const httpd_uri_t static_js_ui_helpers_uri = { "/static/js/ui-helpers.js", HTTP_GET, static_js_ui_helpers_get_handler, NULL };
        httpd_register_uri_handler(s_server, &static_js_ui_helpers_uri);
        static const httpd_uri_t static_js_shutter_calc_uri = { "/static/js/shutter-calcs.js", HTTP_GET, static_js_shutter_calculations_get_handler, NULL };
        httpd_register_uri_handler(s_server, &static_js_shutter_calc_uri);
        
        // Other JS handlers
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

        // API Handlers
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

void wifi_init_sta(void) {
    // (Content of this function is unchanged from original)
    ESP_LOGI(TAG, "ESP_WIFI_MODE_STA");
    ESP_ERROR_CHECK(esp_netif_init());
    esp_netif_t *sta_netif = esp_netif_create_default_wifi_sta();
    assert(sta_netif); // Should not be NULL
    
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, NULL));
    
    wifi_config_t wifi_config = {
        .sta = {
            .ssid = EXAMPLE_ESP_WIFI_SSID,
            .password = EXAMPLE_ESP_WIFI_PASS,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK, // Or other desired auth mode
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA) );
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config) );
    ESP_ERROR_CHECK(esp_wifi_start() );
    ESP_LOGI(TAG, "wifi_init_sta finished.");
}

static void init_spiffs(void) {
    ESP_LOGI(TAG_SPIFFS, "Initializing SPIFFS");
    esp_vfs_spiffs_conf_t conf = {
      .base_path = SPIFFS_BASE_PATH, // Consistent with definition
      .partition_label = NULL,
      .max_files = 14, // Current number of distinct files served is around 9-10. This is fine.
      .format_if_mount_failed = false // Set to true if you want auto-format on first boot/corruption
    };
    esp_err_t ret = esp_vfs_spiffs_register(&conf);

    if (ret != ESP_OK) {
        if (ret == ESP_FAIL) ESP_LOGE(TAG_SPIFFS, "Failed to mount or format filesystem");
        else if (ret == ESP_ERR_NOT_FOUND) ESP_LOGE(TAG_SPIFFS, "Failed to find SPIFFS partition");
        else ESP_LOGE(TAG_SPIFFS, "Failed to initialize SPIFFS (%s)", esp_err_to_name(ret));
        return;
    }

    size_t total = 0, used = 0;
    ret = esp_spiffs_info(conf.partition_label, &total, &used);
    if (ret != ESP_OK) ESP_LOGE(TAG_SPIFFS, "Failed to get SPIFFS info (%s)", esp_err_to_name(ret));
    else ESP_LOGI(TAG_SPIFFS, "SPIFFS: Total: %d, Used: %d", total, used);

    // Corrected path for debug file open, assuming index.html is at root of spiffs_image
    // FILE* f = fopen("/spiffs/index.html", "r"); // Path inside VFS
    // if (f == NULL) {
    //     ESP_LOGE(TAG_SPIFFS, "Debug: Failed to open /spiffs/index.html");
    // } else {
    //     ESP_LOGI(TAG_SPIFFS, "Debug: Successfully opened /spiffs/index.html");
    //     fclose(f);
    // }
}


void app_main(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
      ESP_ERROR_CHECK(nvs_flash_erase());
      ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    init_spiffs(); // Initialize SPIFFS before WiFi/Webserver that might use it

    shutter_sensor_init();

    g_shutter_data_mutex = xSemaphoreCreateMutex();
    if (g_shutter_data_mutex == NULL) ESP_LOGE(TAG_MAIN, "Failed to create shutter data mutex!");
    else ESP_LOGI(TAG_MAIN, "Shutter data mutex created.");

    if (xTaskCreate(sensor_task, "sensor_task", 4096, NULL, 5, NULL) != pdPASS) {
        ESP_LOGE(TAG_MAIN, "Failed to create sensor_task.");
    } else {
        ESP_LOGI(TAG_MAIN, "sensor_task created.");
    }
    wifi_init_sta(); // Webserver started by event_handler on IP_EVENT_STA_GOT_IP
}

// Sensor processing task (Content of this function is unchanged from original)
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
            ESP_LOGD(TAG_MAIN, "Mode: %d", current_measurement_data.mode);
            if (shutter_sensor_is_active(SENSOR_1_PIN, current_mode_task)) {
                ESP_LOGD(TAG_MAIN, "S1: %llu us -> %llu us", current_measurement_data.s1_open_us, current_measurement_data.s1_close_us);
                if (current_measurement_data.s1_close_us > current_measurement_data.s1_open_us) {
                    ESP_LOGD(TAG_MAIN, "S1 Exposure: %llu us", current_measurement_data.s1_close_us - current_measurement_data.s1_open_us);
                }
            }
            // ... (similar logging for S2, S3) ...
            if (g_shutter_data_mutex != NULL && xSemaphoreTake(g_shutter_data_mutex, portMAX_DELAY) == pdTRUE) {
                g_latest_shutter_data = current_measurement_data; 
                xSemaphoreGive(g_shutter_data_mutex);
                ESP_LOGD(TAG_MAIN, "Global shutter data updated.");
            } else {
                ESP_LOGE(TAG_MAIN, "Mutex error, cannot update global data!");
            }
            shutter_sensor_reset_all_idle(); 
            gpio_set_level(LED_PIN, 1);      
        }
        vTaskDelay(pdMS_TO_TICKS(50)); 
    }
}