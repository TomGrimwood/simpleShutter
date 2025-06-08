#include "wifi_manager.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "lwip/err.h"
#include "lwip/sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h" // For vTaskDelay for reconnect attempts
#include "freertos/event_groups.h"

// NVS keys
#define NVS_NAMESPACE "wifi_creds"
#define NVS_KEY_SSID "ssid"
#define NVS_KEY_PASSWORD "password"
#define NVS_KEY_FORCE_AP "force_ap"

// AP Defaults
#define DEFAULT_AP_SSID "ESP32_Shutter_AP"
#define DEFAULT_AP_PASSWORD "precision" // Default password
#define DEFAULT_AP_MAX_CONN 4           // Max clients
#define DEFAULT_AP_CHANNEL 1            // WiFi channel

static const char *TAG_WM = "wifi_manager";

// Global state for current WiFi mode and status
static wifi_manager_mode_t g_current_mode = WIFI_MANAGER_MODE_OFF;
static wifi_manager_status_t g_wifi_status = {
    .mode = WIFI_MANAGER_MODE_OFF,
    .is_connected = false,
    .ssid = "",
    .ip_addr = "0.0.0.0",
    .rssi = 0
};

// NVS credentials
static char s_nvs_ssid[33];
static char s_nvs_password[65];
static bool s_nvs_force_ap = false;
static bool s_credentials_loaded = false;

// Event Group for STA connection status
static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT  BIT0
#define WIFI_FAIL_BIT       BIT1
#define WIFI_AP_STARTED_BIT BIT2

// Callback registered by application
static wifi_mgr_event_cb_t s_event_callback = NULL;

static esp_netif_t *s_sta_netif = NULL;
static esp_netif_t *s_ap_netif = NULL;

// Forward declarations
static void wifi_event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data);
static esp_err_t load_credentials_from_nvs(void);
static esp_err_t save_credentials_to_nvs(const char *ssid, const char *password, bool force_ap);
static void set_current_status(wifi_manager_mode_t mode, bool connected, const char* ssid, const char* ip, int8_t rssi);


esp_err_t wifi_manager_init(void) {
    esp_err_t ret = ESP_OK;

    ESP_LOGI(TAG_WM, "Initializing WiFi Manager...");

    // Initialize NVS
    ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    if (ret != ESP_OK) {
        ESP_LOGE(TAG_WM, "NVS flash init failed (%s)", esp_err_to_name(ret));
        return ret;
    }

    s_wifi_event_group = xEventGroupCreate();
    if (!s_wifi_event_group) {
        ESP_LOGE(TAG_WM, "Failed to create WiFi event group");
        return ESP_FAIL;
    }

    // Initialize TCP/IP stack
    ESP_ERROR_CHECK(esp_netif_init());

    // Create default event loop
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    // Initialize WiFi driver
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    // Register event handlers
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, NULL));

    // Load credentials early
    load_credentials_from_nvs();

    ESP_LOGI(TAG_WM, "WiFi Manager initialized.");
    return ESP_OK;
}

void wifi_manager_set_event_callback(wifi_mgr_event_cb_t cb) {
    s_event_callback = cb;
    ESP_LOGI(TAG_WM, "WiFi Manager event callback %sregistered", (cb ? "" : "un"));
}

