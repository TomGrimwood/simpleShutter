#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "esp_system.h"
#include "esp_wifi.h" // Needed for esp_wifi_get_mode() check in sensor_task
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_http_server.h"
#include "cJSON.h"

#include "lwip/err.h"
#include "lwip/sys.h"

#include "shutter_sensor.h"
#include "wifi_manager.h"

#include "esp_spiffs.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

#include "mdns.h"
#include "esp_err.h"

// --- mDNS Defines ---
#define MDNS_HOSTNAME              "esp" // mDNS Hostname
#define MDNS_INSTANCE_NAME         "ESP32 Shutter Sensor" // mDNS Instance Name (optional)

static const char *TAG = "main_app";
static const char *TAG_HTTP = "http server";
static const char *TAG_SPIFFS = "spiffs";
static const char *TAG_WS = "websocket";
static const char *TAG_MDNS = "mdns";

static shutter_data_values_t g_latest_shutter_data;
static SemaphoreHandle_t g_shutter_data_mutex;

// --- Global variable for webserver state ---
static bool s_webserver_started = false;
static bool s_mdns_initialized = false;

// --- Forward declarations ---
static void send_ws_data_to_all_clients(const char* data_json_string);
static char* generate_shutter_data_json(void);
static esp_err_t ws_data_handler(httpd_req_t *req);
static void initialise_mdns(void);
static void httpd_sess_close_handler(httpd_handle_t hd, int sockfd);

// Handlers for the main app UI (served regardless of STA/AP mode)
static esp_err_t serve_file_from_spiffs(httpd_req_t *req, const char *filepath, const char *content_type);
static esp_err_t root_get_handler(httpd_req_t *req);
static esp_err_t styles_css_get_handler(httpd_req_t *req);
static esp_err_t static_js_ui_helpers_get_handler(httpd_req_t *req);
static esp_err_t static_js_shutter_calculations_get_handler(httpd_req_t *req);
static esp_err_t static_js_api_get_handler(httpd_req_t *req);
static esp_err_t static_js_config_panel_get_handler(httpd_req_t *req);
static esp_err_t static_js_data_updater_get_handler(httpd_req_t *req);
static esp_err_t static_js_main_get_handler(httpd_req_t *req);
static esp_err_t static_js_results_log_get_handler(httpd_req_t *req);
static esp_err_t favicon_ico_get_handler(httpd_req_t *req);
static esp_err_t apple_touch_icon_png_get_handler(httpd_req_t *req); // Corrected handler name

// API handlers for sensor logic
static esp_err_t set_mode_handler(httpd_req_t *req);
static esp_err_t reset_handler(httpd_req_t *req);

// NEW: API handlers for WiFi configuration
static esp_err_t wifi_status_get_handler(httpd_req_t *req);
static esp_err_t wifi_set_post_handler(httpd_req_t *req);
static esp_err_t wifi_forget_post_handler(httpd_req_t *req);
// REMOVED: static esp_err_t wifi_revert_to_sta_post_handler(httpd_req_t *req);

// NEW: Device Reboot API handler
static esp_err_t reboot_post_handler(httpd_req_t *req); // ADDED THIS LINE

static void start_webserver(void); // Simplified, always serves main app UI
static void stop_webserver(void);
static void sensor_task(void *pvParameters);

// NEW: WiFi Manager Event Callback
static void wifi_manager_event_handler(wifi_manager_event_id_t event_id, void* event_data);

#define SPIFFS_BASE_PATH "/spiffs"

static httpd_handle_t s_server = NULL;

#define MAX_WS_CLIENTS 10
static int ws_clients_fds[MAX_WS_CLIENTS];
static uint8_t ws_clients_count = 0;
static SemaphoreHandle_t ws_clients_mutex;


static void add_ws_client_fd(int fd) {
    if (xSemaphoreTake(ws_clients_mutex, portMAX_DELAY) == pdTRUE) {
        if (ws_clients_count < MAX_WS_CLIENTS) {
            ws_clients_fds[ws_clients_count++] = fd;
            ESP_LOGI(TAG_WS, "Client fd %d added. Total clients: %d", fd, ws_clients_count);
        } else {
            ESP_LOGW(TAG_WS, "Max WebSocket clients reached. Cannot add fd %d", fd);
        }
        xSemaphoreGive(ws_clients_mutex);
    }
}

static void remove_ws_client_fd(int fd) {
    if (xSemaphoreTake(ws_clients_mutex, portMAX_DELAY) == pdTRUE) {
        bool found = false;
        for (int i = 0; i < ws_clients_count; i++) {
            if (ws_clients_fds[i] == fd) {
                for (int j = i; j < ws_clients_count - 1; j++) {
                    ws_clients_fds[j] = ws_clients_fds[j + 1];
                }
                ws_clients_count--;
                found = true;
                break;
            }
        }
        if (found) {
            ESP_LOGI(TAG_WS, "Client fd %d removed. Total clients: %d", fd, ws_clients_count);
        }
        xSemaphoreGive(ws_clients_mutex);
    }
}

