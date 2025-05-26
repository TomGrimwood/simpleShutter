idf_component_register(SRCS "main.c" "shutter_sensor.c"
                     INCLUDE_DIRS "."
                     REQUIRES json esp_wifi driver nvs_flash esp_http_server esp_timer
                     EMBED_FILES 
                         "html/index.html"
                         "html/static/css/styles.css"
                         "html/static/js/api.js"
                         "html/static/js/config-panel.js"
                         "html/static/js/data-updater.js"
                         "html/static/js/main.js"
                         "html/static/js/results-log.js"
                         "html/static/js/shutter-calculations.js"
                         "html/static/js/ui-helpers.js"
                     )
# The EMBED_FILES argument makes symbols available for each file.
# For example, for "html/index.html", symbols would be:
# extern const uint8_t index_html_start[] asm("_binary_index_html_start");
# extern const uint8_t index_html_end[]   asm("_binary_index_html_end");
# Similar symbols are generated for all other embedded files,
# with names derived from their paths (e.g., _binary_static_css_styles_css_start).
