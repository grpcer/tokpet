#include "iic.h"
#include "esp_log.h"

static const char *TAG = "iic";
static i2c_master_bus_handle_t s_bus = NULL;

esp_err_t iic_init(void)
{
    if (s_bus) {
        return ESP_OK;
    }
    i2c_master_bus_config_t cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = IIC_SDA_GPIO,
        .scl_io_num = IIC_SCL_GPIO,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    esp_err_t err = i2c_new_master_bus(&cfg, &s_bus);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "i2c_new_master_bus failed: %s", esp_err_to_name(err));
        s_bus = NULL;
    }
    return err;
}

i2c_master_bus_handle_t iic_bus(void)
{
    return s_bus;
}