static void httpd_sess_close_handler(httpd_handle_t hd, int sockfd) {
    ESP_LOGI(TAG_HTTP, "HTTPD session with sockfd %d closed by server core.", sockfd);
    remove_ws_client_fd(sockfd);
}


static char* generate_shutter_data_json(void) {
    char* json_string = NULL;
    if (g_shutter_data_mutex == NULL) {
         ESP_LOGE(TAG, "Shutter data mutex is NULL!");
         return NULL;
    }
    if (xSemaphoreTake(g_shutter_data_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        cJSON *root = cJSON_CreateObject();
        if (!root) {
            xSemaphoreGive(g_shutter_data_mutex);
            ESP_LOGE(TAG_HTTP, "Failed to create cJSON object");
            return NULL;
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

        json_string = cJSON_PrintUnformatted(root);
        cJSON_Delete(root);
        xSemaphoreGive(g_shutter_data_mutex);

        if (!json_string) {
            ESP_LOGE(TAG_HTTP, "Failed to print cJSON to string");
        }
    } else {
        ESP_LOGE(TAG_HTTP, "Failed to take data mutex for generating JSON");
    }
    return json_string;
}


static void send_ws_data_to_all_clients(const char* data_json_string) {
    if (!data_json_string) return;
    if (s_server == NULL) {
        ESP_LOGW(TAG_WS, "Webserver not running, cannot send WS data.");
        return;
    }
    if (ws_clients_mutex == NULL) {
        ESP_LOGE(TAG_WS, "WebSocket clients mutex is NULL!");
        return;
    }

    if (xSemaphoreTake(ws_clients_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        if (ws_clients_count == 0) {
            xSemaphoreGive(ws_clients_mutex);
            return;
        }

        httpd_ws_frame_t ws_pkt;
        memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
        ws_pkt.payload = (uint8_t*)data_json_string;
        ws_pkt.len = strlen(data_json_string);
        ws_pkt.type = HTTPD_WS_TYPE_TEXT;

        ESP_LOGD(TAG_WS, "Attempting to send to %d clients", ws_clients_count);
        for (int i = 0; i < ws_clients_count; /* No increment here */) {
            int client_fd = ws_clients_fds[i];
            esp_err_t ret = httpd_ws_send_frame_async(s_server, client_fd, &ws_pkt);

            if (ret != ESP_OK) {
                ESP_LOGE(TAG_WS, "httpd_ws_send_frame_async failed for fd %d: %s. Removing client.", client_fd, esp_err_to_name(ret));
                for (int j = i; j < ws_clients_count - 1; j++) {
                    ws_clients_fds[j] = ws_clients_fds[j + 1];
                }
                ws_clients_count--;
            } else {
                ESP_LOGD(TAG_WS, "Sent WS data to client fd %d", client_fd);
                i++;
            }
        }
        xSemaphoreGive(ws_clients_mutex);
    } else {
        ESP_LOGE(TAG_WS, "Could not obtain ws_clients_mutex to send data");
    }
}

static esp_err_t ws_data_handler(httpd_req_t *req) {
    if (req->method == HTTP_GET) {
        int client_fd = httpd_req_to_sockfd(req);
        ESP_LOGI(TAG_WS, "Client fd %d connected to WebSocket endpoint /ws", client_fd);
        add_ws_client_fd(client_fd);

        char* initial_data = generate_shutter_data_json();
        if (initial_data) {
            httpd_ws_frame_t ws_pkt;
            memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
            ws_pkt.payload = (uint8_t*)initial_data;
            ws_pkt.len = strlen(initial_data);
            ws_pkt.type = HTTPD_WS_TYPE_TEXT;
            esp_err_t ret = httpd_ws_send_frame_async(s_server, client_fd, &ws_pkt);
            if (ret != ESP_OK) {
                ESP_LOGE(TAG_WS, "Failed to send initial data to client fd %d: %s", client_fd, esp_err_to_name(ret));
                remove_ws_client_fd(client_fd);
            } else {
                 ESP_LOGI(TAG_WS, "Sent initial data to client fd %d", client_fd);
            }
            free(initial_data);
        }
        return ESP_OK;
    }

    httpd_ws_frame_t ws_pkt;
    uint8_t *buf = NULL;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
    ws_pkt.type = HTTPD_WS_TYPE_TEXT;

    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret != ESP_OK) {
        ESP_LOGI(TAG_WS, "httpd_ws_recv_frame failed for fd %d: %s. Assuming client disconnected.", httpd_req_to_sockfd(req), esp_err_to_name(ret));
        remove_ws_client_fd(httpd_req_to_sockfd(req));
        return ret;
    }

    ESP_LOGD(TAG_WS, "WebSocket frame type %d, len %d from fd %d", ws_pkt.type, ws_pkt.len, httpd_req_to_sockfd(req));

    if (ws_pkt.len > 0) {
        if (ws_pkt.len > 1024) {
            ESP_LOGE(TAG_WS, "WS payload too large: %d bytes. Max allowed: 1024", ws_pkt.len);
            httpd_ws_frame_t close_pkt;
            memset(&close_pkt, 0, sizeof(httpd_ws_frame_t));
            close_pkt.type = HTTPD_WS_TYPE_CLOSE;
            close_pkt.len = 0;
            httpd_ws_send_frame_async(s_server, httpd_req_to_sockfd(req), &close_pkt);
            remove_ws_client_fd(httpd_req_to_sockfd(req));
            return ESP_FAIL;
        }

        buf = calloc(1, ws_pkt.len + 1);
        if (!buf) {
            ESP_LOGE(TAG_WS, "Failed to calloc buffer for WebSocket frame");
            remove_ws_client_fd(httpd_req_to_sockfd(req));
            return ESP_ERR_NO_MEM;
        }
        ws_pkt.payload = buf;

        ret = httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG_WS, "httpd_ws_recv_frame failed to receive payload: %s for fd %d", esp_err_to_name(ret), httpd_req_to_sockfd(req));
            free(buf);
            remove_ws_client_fd(httpd_req_to_sockfd(req));
            return ret;
        }
        buf[ws_pkt.len] = '\0';
    }


    if (ws_pkt.type == HTTPD_WS_TYPE_TEXT) {
        if (buf) {
            ESP_LOGI(TAG_WS, "Received TEXT data: %s from fd %d", (char*)ws_pkt.payload, httpd_req_to_sockfd(req));

            cJSON *root = cJSON_Parse((char*)ws_pkt.payload);
            if (root) {
                cJSON *command_item = cJSON_GetObjectItem(root, "command");
                if (cJSON_IsString(command_item)) {
                    const char* command = command_item->valuestring;

                    if (strcmp(command, "setmode") == 0) {
                        cJSON *mode_item = cJSON_GetObjectItem(root, "mode");
                        if (cJSON_IsNumber(mode_item)) {
                            int mode_val = mode_item->valueint;
                            if (mode_val >= 0 && mode_val <= 2) {
                                shutter_sensor_set_mode((measurement_mode_t)mode_val);
                                ESP_LOGI(TAG_WS, "Mode set to %d via WS from fd %d", mode_val, httpd_req_to_sockfd(req));
                            } else {
                                ESP_LOGW(TAG_WS, "Invalid mode value %d received from fd %d", mode_val, httpd_req_to_sockfd(req));
                            }
                        } else {
                             ESP_LOGW(TAG_WS, "'setmode' command received without valid 'mode' field from fd %d", httpd_req_to_sockfd(req));
                        }
                    } else if (strcmp(command, "reset") == 0) {
                        shutter_sensor_reset_all_idle();
                         ESP_LOGI(TAG_WS, "Sensors reset via WS from fd %d", httpd_req_to_sockfd(req));
                    } else {
                         ESP_LOGW(TAG_WS, "Unknown command '%s' received from fd %d", command, httpd_req_to_sockfd(req));
                    }
                } else {
                     ESP_LOGW(TAG_WS, "Received non-string or missing 'command' field from fd %d", httpd_req_to_sockfd(req));
                }
                cJSON_Delete(root);
            } else {
                ESP_LOGW(TAG_WS, "Failed to parse received JSON from fd %d", httpd_req_to_sockfd(req));
            }
        } else {
             ESP_LOGD(TAG_WS, "Received empty TEXT frame from fd %d", httpd_req_to_sockfd(req));
        }
    } else if (ws_pkt.type == HTTPD_WS_TYPE_CLOSE) {
        ESP_LOGI(TAG_WS, "Received CLOSE frame from fd %d. Closing connection.", httpd_req_to_sockfd(req));
        remove_ws_client_fd(httpd_req_to_sockfd(req));
    } else if (ws_pkt.type == HTTPD_WS_TYPE_PING) {
        ESP_LOGD(TAG_WS, "Received PING frame from fd %d. Sending PONG.", httpd_req_to_sockfd(req));
        httpd_ws_frame_t pong_pkt;
        memset(&pong_pkt, 0, sizeof(httpd_ws_frame_t));
        pong_pkt.type = HTTPD_WS_TYPE_PONG;
        pong_pkt.len = ws_pkt.len;
        pong_pkt.payload = ws_pkt.payload;

        ret = httpd_ws_send_frame_async(s_server, httpd_req_to_sockfd(req), &pong_pkt);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG_WS, "Failed to send PONG: %s", esp_err_to_name(ret));
            remove_ws_client_fd(httpd_req_to_sockfd(req));
        }
    } else if (ws_pkt.type == HTTPD_WS_TYPE_PONG) {
        ESP_LOGD(TAG_WS, "Received PONG frame from fd %d.", httpd_req_to_sockfd(req));
    } else {
        ESP_LOGW(TAG_WS, "Received Unhandled WebSocket frame type: %d from fd %d", ws_pkt.type, httpd_req_to_sockfd(req));
        httpd_ws_frame_t close_pkt;
        memset(&close_pkt, 0, sizeof(httpd_ws_frame_t));
        close_pkt.type = HTTPD_WS_TYPE_CLOSE;
        close_pkt.len = 0;
        httpd_ws_send_frame_async(s_server, httpd_req_to_sockfd(req), &close_pkt);
        remove_ws_client_fd(httpd_req_to_sockfd(req));
        return ESP_FAIL;
    }

    if (buf) free(buf);
    return ESP_OK;
}


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
        ESP_LOGE(TAG_HTTP, "Failed to open file: %s, errno: %d (%s)", full_path, errno, strerror(errno));
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, content_type);
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store, must-revalidate");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");

    #define FILE_CHUNK_SIZE 4096
    char *chunk = malloc(FILE_CHUNK_SIZE);
    if (!chunk) {
        ESP_LOGE(TAG_HTTP, "Failed to allocate buffer for sending file");
        close(fd);
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    ssize_t read_bytes;
    esp_err_t ret = ESP_OK;
    do {
        read_bytes = read(fd, chunk, FILE_CHUNK_SIZE);
        if (read_bytes == -1) {
            ESP_LOGE(TAG_HTTP, "Error reading from file: %s, errno: %d (%s)", full_path, errno, strerror(errno));
            ret = ESP_FAIL;
            break;
        }
        if (read_bytes > 0) {
            if (httpd_resp_send_chunk(req, chunk, read_bytes) != ESP_OK) {
                ESP_LOGE(TAG_HTTP, "File sending failed for: %s", full_path);
                ret = ESP_FAIL;
                break;
            }
        }
    } while (read_bytes > 0);

    free(chunk);
    close(fd);

    if (ret == ESP_OK) {
        ESP_LOGD(TAG_HTTP, "File sending complete: %s", full_path);
        if (httpd_resp_send_chunk(req, NULL, 0) != ESP_OK) {
            ESP_LOGE(TAG_HTTP, "Failed to send final null chunk for %s", full_path);
            return ESP_FAIL;
        }
    } else {
        ESP_LOGE(TAG_HTTP, "File serving failed for %s before completion.", full_path);
        return ESP_FAIL;
    }
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
static esp_err_t favicon_ico_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/favicon.ico", "image/x-icon");
}
static esp_err_t apple_touch_icon_png_get_handler(httpd_req_t *req) {
    return serve_file_from_spiffs(req, "/apple-touch-icon.png", "image/png"); // Matches filename in spiffs_image
}


