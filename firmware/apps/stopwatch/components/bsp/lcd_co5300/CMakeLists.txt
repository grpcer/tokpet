idf_component_register(
    SRCS "lcd_co5300.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_lcd esp_driver_spi esp_lcd_co5300
)
