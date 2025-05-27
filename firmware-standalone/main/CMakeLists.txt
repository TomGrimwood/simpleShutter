idf_component_register(SRCS "main.c" "shutter_sensor.c"
                     INCLUDE_DIRS "."
                     REQUIRES json esp_wifi driver nvs_flash esp_http_server esp_timer spiffs
                     )

spiffs_create_partition_image(storage spiffs_image FLASH_IN_PROJECT)
