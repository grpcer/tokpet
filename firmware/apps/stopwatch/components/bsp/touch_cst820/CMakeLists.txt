idf_component_register(
    SRCS "touch_cst820.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_lcd esp_driver_i2c esp_lcd_touch esp_lcd_touch_cst816s
)