static void wifi_event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        ESP_LOGI(TAG_WM, "WIFI_EVENT_STA_START");
        set_current_status(WIFI_MANAGER_MODE_STA, false, s_nvs_ssid, "0.0.0.0", 0);
        if (s_event_callback) s_event_callback(WIFI_MANAGER_EVENT_STA_DISCONNECTED, (void*)"STA_START"); // Initially disconnected
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t* event = (wifi_event_sta_disconnected_t*) event_data;
        ESP_LOGI(TAG_WM, "WIFI_EVENT_STA_DISCONNECTED (reason: %d)", event->reason);
        set_current_status(WIFI_MANAGER_MODE_STA, false, s_nvs_ssid, "0.0.0.0", 0);
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);

        // Automatic reconnect logic (optional, but good for robustness)
        ESP_LOGI(TAG_WM, "STA disconnect, retrying connection...");
        esp_wifi_connect(); // Attempt reconnect

        if (s_event_callback) s_event_callback(WIFI_MANAGER_EVENT_STA_DISCONNECTED, (void*)event->reason);
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        char ip_str[IP4ADDR_STRLEN_MAX];
        esp_ip4addr_ntoa(&event->ip_info.ip, ip_str, IP4ADDR_STRLEN_MAX);
        ESP_LOGI(TAG_WM, "IP_EVENT_STA_GOT_IP (IP: %s)", ip_str);
        wifi_ap_record_t ap_info;
        int8_t rssi = 0;
        if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
            rssi = ap_info.rssi;
        }
        set_current_status(WIFI_MANAGER_MODE_STA, true, s_nvs_ssid, ip_str, rssi);
        xEventGroupClearBits(s_wifi_event_group, WIFI_FAIL_BIT);
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        if (s_event_callback) s_event_callback(WIFI_MANAGER_EVENT_STA_GOT_IP, NULL); // Or pass event->ip_info
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_AP_START) {
        ESP_LOGI(TAG_WM, "WIFI_EVENT_AP_START");
        // Get AP's IP address
        esp_netif_ip_info_t ip_info;
        char ip_str[IP4ADDR_STRLEN_MAX];
        if (s_ap_netif && esp_netif_get_ip_info(s_ap_netif, &ip_info) == ESP_OK) {
            esp_ip4addr_ntoa(&ip_info.ip, ip_str, IP4ADDR_STRLEN_MAX);
        } else {
            strcpy(ip_str, "0.0.0.0");
        }
        set_current_status(WIFI_MANAGER_MODE_AP, true, DEFAULT_AP_SSID, ip_str, 0);
        xEventGroupSetBits(s_wifi_event_group, WIFI_AP_STARTED_BIT);
        if (s_event_callback) s_event_callback(WIFI_MANAGER_EVENT_AP_STARTED, NULL);
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_AP_STOP) {
        ESP_LOGI(TAG_WM, "WIFI_EVENT_AP_STOP");
        set_current_status(WIFI_MANAGER_MODE_OFF, false, "", "0.0.0.0", 0); // No mode specific after stop
        xEventGroupClearBits(s_wifi_event_group, WIFI_AP_STARTED_BIT);
        if (s_event_callback) s_event_callback(WIFI_MANAGER_EVENT_AP_STOPPED, NULL);
    }
    // Add AP_STACONNECTED/DISCONNECTED if specific logic needed for them.
    // For this task, we mainly care about AP_START/STOP and STA_CONNECTED/DISCONNECTED/GOT_IP.
}

static esp_err_t load_credentials_from_nvs(void) {
    nvs_handle_t nvs_handle;
    esp_err_t ret = nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs_handle);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG_WM, "Error opening NVS namespace '%s': %s", NVS_NAMESPACE, esp_err_to_name(ret));
        s_credentials_loaded = false;
        return ret;
    }

    size_t ssid_len = sizeof(s_nvs_ssid);
    size_t pass_len = sizeof(s_nvs_password);
    ret = nvs_get_str(nvs_handle, NVS_KEY_SSID, s_nvs_ssid, &ssid_len);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG_WM, "NVS: Failed to get SSID: %s", esp_err_to_name(ret));
        strcpy(s_nvs_ssid, ""); // Clear on error
    }
    ret = nvs_get_str(nvs_handle, NVS_KEY_PASSWORD, s_nvs_password, &pass_len);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG_WM, "NVS: Failed to get Password: %s", esp_err_to_name(ret));
        strcpy(s_nvs_password, ""); // Clear on error
    }

    int force_ap_val = 0;
    ret = nvs_get_i8(nvs_handle, NVS_KEY_FORCE_AP, (int8_t*)&force_ap_val);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG_WM, "NVS: Failed to get force_ap: %s", esp_err_to_name(ret));
        s_nvs_force_ap = false; // Default to false
    } else {
        s_nvs_force_ap = (bool)force_ap_val;
    }

    nvs_close(nvs_handle);

    if (strlen(s_nvs_ssid) > 0) {
        s_credentials_loaded = true;
        ESP_LOGI(TAG_WM, "NVS: Loaded SSID '%s', force_ap: %d", s_nvs_ssid, s_nvs_force_ap);
    } else {
        s_credentials_loaded = false;
        ESP_LOGI(TAG_WM, "NVS: No saved STA credentials found.");
    }
    return ESP_OK;
}

