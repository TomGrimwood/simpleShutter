#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_http_server.h"
#include "cJSON.h"

#include "lwip/err.h"
#include "lwip/sys.h"

#include "shutter_sensor.h" // Assuming this contains LED_PIN, SENSOR_X_PIN, etc.

#include "esp_spiffs.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

#include "mdns.h" // Added for mDNS

#define EXAMPLE_ESP_WIFI_SSID      "INYOURWALLS"
#define EXAMPLE_ESP_WIFI_PASS      "SUVASMASH"
#define MDNS_HOSTNAME              "esp" // mDNS Hostname
#define MDNS_INSTANCE_NAME         "ESP32 Shutter Sensor" // mDNS Instance Name (optional)


// Define our own retry limit if CONFIG_ESP_MAXIMUM_RETRY is not directly available
#ifndef CONFIG_ESP_MAXIMUM_RETRY
#define WIFI_MAXIMUM_RETRY  5
#else
#define WIFI_MAXIMUM_RETRY  CONFIG_ESP_MAXIMUM_RETRY
#endif

static const char *TAG = "wifi station";
static const char *TAG_HTTP = "http server";
static const char *TAG_MAIN = "main_app";
static const char *TAG_SPIFFS = "spiffs";
static const char *TAG_WS = "websocket";
static const char *TAG_MDNS = "mdns";


static shutter_data_values_t g_latest_shutter_data;
static SemaphoreHandle_t g_shutter_data_mutex;

// --- Forward declarations ---
static void send_ws_data_to_all_clients(const char* data_json_string);
static char* generate_shutter_data_json(void);
static esp_err_t ws_data_handler(httpd_req_t *req);
static void initialise_mdns(void);
static void httpd_sess_close_handler(httpd_handle_t hd, int sockfd);
static void start_webserver(void); // <<<< ADDED FORWARD DECLARATION
static void sensor_task(void *pvParameters); // <<<< ADDED FORWARD DECLARATION


#define SPIFFS_BASE_PATH "/spiffs"

static int s_retry_num = 0;
static bool s_webserver_started = false;
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
        bool found = false; // To log only if actually removed
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

// This function is called by the HTTP server core when it closes a socket.
static void httpd_sess_close_handler(httpd_handle_t hd, int sockfd) {
    ESP_LOGI(TAG_HTTP, "HTTPD session with sockfd %d closed by server core.", sockfd);
    // Attempt to remove this sockfd from our WebSocket client list,
    // in case it was a WebSocket client that disconnected uncleanly
    // and our other mechanisms didn't catch it.
    remove_ws_client_fd(sockfd);
}


static char* generate_shutter_data_json(void) {
    char* json_string = NULL;
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
                // Error sending, assume client is disconnected or problematic.
                // Remove the client_fd by shifting remaining elements left.
                for (int j = i; j < ws_clients_count - 1; j++) {
                    ws_clients_fds[j] = ws_clients_fds[j + 1];
                }
                ws_clients_count--;
                // Do not increment 'i'. The next element is now at index 'i',
                // or if it was the last element, ws_clients_count has decreased.
            } else {
                ESP_LOGD(TAG_WS, "Sent WS data to client fd %d", client_fd);
                i++; // Increment 'i' only if send was successful.
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
        ESP_LOGE(TAG_WS, "httpd_ws_recv_frame failed to get frame info: %s for fd %d", esp_err_to_name(ret), httpd_req_to_sockfd(req));
        remove_ws_client_fd(httpd_req_to_sockfd(req));
        return ret; 
    }

    ESP_LOGD(TAG_WS, "WebSocket frame type %d, len %d from fd %d", ws_pkt.type, ws_pkt.len, httpd_req_to_sockfd(req));

    if (ws_pkt.len > 0) {
        if (ws_pkt.len > 1024) { 
            ESP_LOGE(TAG_WS, "WS payload too large: %d bytes. Max allowed: 1024", ws_pkt.len);
            remove_ws_client_fd(httpd_req_to_sockfd(req));
            return ESP_FAIL; 
        }

        buf = calloc(1, ws_pkt.len + 1); 
        if (!buf) {
            ESP_LOGE(TAG_WS, "Failed to calloc buffer for WebSocket frame");
            remove_ws_client_fd(httpd_req_to_sockfd(req)); 
            return ESP_FAIL; 
        }
        ws_pkt.payload = buf;
        ret = httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG_WS, "httpd_ws_recv_frame failed to receive payload: %s", esp_err_to_name(ret));
            free(buf);
            remove_ws_client_fd(httpd_req_to_sockfd(req));
            return ret; 
        }
        buf[ws_pkt.len] = '\0'; 
    }

    if (ws_pkt.type == HTTPD_WS_TYPE_TEXT) {
        if (buf) { 
            ESP_LOGI(TAG_WS, "Received TEXT data: %s from fd %d", (char*)ws_pkt.payload, httpd_req_to_sockfd(req));
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
        ESP_LOGD(TAG_WS, "Received Unhandled WebSocket frame type: %d", ws_pkt.type);
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
    return serve_file_from_spiffs(req, "/apple-touch-icon.png", "image/png");
}

static void initialise_mdns(void)
{
    esp_err_t err = mdns_init();
    if (err) {
        ESP_LOGE(TAG_MDNS, "MDNS Init failed: %d", err);
        return;
    }
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


static void event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
        ESP_LOGI(TAG, "WIFI_EVENT_STA_START: connecting to the AP");
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGI(TAG, "WIFI_EVENT_STA_DISCONNECTED: disconnected from the AP");
        if (s_webserver_started && s_server != NULL) {
            ESP_LOGI(TAG_HTTP, "Webserver potentially affected by disconnect. WS clients may be orphaned.");
        }
        if (s_retry_num < WIFI_MAXIMUM_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "Retrying to connect to the AP (%d/%d)", s_retry_num, WIFI_MAXIMUM_RETRY);
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
        initialise_mdns(); 
    }
}