// Handler for setting sensor mode via HTTP POST
static esp_err_t set_mode_handler(httpd_req_t *req) {
    char buf[32]; // Small buffer for simple data
    int ret, remaining = req->content_len;
    
    if (remaining > sizeof(buf) - 1) {
        ESP_LOGE(TAG_HTTP, "/api/setmode: Request body too large (%d bytes, max %zu)", remaining, sizeof(buf) - 1);
        httpd_resp_send_err(req, HTTPD_413_CONTENT_TOO_LARGE, "Request body too large");
        return ESP_FAIL;
    }

    ret = httpd_req_recv(req, buf, remaining);
    if (ret <= 0) {
        if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
            httpd_resp_send_408(req);
        } else {
            httpd_resp_send_500(req);
        }
        return ESP_FAIL;
    }
    buf[ret] = '\0';

    cJSON *root = cJSON_Parse(buf);
    if (root) {
        cJSON *mode_item = cJSON_GetObjectItem(root, "mode");
        if (cJSON_IsNumber(mode_item)) {
            int mode_val = mode_item->valueint;
            if (mode_val >= 0 && mode_val <= 2) {
                shutter_sensor_set_mode((measurement_mode_t)mode_val);
                ESP_LOGI(TAG_HTTP, "Sensor mode set to %d via HTTP POST", mode_val);
                httpd_resp_sendstr(req, "Mode set successfully");
            } else {
                ESP_LOGW(TAG_HTTP, "Invalid mode value %d received", mode_val);
                httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid mode value");
            }
        } else {
            ESP_LOGW(TAG_HTTP, "Missing or invalid 'mode' field in JSON");
            httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing or invalid 'mode' field");
        }
        cJSON_Delete(root);
    } else {
        ESP_LOGW(TAG_HTTP, "Failed to parse JSON for /api/setmode");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON data");
    }
    return ESP_OK;
}