static esp_err_t save_credentials_to_nvs(const char *ssid, const char *password, bool force_ap) {
    nvs_handle_t nvs_handle;
    esp_err_t ret = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs_handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG_WM, "Error opening NVS namespace '%s' for write: %s", NVS_NAMESPACE, esp_err_to_name(ret));
        return ret;
    }

    ret = nvs_set_str(nvs_handle, NVS_KEY_SSID, ssid);
    if (ret != ESP_OK) ESP_LOGE(TAG_WM, "NVS: Failed to set SSID: %s", esp_err_to_name(ret));
    ret = nvs_set_str(nvs_handle, NVS_KEY_PASSWORD, password);
    if (ret != ESP_OK) ESP_LOGE(TAG_WM, "NVS: Failed to set Password: %s", esp_err_to_name(ret));
    ret = nvs_set_i8(nvs_handle, NVS_KEY_FORCE_AP, (int8_t)force_ap);
    if (ret != ESP_OK) ESP_LOGE(TAG_WM, "NVS: Failed to set force_ap: %s", esp_err_to_name(ret));

    ret = nvs_commit(nvs_handle);
    if (ret != ESP_OK) ESP_LOGE(TAG_WM, "NVS: Failed to commit: %s", esp_err_to_name(ret));

    nvs_close(nvs_handle);

    strcpy(s_nvs_ssid, ssid);
    strcpy(s_nvs_password, password);
    s_nvs_force_ap = force_ap;
    s_credentials_loaded = (strlen(ssid) > 0);

    ESP_LOGI(TAG_WM, "NVS: Saved SSID '%s', force_ap: %d", s_nvs_ssid, s_nvs_force_ap);
    return ret;
}

static void set_current_status(wifi_manager_mode_t mode, bool connected, const char* ssid, const char* ip, int8_t rssi) {
    g_wifi_status.mode = mode;
    g_wifi_status.is_connected = connected;
    strncpy(g_wifi_status.ssid, ssid, sizeof(g_wifi_status.ssid) - 1);
    g_wifi_status.ssid[sizeof(g_wifi_status.ssid) - 1] = '\0';
    strncpy(g_wifi_status.ip_addr, ip, sizeof(g_wifi_status.ip_addr) - 1);
    g_wifi_status.ip_addr[sizeof(g_wifi_status.ip_addr) - 1] = '\0';
    g_wifi_status.rssi = rssi;
    g_current_mode = mode;
    ESP_LOGD(TAG_WM, "Status Updated: Mode=%d, Connected=%d, SSID=%s, IP=%s, RSSI=%d",
             g_wifi_status.mode, g_wifi_status.is_connected, g_wifi_status.ssid, g_wifi_status.ip_addr, g_wifi_status.rssi);
}


wifi_manager_mode_t wifi_manager_start(bool force_ap_on_boot) {
    if (s_nvs_force_ap || force_ap_on_boot || !s_credentials_loaded) {
        ESP_LOGI(TAG_WM, "Starting in AP mode (force_ap_on_boot=%d, NVS_force_ap=%d, credentials_loaded=%d)",
                 force_ap_on_boot, s_nvs_force_ap, s_credentials_loaded);
        if (wifi_manager_start_ap() != ESP_OK) {
            ESP_LOGE(TAG_WM, "Failed to start AP mode on boot!");
            set_current_status(WIFI_MANAGER_MODE_OFF, false, "", "0.0.0.0", 0);
            return WIFI_MANAGER_MODE_OFF;
        }
        return WIFI_MANAGER_MODE_AP;
    } else {
        ESP_LOGI(TAG_WM, "Attempting STA connection on boot with saved credentials.");
        if (wifi_manager_connect_sta() != ESP_OK) {
            ESP_LOGE(TAG_WM, "Failed to start STA connection on boot!");
            set_current_status(WIFI_MANAGER_MODE_OFF, false, "", "0.0.0.0", 0);
            return WIFI_MANAGER_MODE_OFF;
        }
        return WIFI_MANAGER_MODE_STA; // Returns STA, even if connection isn't immediately successful
    }
}