static esp_err_t set_mode_handler(httpd_req_t *req) {
    char buf[100]; 
    int ret, remaining = req->content_len;

    if (remaining == 0) {
        ESP_LOGE(TAG_HTTP, "set_mode_handler: No content received.");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Request body is empty");
        return ESP_FAIL;
    }
    if (remaining > sizeof(buf) - 1) {
        ESP_LOGE(TAG_HTTP, "set_mode_handler: Request body too large (%d bytes, max %zu)", remaining, sizeof(buf) -1);
        httpd_resp_send_err(req, HTTPD_413_CONTENT_TOO_LARGE, "Request body too large");
        return ESP_FAIL;
    }

    ret = httpd_req_recv(req, buf, remaining);
    if (ret <= 0) {
        if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
            httpd_resp_send_408(req);
        } else if (ret < 0) {
            ESP_LOGE(TAG_HTTP, "set_mode_handler: Error receiving request body: %d", ret);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to receive request data");
        }
        return ESP_FAIL;
    }

    buf[ret] = '\0'; 
    ESP_LOGD(TAG_HTTP, "set_mode_handler: Received JSON: %s", buf);

    cJSON *root = cJSON_Parse(buf);
    if (!root) {
        ESP_LOGE(TAG_HTTP, "set_mode_handler: Invalid JSON: %s", cJSON_GetErrorPtr());
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON format");
        return ESP_FAIL;
    }

    cJSON *mode_item = cJSON_GetObjectItem(root, "mode");
    if (!cJSON_IsNumber(mode_item)) {
        cJSON_Delete(root);
        ESP_LOGE(TAG_HTTP, "set_mode_handler: 'mode' field is not a number or missing.");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "JSON 'mode' field missing or not a number");
        return ESP_FAIL;
    }

    int mode_val = mode_item->valueint;
    cJSON_Delete(root);

    if (mode_val >= 0 && mode_val <= 2) { 
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

        char* current_data_json = generate_shutter_data_json();
        if (current_data_json) {
            send_ws_data_to_all_clients(current_data_json);
            free(current_data_json);
        }
        return ESP_OK;
    } else {
        ESP_LOGE(TAG_HTTP, "set_mode_handler: Invalid mode value: %d", mode_val);
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid mode value provided");
        return ESP_FAIL;
    }
}

static esp_err_t reset_handler(httpd_req_t *req) {
    shutter_sensor_reset_all_idle();
    ESP_LOGI(TAG_HTTP, "Sensors reset via API");

    const char* resp_json = "{\"success\":true}";
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, resp_json, strlen(resp_json));

    char* current_data_json = generate_shutter_data_json();
    if (current_data_json) {
        send_ws_data_to_all_clients(current_data_json);
        free(current_data_json);
    }
    return ESP_OK;
}