// Handler for resetting sensors via HTTP POST
static esp_err_t reset_handler(httpd_req_t *req) {
    shutter_sensor_reset_all_idle();
    ESP_LOGI(TAG_HTTP, "Sensors reset via HTTP POST");
    httpd_resp_sendstr(req, "Sensors reset");
    return ESP_OK;
}

// NEW: WiFi Status GET handler
static esp_err_t wifi_status_get_handler(httpd_req_t *req) {
    wifi_manager_status_t status;
    if (wifi_manager_get_status(&status) != ESP_OK) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to get WiFi status");
        return ESP_FAIL;
    }

    cJSON *root = cJSON_CreateObject();
    if (!root) {
        ESP_LOGE(TAG_HTTP, "Failed to create cJSON object for WiFi status");
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    cJSON_AddStringToObject(root, "mode", (status.mode == WIFI_MANAGER_MODE_STA) ? "STA" : (status.mode == WIFI_MANAGER_MODE_AP ? "AP" : "OFF"));
    cJSON_AddBoolToObject(root, "isConnected", status.is_connected);
    cJSON_AddStringToObject(root, "ssid", status.ssid);
    cJSON_AddStringToObject(root, "ipAddress", status.ip_addr);
    cJSON_AddNumberToObject(root, "rssi", status.rssi);

    char *json_string = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (!json_string) {
        ESP_LOGE(TAG_HTTP, "Failed to print WiFi status JSON");
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, json_string);
    free(json_string);
    return ESP_OK;
}

