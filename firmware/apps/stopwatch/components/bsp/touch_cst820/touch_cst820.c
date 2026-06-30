#include "touch_cst820.h"
#include "esp_lcd_touch_cst816s.h"
#include "esp_lcd_panel_io.h"
#include "esp_check.h"
#include "esp_log.h"

static const char *TAG = "touch_cst820";

esp_err_t touch_cst820_init(i2c_master_bus_handle_t bus, esp_lcd_touch_handle_t *out_tp)
{
    esp_lcd_panel_io_handle_t io = NULL;
    const esp_lcd_panel_io_i2c_config_t io_cfg = ESP_LCD_TOUCH_IO_I2C_CST816S_CONFIG();  // address 0x15, 100kHz
    // Do not cast bus: esp_lcd_new_panel_io_i2c dispatches by type via _Generic;
    // only i2c_master_bus_handle_t selects v2 (new driver); a cast falls through to v1 (legacy) -> driver conflict.
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_i2c(bus, &io_cfg, &io), TAG, "new panel io i2c");

    const esp_lcd_touch_config_t tp_cfg = {
        .x_max = TOUCH_H_RES,
        .y_max = TOUCH_V_RES,
        .rst_gpio_num = -1,  // RST via M5IOE1 (power_tp_reset)
        .int_gpio_num = -1,  // polling, no ESP INT
        .flags = {
            // Calibrated on hardware: X increases to the right, Y increases downward, X/Y not swapped, so no flips at all
            .swap_xy = 0,
            .mirror_x = 0,
            .mirror_y = 0,
        },
    };
    esp_lcd_touch_handle_t tp = NULL;
    ESP_RETURN_ON_ERROR(esp_lcd_touch_new_i2c_cst816s(io, &tp_cfg, &tp), TAG, "new cst816s");

    if (out_tp) {
        *out_tp = tp;
    }
    ESP_LOGI(TAG, "CST820 touch init done (addr 0x%02X)", ESP_LCD_TOUCH_IO_I2C_CST816S_ADDRESS);
    return ESP_OK;
}