static void start_webserver(void) {
    if (s_server != NULL) {
        ESP_LOGI(TAG_HTTP, "Webserver already started.");
        return;
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.lru_purge_enable = true;
    config.max_uri_handlers = 14; // Adjusted: /api/getdata (HTTP) removed, /ws (WebSocket) provides data.
    config.max_open_sockets = MAX_WS_CLIENTS + 4; 
    config.server_port = 80;
    config.close_fn = httpd_sess_close_handler; 

    ESP_LOGI(TAG_HTTP, "Starting HTTP server on port: '%d'", config.server_port);
    if (httpd_start(&s_server, &config) == ESP_OK) {
        ESP_LOGI(TAG_HTTP, "HTTP server started successfully, registering URI handlers.");
        s_webserver_started = true;

        httpd_uri_t root_uri = {
            .uri      = "/",
            .method   = HTTP_GET,
            .handler  = root_get_handler,
        };
        httpd_register_uri_handler(s_server, &root_uri);

        httpd_uri_t styles_css_uri = {
            .uri      = "/static/css/styles.css",
            .method   = HTTP_GET,
            .handler  = styles_css_get_handler,
        };
        httpd_register_uri_handler(s_server, &styles_css_uri);

        httpd_uri_t static_js_ui_helpers_uri = {
            .uri      = "/static/js/ui-helpers.js",
            .method   = HTTP_GET,
            .handler  = static_js_ui_helpers_get_handler,
        };
        httpd_register_uri_handler(s_server, &static_js_ui_helpers_uri);

        httpd_uri_t static_js_shutter_calc_uri = {
            .uri      = "/static/js/shutter-calcs.js",
            .method   = HTTP_GET,
            .handler  = static_js_shutter_calculations_get_handler,
        };
        httpd_register_uri_handler(s_server, &static_js_shutter_calc_uri);

        httpd_uri_t static_js_api_uri = {
            .uri      = "/static/js/api.js",
            .method   = HTTP_GET,
            .handler  = static_js_api_get_handler,
        };
        httpd_register_uri_handler(s_server, &static_js_api_uri);

        httpd_uri_t static_js_config_panel_uri = {
            .uri      = "/static/js/config-panel.js",
            .method   = HTTP_GET,
            .handler  = static_js_config_panel_get_handler,
        };
        httpd_register_uri_handler(s_server, &static_js_config_panel_uri);

        httpd_uri_t static_js_data_updater_uri = {
            .uri      = "/static/js/data-updater.js",
            .method   = HTTP_GET,
            .handler  = static_js_data_updater_get_handler,
        };
        httpd_register_uri_handler(s_server, &static_js_data_updater_uri);

        httpd_uri_t static_js_main_uri = {
            .uri      = "/static/js/main.js",
            .method   = HTTP_GET,
            .handler  = static_js_main_get_handler,
        };
        httpd_register_uri_handler(s_server, &static_js_main_uri);

        httpd_uri_t static_js_results_log_uri = {
            .uri      = "/static/js/results-log.js",
            .method   = HTTP_GET,
            .handler  = static_js_results_log_get_handler,
        };
        httpd_register_uri_handler(s_server, &static_js_results_log_uri);

        httpd_uri_t set_mode_uri = {
            .uri      = "/api/setmode",
            .method   = HTTP_POST,
            .handler  = set_mode_handler,
        };
        httpd_register_uri_handler(s_server, &set_mode_uri);

        httpd_uri_t reset_uri = {
            .uri      = "/api/reset",
            .method   = HTTP_POST,
            .handler  = reset_handler,
        };
        httpd_register_uri_handler(s_server, &reset_uri);

        httpd_uri_t ws_uri = {
            .uri        = "/ws",
            .method     = HTTP_GET,
            .handler    = ws_data_handler,
            .user_ctx   = NULL,
            .is_websocket = true,
            .handle_ws_control_frames = false, 
            .supported_subprotocol = NULL
        };
        httpd_register_uri_handler(s_server, &ws_uri);

        httpd_uri_t favicon_ico_uri = {
            .uri      = "/favicon.ico",
            .method   = HTTP_GET,
            .handler  = favicon_ico_get_handler,
        };
        httpd_register_uri_handler(s_server, &favicon_ico_uri);

        httpd_uri_t apple_touch_icon_png_uri = {
            .uri      = "/apple-touch-icon.png",
            .method   = HTTP_GET,
            .handler  = apple_touch_icon_png_get_handler,
        };
        httpd_register_uri_handler(s_server, &apple_touch_icon_png_uri);

    } else {
        ESP_LOGE(TAG_HTTP, "Error starting HTTP server!");
        s_server = NULL;
        s_webserver_started = false;
    }
}

void wifi_init_sta(void) {
    ESP_LOGI(TAG, "ESP_WIFI_MODE_STA");
    ESP_ERROR_CHECK(esp_netif_init());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = EXAMPLE_ESP_WIFI_SSID,
            .password = EXAMPLE_ESP_WIFI_PASS,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
            .pmf_cfg = { 
                .capable = true,
                .required = false
            },
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
      .base_path = SPIFFS_BASE_PATH,
      .partition_label = NULL, 
      .max_files = 15,         
      .format_if_mount_failed = false 
    };
    esp_err_t ret = esp_vfs_spiffs_register(&conf);

    if (ret != ESP_OK) {
        if (ret == ESP_FAIL) {
            ESP_LOGE(TAG_SPIFFS, "Failed to mount or format filesystem");
        } else if (ret == ESP_ERR_NOT_FOUND) {
            ESP_LOGE(TAG_SPIFFS, "Failed to find SPIFFS partition");
        } else {
            ESP_LOGE(TAG_SPIFFS, "Failed to initialize SPIFFS (%s)", esp_err_to_name(ret));
        }
        return;
    }

    size_t total = 0, used = 0;
    ret = esp_spiffs_info(conf.partition_label, &total, &used);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG_SPIFFS, "Failed to get SPIFFS info (%s)", esp_err_to_name(ret));
    } else {
        ESP_LOGI(TAG_SPIFFS, "SPIFFS: Total: %d, Used: %d", total, used);
    }
}