// NEW: WiFi Set/Save POST handler
static esp_err_t wifi_set_post_handler(httpd_req_t *req) {
    char buf[128]; // Increased buffer for SSID/pass
    int ret, remaining = req->content_len;
    
    if (remaining > sizeof(buf) - 1) {
        ESP_LOGE(TAG_HTTP, "/api/wifi/set: Request body too large (%d bytes, max %zu)", remaining, sizeof(buf) - 1);
        httpd_resp_send_err(req, HTTPD_413_CONTENT_TOO_LARGE, "Request body too large");
        return ESP_FAIL;
    }

    ret = httpd_req_recv(req, buf, remaining);
    if (ret <= 0) {
        if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
            httpd_resp_send_408(req);
        } else {
            httpd_resp_send_500(req);
        }
        return ESP_FAIL;
    }
    buf[ret] = '\0';

    cJSON *root = cJSON_Parse(buf);
    if (root) {
        cJSON *ssid_item = cJSON_GetObjectItem(root, "ssid");
        cJSON *password_item = cJSON_GetObjectItem(root, "password");
        cJSON *force_ap_item = cJSON_GetObjectItem(root, "forceAp"); // This item will still be passed from JS

        const char *ssid = cJSON_IsString(ssid_item) ? ssid_item->valuestring : "";
        const char *password = cJSON_IsString(password_item) ? password_item->valuestring : "";
        bool force_ap = cJSON_IsBool(force_ap_item) ? cJSON_IsTrue(force_ap_item) : false; // Use the JS-derived force_ap

        if (strlen(ssid) == 0 && !force_ap) {
            ESP_LOGW(TAG_HTTP, "SSID is empty and force_ap is false, rejecting.");
            httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "SSID cannot be empty unless forcing AP mode");
            cJSON_Delete(root);
            return ESP_FAIL;
        }

        if (wifi_manager_set_credentials(ssid, password, force_ap) != ESP_OK) {
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to save credentials");
            cJSON_Delete(root);
            return ESP_FAIL;
        }

        // Trigger a WiFi mode change based on the saved settings
        // This logic is now handled by the UI immediately rebooting, which leads wifi_manager_start()
        // on boot to apply new credentials. No immediate mode change needed here.
        // If it was already in AP mode due to `force_ap`, then it will just stay in AP mode.
        // If it was in STA, and new credentials are set (or cleared), it will try to reconnect or go to AP.
        // The reboot will ensure the state is fully applied.

        httpd_resp_sendstr(req, "WiFi settings saved."); // Changed from "saved and applied." as reboot follows.
        cJSON_Delete(root);
    } else {
        ESP_LOGW(TAG_HTTP, "Failed to parse JSON for /api/wifi/set");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON data");
    }
    return ESP_OK;
}

// NEW: WiFi Forget POST handler
static esp_err_t wifi_forget_post_handler(httpd_req_t *req) {
    // Note: This function reboots the device for a clean state after forgetting.
    // A reboot ensures all internal states are reset and NVS changes are fully applied.
    wifi_manager_forget_credentials(true); // True to reboot after clearing
    httpd_resp_sendstr(req, "Forgetting WiFi credentials and rebooting...");
    return ESP_OK; // ESP will reboot, so this response might not fully send.
}

// REMOVED: wifi_revert_to_sta_post_handler - corresponding UI button is removed.
// static esp_err_t wifi_revert_to_sta_post_handler(httpd_req_t *req) {
//     // Only allow if currently in AP mode
//     if (wifi_manager_get_current_mode() != WIFI_MANAGER_MODE_AP) {
//         httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Not in AP mode to revert to STA.");
//         return ESP_FAIL;
//     }

//     ESP_LOGI(TAG_HTTP, "Reverting to STA mode from AP via API call.");
//     wifi_manager_connect_sta(); // This will stop AP and try STA
//     httpd_resp_sendstr(req, "Attempting to revert to STA mode.");
//     return ESP_OK;
// }

// NEW: Device Reboot API handler implementation
static esp_err_t reboot_post_handler(httpd_req_t *req) {
    ESP_LOGW(TAG_HTTP, "Reboot request received! Restarting ESP32...");
    httpd_resp_sendstr(req, "Rebooting..."); // Send response before rebooting
    vTaskDelay(pdMS_TO_TICKS(100)); // Give some time for response to send
    esp_restart();
    // This line will not be reached
    return ESP_OK;
}


