# Component CMakeLists.txt for the main application

# Define source files for the main component.
idf_component_register(SRCS "main.c" "shutter_sensor.c"
                     INCLUDE_DIRS "."
                     REQUIRES
                         json              # For cJSON
                         esp_wifi          # Core WiFi functionality
                         driver            # For GPIO driver (used by shutter_sensor)
                         nvs_flash         # Non-Volatile Storage initialization
                         esp_http_server   # HTTP Server
                         esp_timer         # For esp_timer_get_time()
                         spiffs            # SPIFFS filesystem
                         mdns              # mDNS service
                         esp_event         # ESP Event Loop
                         esp_netif         # Network Interface abstraction
                         wifi_manager      # Now found in the project's components directory
                     )

# Command to create the SPIFFS partition image
spiffs_create_partition_image(storage spiffs_image FLASH_IN_PROJECT)