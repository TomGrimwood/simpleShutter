# Component CMakeLists.txt for wifi_manager

idf_component_register(SRCS "wifi_manager.c"
                       INCLUDE_DIRS "."
                       REQUIRES esp_wifi esp_event esp_netif nvs_flash lwip esp_http_server spiffs) # Add required components