static void start_webserver(void) {
    if (s_server != NULL) {
        ESP_LOGI(TAG_HTTP, "Webserver already started.");
        return;
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.lru_purge_enable = true;
    config.max_uri_handlers = 20; // Increased to accommodate new API endpoints
    config.max_open_sockets = MAX_WS_CLIENTS + 4;
    config.server_port = 80;
    config.close_fn = httpd_sess_close_handler;

    ESP_LOGI(TAG_HTTP, "Starting HTTP server on port: '%d'", config.server_port);
    if (httpd_start(&s_server, &config) == ESP_OK) {
        ESP_LOGI(TAG_HTTP, "HTTP server started successfully, registering URI handlers.");
        s_webserver_started = true;

        // --- All Main App UI Handlers ---
        httpd_uri_t root_uri = { .uri = "/", .method = HTTP_GET, .handler = root_get_handler, };
        httpd_register_uri_handler(s_server, &root_uri);
        httpd_uri_t styles_css_uri = { .uri = "/static/css/styles.css", .method = HTTP_GET, .handler = styles_css_get_handler, };
        httpd_register_uri_handler(s_server, &styles_css_uri);
        httpd_uri_t static_js_ui_helpers_uri = { .uri = "/static/js/ui-helpers.js", .method = HTTP_GET, .handler = static_js_ui_helpers_get_handler, };
        httpd_register_uri_handler(s_server, &static_js_ui_helpers_uri);
        httpd_uri_t static_js_shutter_calc_uri = { .uri = "/static/js/shutter-calcs.js", .method = HTTP_GET, .handler = static_js_shutter_calculations_get_handler, };
        httpd_register_uri_handler(s_server, &static_js_shutter_calc_uri);
        httpd_uri_t static_js_api_uri = { .uri = "/static/js/api.js", .method = HTTP_GET, .handler = static_js_api_get_handler, };
        httpd_register_uri_handler(s_server, &static_js_api_uri);
        httpd_uri_t static_js_config_panel_uri = { .uri = "/static/js/config-panel.js", .method = HTTP_GET, .handler = static_js_config_panel_get_handler, };
        httpd_register_uri_handler(s_server, &static_js_config_panel_uri);
        httpd_uri_t static_js_data_updater_uri = { .uri = "/static/js/data-updater.js", .method = HTTP_GET, .handler = static_js_data_updater_get_handler, };
        httpd_register_uri_handler(s_server, &static_js_data_updater_uri);
        httpd_uri_t static_js_main_uri = { .uri = "/static/js/main.js", .method = HTTP_GET, .handler = static_js_main_get_handler, };
        httpd_register_uri_handler(s_server, &static_js_main_uri);
        httpd_uri_t static_js_results_log_uri = { .uri = "/static/js/results-log.js", .method = HTTP_GET, .handler = static_js_results_log_get_handler, };
        httpd_register_uri_handler(s_server, &static_js_results_log_uri);
        httpd_uri_t favicon_ico_uri = { .uri = "/favicon.ico", .method = HTTP_GET, .handler = favicon_ico_get_handler, };
        httpd_register_uri_handler(s_server, &favicon_ico_uri);
        httpd_uri_t apple_touch_icon_png_uri = { .uri = "/apple-touch-icon.png", .method = HTTP_GET, .handler = apple_touch_icon_png_get_handler, };
        httpd_register_uri_handler(s_server, &apple_touch_icon_png_uri);

        // --- Sensor API Handlers ---
        httpd_uri_t set_mode_uri = { .uri = "/api/setmode", .method = HTTP_POST, .handler = set_mode_handler, };
        httpd_register_uri_handler(s_server, &set_mode_uri);
        httpd_uri_t reset_uri = { .uri = "/api/reset", .method = HTTP_POST, .handler = reset_handler, };
        httpd_register_uri_handler(s_server, &reset_uri);

        // --- NEW: WiFi API Handlers ---
        httpd_uri_t wifi_status_uri = { .uri = "/api/wifi/status", .method = HTTP_GET, .handler = wifi_status_get_handler, };
        httpd_register_uri_handler(s_server, &wifi_status_uri);
        httpd_uri_t wifi_set_uri = { .uri = "/api/wifi/set", .method = HTTP_POST, .handler = wifi_set_post_handler, };
        httpd_register_uri_handler(s_server, &wifi_set_uri);
        httpd_uri_t wifi_forget_uri = { .uri = "/api/wifi/forget", .method = HTTP_POST, .handler = wifi_forget_post_handler, };
        httpd_register_uri_handler(s_server, &wifi_forget_uri);
        // REMOVED: httpd_uri_t wifi_revert_to_sta_uri = { .uri = "/api/wifi/revert_to_sta", .method = HTTP_POST, .handler = wifi_revert_to_sta_post_handler, };
        // REMOVED: httpd_register_uri_handler(s_server, &wifi_revert_to_sta_uri);

        // NEW: General Device Actions API Handler
        httpd_uri_t reboot_uri = { .uri = "/api/reboot", .method = HTTP_POST, .handler = reboot_post_handler, }; // ADDED THIS LINE
        httpd_register_uri_handler(s_server, &reboot_uri); // ADDED THIS LINE

        // --- WebSocket Handler ---
        httpd_uri_t ws_uri = { .uri = "/ws", .method = HTTP_GET, .handler = ws_data_handler, .is_websocket = true, };
        httpd_register_uri_handler(s_server, &ws_uri);

    } else {
        ESP_LOGE(TAG_HTTP, "Error starting HTTP server!");
        s_server = NULL;
        s_webserver_started = false;
    }
}

static void stop_webserver(void) {
    if (s_server == NULL) {
        ESP_LOGI(TAG_HTTP, "Webserver not started.");
        return;
    }
    httpd_stop(s_server);
    s_server = NULL;
    s_webserver_started = false;
    ESP_LOGI(TAG_HTTP, "Webserver stopped.");
}


static void initialise_mdns(void)
{
    // NEW: Check if mDNS is already initialized
    if (s_mdns_initialized) {
        ESP_LOGI(TAG_MDNS, "mDNS already initialized.");
        return;
    }

    esp_err_t err = mdns_init();
    if (err) {
        ESP_LOGE(TAG_MDNS, "MDNS Init failed: %d", err);
        s_mdns_initialized = false; // Ensure flag is false on failure
        return;
    }
    s_mdns_initialized = true; // Set flag only on successful initialization
    ESP_LOGI(TAG_MDNS, "MDNS Init successful");

    err = mdns_hostname_set(MDNS_HOSTNAME);
    if (err) {
        ESP_LOGE(TAG_MDNS, "MDNS hostname set failed: %d", err);
        return;
    }
    ESP_LOGI(TAG_MDNS, "MDNS hostname set to '%s.local'", MDNS_HOSTNAME);

    err = mdns_instance_name_set(MDNS_INSTANCE_NAME);
    if (err) {
        ESP_LOGE(TAG_MDNS, "MDNS instance name set failed: %d", err);
        return;
    }
    ESP_LOGI(TAG_MDNS, "MDNS instance name set to '%s'", MDNS_INSTANCE_NAME);

    mdns_txt_item_t serviceTxtData[1] = {
        {"board","esp32"}
    };
    err = mdns_service_add("ESP32 Web Server", "_http", "_tcp", 80, serviceTxtData, 1);
    if (err) {
        ESP_LOGE(TAG_MDNS, "MDNS service add failed: %d", err);
        return;
    }
    ESP_LOGI(TAG_MDNS, "MDNS service _http._tcp advertised on port 80");
}

static void deinitialise_mdns(void) {
    // NEW: Only deinitialize if mDNS was actually initialized
    if (!s_mdns_initialized) {
        ESP_LOGI(TAG_MDNS, "mDNS not initialized, skipping deinitialization.");
        return;
    }
    mdns_service_remove_all();
    mdns_free();
    s_mdns_initialized = false; // Reset flag after freeing mDNS resources
    ESP_LOGI(TAG_MDNS, "mDNS deinitialized.");
}

static void init_spiffs(void) {
    ESP_LOGI(TAG_SPIFFS, "Initializing SPIFFS");
    esp_vfs_spiffs_conf_t conf = {
      .base_path = SPIFFS_BASE_PATH,
      .partition_label = NULL,
      .max_files = 15,
      .format_if_mount_failed = false
    };
    esp_err_t ret = esp_vfs_spiffs_register(&conf);

    if (ret != ESP_OK) {
        if (ret == ESP_FAIL) {
            ESP_LOGE(TAG_SPIFFS, "Failed to mount or format filesystem. Formatting...");
            conf.format_if_mount_failed = true;
            ret = esp_vfs_spiffs_register(&conf);
            if (ret != ESP_OK) {
                 ESP_LOGE(TAG_SPIFFS, "Failed to format and mount SPIFFS (%s)", esp_err_to_name(ret));
                 return;
            }
             ESP_LOGI(TAG_SPIFFS, "SPIFFS formatted and mounted.");
        } else if (ret == ESP_ERR_NOT_FOUND) {
            ESP_LOGE(TAG_SPIFFS, "Failed to find SPIFFS partition");
             return;
        } else {
            ESP_LOGE(TAG_SPIFFS, "Failed to initialize SPIFFS (%s)", esp_err_to_name(ret));
            return;
        }
    }

    size_t total = 0, used = 0;
    ret = esp_spiffs_info(conf.partition_label, &total, &used);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG_SPIFFS, "Failed to get SPIFFS info (%s)", esp_err_to_name(ret));
    } else {
        ESP_LOGI(TAG_SPIFFS, "SPIFFS: Total: %d, Used: %d", total, used);
    }
}

