idf_component_register(SRCS "main.c" "shutter_sensor.c"
                     INCLUDE_DIRS "."
                     REQUIRES cjson
                     EMBED_FILES "html/index.html" "html/app.js"
                     )
# The EMBED_FILES argument makes symbols available like:
# extern const uint8_t index_html_start[] asm("_binary_index_html_start");
# extern const uint8_t index_html_end[]   asm("_binary_index_html_end");
# extern const uint8_t app_js_start[] asm("_binary_app_js_start");
# extern const uint8_t app_js_end[]   asm("_binary_app_js_end");
