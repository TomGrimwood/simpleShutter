#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include "esp_err.h"
#include "esp_wifi_types.h"
#include "esp_netif.h" // For esp_netif_ip_info_t

typedef enum {
    WIFI_MANAGER_MODE_STA,
    WIFI_MANAGER_MODE_AP,
    WIFI_MANAGER_MODE_OFF, // WiFi is not active
} wifi_manager_mode_t;

typedef enum {
    WIFI_MANAGER_EVENT_STA_CONNECTED,
    WIFI_MANAGER_EVENT_STA_DISCONNECTED, // Includes connection failure
    WIFI_MANAGER_EVENT_AP_STARTED,
    WIFI_MANAGER_EVENT_AP_STOPPED,
    WIFI_MANAGER_EVENT_STA_GOT_IP,
} wifi_manager_event_id_t;

typedef struct {
    wifi_manager_mode_t mode;
    bool is_connected; // For STA: true if connected to AP, false if disconnected/failed
                       // For AP: true if AP is started, false if stopped
    char ssid[33]; // Current SSID (AP name if in AP mode, connected AP if in STA)
    char ip_addr[IP4ADDR_STRLEN_MAX]; // STA IP address if connected, AP IP if in AP
    int8_t rssi; // Signal strength if in STA mode, N/A for AP
    // Add other relevant status fields if needed
} wifi_manager_status_t;


// Callback function type for WiFi Manager events
typedef void (*wifi_mgr_event_cb_t)(wifi_manager_event_id_t event_id, void* event_data);

/**
 * @brief Initializes the WiFi stack (netif, event loop, WiFi driver).
 *        Must be called once at application startup.
 * @return ESP_OK on success, otherwise an error code.
 */
esp_err_t wifi_manager_init(void);

/**
 * @brief Registers a callback function to receive WiFi Manager events.
 * @param cb The callback function to register. Set to NULL to unregister.
 */
void wifi_manager_set_event_callback(wifi_mgr_event_cb_t cb);

/**
 * @brief Starts the WiFi manager. Attempts to connect to saved STA credentials if present,
 *        otherwise, it will just initialize in STA mode without attempting connection.
 *        If force_ap_on_boot is true, it will start directly in AP mode.
 * @param force_ap_on_boot If true, forces the device to start in AP mode regardless of NVS.
 * @return The actual mode the device started in (WIFI_MANAGER_MODE_STA or WIFI_MANAGER_MODE_AP).
 */
wifi_manager_mode_t wifi_manager_start(bool force_ap_on_boot);

/**
 * @brief Stops the currently active WiFi mode (STA or AP).
 *        Does not clear NVS credentials.
 */
void wifi_manager_stop_ap_sta(void);

/**
 * @brief Sets and saves new WiFi credentials (SSID and password) to NVS.
 *        Also saves the force_ap_mode setting.
 * @param ssid The SSID to save. Max 32 characters.
 * @param password The password to save. Max 64 characters.
 * @param force_ap_mode If true, next boot (or explicit switch) will use AP mode.
 * @return ESP_OK on success, otherwise an error code.
 */
esp_err_t wifi_manager_set_credentials(const char *ssid, const char *password, bool force_ap_mode);

/**
 * @brief Attempts to connect to the saved STA credentials.
 *        If currently in AP mode, it will stop AP and switch to STA.
 * @return ESP_OK if connection attempt initiated, otherwise an error.
 */
esp_err_t wifi_manager_connect_sta(void);

/**
 * @brief Starts the device in Access Point (AP) mode.
 *        If currently in STA mode, it will stop STA and switch to AP.
 * @return ESP_OK on success, otherwise an error.
 */
esp_err_t wifi_manager_start_ap(void);

/**
 * @brief Forgets (clears) saved WiFi credentials from NVS.
 *        Optionally reboots the device after clearing.
 * @param reboot_after_clear If true, reboots after clearing.
 * @return ESP_OK on success, otherwise an error.
 */
esp_err_t wifi_manager_forget_credentials(bool reboot_after_clear);

/**
 * @brief Gets the current WiFi mode of the device.
 * @return The current WiFi_manager_mode_t.
 */
wifi_manager_mode_t wifi_manager_get_current_mode(void);

/**
 * @brief Gets the current detailed WiFi status.
 * @param status_out Pointer to a wifi_manager_status_t struct to fill.
 * @return ESP_OK on success, ESP_FAIL if status cannot be retrieved.
 */
esp_err_t wifi_manager_get_status(wifi_manager_status_t *status_out);

#endif // WIFI_MANAGER_H