// NEW: WiFi Manager Event Callback
static void wifi_manager_event_handler(wifi_manager_event_id_t event_id, void* event_data) {
    ESP_LOGI(TAG, "WiFi Manager Event Received: %d", event_id);

    switch (event_id) {
        case WIFI_MANAGER_EVENT_STA_CONNECTED:
        case WIFI_MANAGER_EVENT_STA_GOT_IP:
            ESP_LOGI(TAG, "STA Connected/Got IP. Starting mDNS.");
            initialise_mdns();
            // Webserver is always started, no need to restart it.
            break;
        case WIFI_MANAGER_EVENT_STA_DISCONNECTED:
            ESP_LOGW(TAG, "STA Disconnected. Stopping mDNS.");
            deinitialise_mdns();
            // Webserver remains active so user can reconfigure
            break;
        case WIFI_MANAGER_EVENT_AP_STARTED:
            ESP_LOGI(TAG, "AP Started. Stopping mDNS (if active).");
            deinitialise_mdns(); // Ensure mDNS is off in AP mode
            // Webserver is always started. Its IP address is 192.168.4.1
            break;
        case WIFI_MANAGER_EVENT_AP_STOPPED:
            ESP_LOGI(TAG, "AP Stopped. No action on mDNS as it should already be off.");
            // Webserver remains active. WiFi will attempt STA next if configured.
            break;
        default:
            break;
    }
}