void wifi_manager_stop_ap_sta(void) {
    if (g_current_mode != WIFI_MANAGER_MODE_OFF) {
        ESP_LOGI(TAG_WM, "Stopping current WiFi mode: %s", g_current_mode == WIFI_MANAGER_MODE_STA ? "STA" : "AP");
        ESP_ERROR_CHECK(esp_wifi_stop());
        if (s_ap_netif) {
            esp_netif_destroy(s_ap_netif);
            s_ap_netif = NULL;
        }
        if (s_sta_netif) {
            esp_netif_destroy(s_sta_netif);
            s_sta_netif = NULL;
        }
        set_current_status(WIFI_MANAGER_MODE_OFF, false, "", "0.0.0.0", 0);
    }
}

esp_err_t wifi_manager_set_credentials(const char *ssid, const char *password, bool force_ap_mode) {
    return save_credentials_to_nvs(ssid, password, force_ap_mode);
}

esp_err_t wifi_manager_connect_sta(void) {
    ESP_LOGI(TAG_WM, "Attempting to connect to STA mode.");

    wifi_manager_stop_ap_sta(); // Stop any existing WiFi mode

    s_sta_netif = esp_netif_create_default_wifi_sta();
    if (!s_sta_netif) {
        ESP_LOGE(TAG_WM, "Failed to create STA netif!");
        return ESP_FAIL;
    }

    wifi_config_t wifi_config = {
        .sta = {
            .threshold.authmode = WIFI_AUTH_WPA_WPA2_PSK, // Default threshold
        },
    };
    strncpy((char*)wifi_config.sta.ssid, s_nvs_ssid, sizeof(wifi_config.sta.ssid) - 1);
    strncpy((char*)wifi_config.sta.password, s_nvs_password, sizeof(wifi_config.sta.password) - 1);

    if (strlen(s_nvs_password) == 0) {
        wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_connect());

    set_current_status(WIFI_MANAGER_MODE_STA, false, s_nvs_ssid, "0.0.0.0", 0);
    return ESP_OK;
}

esp_err_t wifi_manager_start_ap(void) {
    ESP_LOGI(TAG_WM, "Starting AP mode.");

    wifi_manager_stop_ap_sta(); // Stop any existing WiFi mode

    s_ap_netif = esp_netif_create_default_wifi_ap();
    if (!s_ap_netif) {
        ESP_LOGE(TAG_WM, "Failed to create AP netif!");
        return ESP_FAIL;
    }

    wifi_config_t wifi_config = {
        .ap = {
            .ssid = DEFAULT_AP_SSID,
            .ssid_len = strlen(DEFAULT_AP_SSID),
            .channel = DEFAULT_AP_CHANNEL,
            .authmode = WIFI_AUTH_WPA2_PSK,
            .password = DEFAULT_AP_PASSWORD,
            .max_connection = DEFAULT_AP_MAX_CONN,
        },
    };

    if (strlen(DEFAULT_AP_PASSWORD) == 0) {
        wifi_config.ap.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    // Update AP IP address, always 192.168.4.1 for default AP netif
    set_current_status(WIFI_MANAGER_MODE_AP, true, DEFAULT_AP_SSID, "192.168.4.1", 0); // RSSI not applicable for AP
    return ESP_OK;
}

esp_err_t wifi_manager_forget_credentials(bool reboot_after_clear) {
    ESP_LOGW(TAG_WM, "Forgetting all WiFi credentials...");
    esp_err_t ret = save_credentials_to_nvs("", "", false); // Clear NVS entries

    wifi_manager_stop_ap_sta(); // Stop current WiFi

    if (reboot_after_clear) {
        ESP_LOGI(TAG_WM, "Rebooting to apply credential reset.");
        esp_restart(); // Reboot the device
    } else {
        // Optionally start AP mode so user can reconfigure immediately
        ESP_LOGI(TAG_WM, "Credentials forgotten, restarting in AP mode.");
        ret = wifi_manager_start_ap();
    }
    return ret;
}


wifi_manager_mode_t wifi_manager_get_current_mode(void) {
    return g_current_mode;
}

esp_err_t wifi_manager_get_status(wifi_manager_status_t *status_out) {
    if (!status_out) return ESP_ERR_INVALID_ARG;
    
    *status_out = g_wifi_status; // Copy current cached status

    // For STA mode, try to get more up-to-date RSSI
    if (g_wifi_status.mode == WIFI_MANAGER_MODE_STA && g_wifi_status.is_connected) {
        wifi_ap_record_t ap_info;
        if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
            status_out->rssi = ap_info.rssi;
        }
    }
    return ESP_OK;
}