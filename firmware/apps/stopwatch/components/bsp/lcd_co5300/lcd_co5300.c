#include "lcd_co5300.h"
#include "esp_lcd_co5300.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_log.h"

static const char *TAG = "lcd_co5300";

esp_err_t lcd_co5300_init(esp_lcd_panel_handle_t *out_panel, esp_lcd_panel_io_handle_t *out_io)
{
    // 1. QSPI bus
    const spi_bus_config_t buscfg = CO5300_PANEL_BUS_QSPI_CONFIG(
        LCD_PIN_SCLK, LCD_PIN_D0, LCD_PIN_D1, LCD_PIN_D2, LCD_PIN_D3,
        LCD_H_RES * LCD_V_RES * sizeof(uint16_t));
    ESP_RETURN_ON_ERROR(spi_bus_initialize(LCD_SPI_HOST, &buscfg, SPI_DMA_CH_AUTO), TAG, "spi_bus_initialize");

    // 2. Panel IO (QSPI: cmd 32-bit + quad_mode)
    esp_lcd_panel_io_handle_t io = NULL;
    const esp_lcd_panel_io_spi_config_t io_config = CO5300_PANEL_IO_QSPI_CONFIG(LCD_PIN_CS, NULL, NULL);
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_SPI_HOST, &io_config, &io),
                        TAG, "new_panel_io_spi");

    // 3. CO5300 panel (uses the component's default init sequence)
    const co5300_vendor_config_t vendor_config = {
        .flags = {
            .use_qspi_interface = 1,
        },
    };
    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = -1,  // RST via M5IOE1, not an ESP GPIO
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = (void *)&vendor_config,
    };
    esp_lcd_panel_handle_t panel = NULL;
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_co5300(io, &panel_config, &panel), TAG, "new_panel_co5300");

    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(panel), TAG, "panel_reset");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(panel), TAG, "panel_init");
    // CO5300 466x466 round panel column offset x=6 (matches M5GFX StopWatch board offset_x=6 / Waveshare 1.75 col_offset=6
    // / esphome). Without it the image is shifted 6 columns horizontally and the rightmost column wraps around.
    ESP_RETURN_ON_ERROR(esp_lcd_panel_set_gap(panel, 6, 0), TAG, "set_gap");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(panel, true), TAG, "disp_on");

    if (out_panel) *out_panel = panel;
    if (out_io) *out_io = io;
    ESP_LOGI(TAG, "CO5300 QSPI init done (%dx%d)", LCD_H_RES, LCD_V_RES);
    return ESP_OK;
}