void app_main(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
      ESP_ERROR_CHECK(nvs_flash_erase());
      ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    init_spiffs(); // Initialize SPIFFS first to serve files

    shutter_sensor_init();

    g_shutter_data_mutex = xSemaphoreCreateMutex();
    if (g_shutter_data_mutex == NULL) {
        ESP_LOGE(TAG, "Failed to create shutter data mutex!");
        return;
    } else {
        ESP_LOGI(TAG, "Shutter data mutex created.");
    }

    ws_clients_mutex = xSemaphoreCreateMutex();
    if (ws_clients_mutex == NULL) {
        ESP_LOGE(TAG, "Failed to create WebSocket clients mutex!");
        return;
    } else {
        ESP_LOGI(TAG, "WebSocket clients mutex created.");
    }

     // Initialize WiFi Manager and register event callback
    if (wifi_manager_init() != ESP_OK) {
         ESP_LOGE(TAG, "Failed to initialize WiFi Manager!");
         return;
    }
    wifi_manager_set_event_callback(wifi_manager_event_handler);


    if (xTaskCreate(sensor_task, "sensor_task", 4096, NULL, tskIDLE_PRIORITY + 3, NULL) != pdPASS) {
        ESP_LOGE(TAG, "Failed to create sensor_task.");
    } else {
        ESP_LOGI(TAG, "sensor_task created.");
    }

    // Start the webserver that serves the main app UI FIRST.
    // It will be accessible regardless of STA/AP mode.
    start_webserver();

    // Then, start WiFi. The event handler will handle mDNS initialization and deinitialization.
    wifi_manager_start(false); // Pass 'false' to wifi_manager_start to not force AP on boot.
                               // It will try STA if credentials exist, otherwise default to AP.
}

static void sensor_task(void *pvParameters) {
    ESP_LOGI(TAG, "Sensor task started.");
    shutter_data_values_t latest_measurement_data;
    memset(&latest_measurement_data, 0, sizeof(shutter_data_values_t));

    while (1) {
        bool measurement_is_complete = shutter_sensor_is_measurement_complete();
        sensor_operational_state_t s1_state, s2_state, s3_state;
        shutter_sensor_get_states(&s1_state, &s2_state, &s3_state);
        measurement_mode_t current_mode_task = shutter_sensor_get_current_mode();
        bool measurement_in_progress_now = false;

        // Check if any active sensor is awaiting close
        bool s1_is_active = shutter_sensor_is_active(SENSOR_1_PIN, current_mode_task);
        bool s2_is_active = shutter_sensor_is_active(SENSOR_2_PIN, current_mode_task);
        bool s3_is_active = shutter_sensor_is_active(SENSOR_3_PIN, current_mode_task);

        if ( (s1_is_active && s1_state == SENSOR_AWAITING_CLOSE) ||
             (s2_is_active && s2_state == SENSOR_AWAITING_CLOSE) ||
             (s3_is_active && s3_state == SENSOR_AWAITING_CLOSE) ) {
            measurement_in_progress_now = true;
        }

        gpio_set_level(LED_PIN, measurement_in_progress_now ? 0 : 1); // Assuming LED_PIN is active-low

        if (measurement_is_complete) {
            ESP_LOGI(TAG, "Measurement complete detected by sensor_task. Getting data.");
            gpio_set_level(LED_PIN, 0); // Briefly turn LED ON (active-low) to indicate data capture

            shutter_sensor_get_data(&latest_measurement_data);

            if (g_shutter_data_mutex != NULL && xSemaphoreTake(g_shutter_data_mutex, portMAX_DELAY) == pdTRUE) {
                g_latest_shutter_data = latest_measurement_data;
                xSemaphoreGive(g_shutter_data_mutex);
                ESP_LOGD(TAG, "Global shutter data updated.");

                // Send data via WebSocket ONLY if the webserver is running AND WiFi is active (STA or AP)
                wifi_manager_mode_t current_wifi_mode = wifi_manager_get_current_mode();
                if (s_webserver_started && current_wifi_mode != WIFI_MANAGER_MODE_OFF) {
                    char* data_json = generate_shutter_data_json();
                    if (data_json) {
                        send_ws_data_to_all_clients(data_json);
                        free(data_json);
                    }
                } else {
                     ESP_LOGD(TAG, "Skipping WS send: Webserver not started or WiFi not active.");
                }

            } else {
                ESP_LOGE(TAG, "Mutex error in sensor_task, cannot update global data or send WS data!");
            }
            shutter_sensor_reset_all_idle(); // Reset sensor states after getting data
            gpio_set_level(LED_PIN, 1); // Turn LED OFF (active-low) after processing
             ESP_LOGI(TAG, "Sensor states reset.");
        }
        vTaskDelay(pdMS_TO_TICKS(50)); // Check every 50ms
    }
}