void app_main(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
      ESP_ERROR_CHECK(nvs_flash_erase());
      ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    init_spiffs();
    shutter_sensor_init(); 

    g_shutter_data_mutex = xSemaphoreCreateMutex();
    if (g_shutter_data_mutex == NULL) {
        ESP_LOGE(TAG_MAIN, "Failed to create shutter data mutex!");
        return;
    } else {
        ESP_LOGI(TAG_MAIN, "Shutter data mutex created.");
    }

    ws_clients_mutex = xSemaphoreCreateMutex();
    if (ws_clients_mutex == NULL) {
        ESP_LOGE(TAG_MAIN, "Failed to create WebSocket clients mutex!");
        return;
    } else {
        ESP_LOGI(TAG_MAIN, "WebSocket clients mutex created.");
    }

    if (xTaskCreate(sensor_task, "sensor_task", 4096, NULL, tskIDLE_PRIORITY + 3, NULL) != pdPASS) {
        ESP_LOGE(TAG_MAIN, "Failed to create sensor_task.");
    } else {
        ESP_LOGI(TAG_MAIN, "sensor_task created.");
    }
    wifi_init_sta();
}

static void sensor_task(void *pvParameters) {
    ESP_LOGI(TAG_MAIN, "Sensor task started.");
    shutter_data_values_t latest_measurement_data;
    memset(&latest_measurement_data, 0, sizeof(shutter_data_values_t));

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

        gpio_set_level(LED_PIN, measurement_in_progress_now ? 0 : 1); 

        if (measurement_is_complete) {
            ESP_LOGI(TAG_MAIN, "Measurement complete detected by sensor_task.");
            gpio_set_level(LED_PIN, 0); 
            shutter_sensor_get_data(&latest_measurement_data);

            if (g_shutter_data_mutex != NULL && xSemaphoreTake(g_shutter_data_mutex, portMAX_DELAY) == pdTRUE) {
                g_latest_shutter_data = latest_measurement_data;
                xSemaphoreGive(g_shutter_data_mutex);
                ESP_LOGD(TAG_MAIN, "Global shutter data updated.");

                char* data_json = generate_shutter_data_json();
                if (data_json) {
                    send_ws_data_to_all_clients(data_json);
                    free(data_json);
                }
            } else {
                ESP_LOGE(TAG_MAIN, "Mutex error in sensor_task, cannot update global data or send WS data!");
            }
            shutter_sensor_reset_all_idle();
            gpio_set_level(LED_PIN, 1); 
        }
        vTaskDelay(pdMS_TO_TICKS(50)); 
    }
}