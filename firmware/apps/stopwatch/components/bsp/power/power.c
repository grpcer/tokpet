#include "power.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "power";

// M5IOE1 (PY32) registers (low byte covers IO1-IO8). 16-bit = L|H<<8.
#define IOE_REG_GPIO_MODE_L 0x03
#define IOE_REG_GPIO_OUT_L  0x05
#define IOE_REG_GPIO_IN_L   0x07
#define IOE_REG_GPIO_PU_L   0x09
#define IOE_REG_GPIO_PD_L   0x0B
#define IOE_REG_GPIO_DRV_L  0x13
#define IOE_REG_I2C_CFG     0x23
#define IOE_I2C_SLEEP_MASK  0x0F

// On-board IOE pins (internal pin index, 0-based)
#define IOE_PIN_MUX_CTR  0  // IO1
#define IOE_PIN_TP_RST   3  // IO4 touch reset
#define IOE_PIN_OLED_RST 4  // IO5 panel reset
#define IOE_PIN_L3B_EN   7  // IO8 AMOLED power-rail enable

#define IOE_ADDR_PRIMARY   0x4F
#define IOE_ADDR_SECONDARY 0x6F
#define IOE_TIMEOUT_MS     100

static i2c_master_dev_handle_t s_dev = NULL;

static esp_err_t ioe_rd8(uint8_t reg, uint8_t *val)
{
    return i2c_master_transmit_receive(s_dev, &reg, 1, val, 1, IOE_TIMEOUT_MS);
}

static esp_err_t ioe_wr8(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = {reg, val};
    return i2c_master_transmit(s_dev, buf, sizeof(buf), IOE_TIMEOUT_MS);
}

static esp_err_t ioe_rd16(uint8_t reg, uint16_t *val)
{
    uint8_t buf[2];
    esp_err_t err = i2c_master_transmit_receive(s_dev, &reg, 1, buf, 2, IOE_TIMEOUT_MS);
    if (err == ESP_OK) {
        *val = (uint16_t)buf[0] | ((uint16_t)buf[1] << 8);
    }
    return err;
}

static esp_err_t ioe_wr16(uint8_t reg, uint16_t val)
{
    uint8_t buf[3] = {reg, (uint8_t)(val & 0xFF), (uint8_t)((val >> 8) & 0xFF)};
    return i2c_master_transmit(s_dev, buf, sizeof(buf), IOE_TIMEOUT_MS);
}

// Configure a pin as push-pull output (matches M5IOE1 pinMode(OUTPUT): MODE|=, PU/PD/DRV&=~)
static esp_err_t ioe_set_output(uint8_t pin)
{
    uint16_t mode, pu, pd, drv;
    if (ioe_rd16(IOE_REG_GPIO_MODE_L, &mode) != ESP_OK) return ESP_FAIL;
    if (ioe_rd16(IOE_REG_GPIO_PU_L, &pu) != ESP_OK) return ESP_FAIL;
    if (ioe_rd16(IOE_REG_GPIO_PD_L, &pd) != ESP_OK) return ESP_FAIL;
    if (ioe_rd16(IOE_REG_GPIO_DRV_L, &drv) != ESP_OK) return ESP_FAIL;
    mode |= (uint16_t)(1u << pin);
    pu &= (uint16_t)~(1u << pin);
    pd &= (uint16_t)~(1u << pin);
    drv &= (uint16_t)~(1u << pin);  // push-pull
    if (ioe_wr16(IOE_REG_GPIO_PU_L, pu) != ESP_OK) return ESP_FAIL;
    if (ioe_wr16(IOE_REG_GPIO_PD_L, pd) != ESP_OK) return ESP_FAIL;
    if (ioe_wr16(IOE_REG_GPIO_DRV_L, drv) != ESP_OK) return ESP_FAIL;
    if (ioe_wr16(IOE_REG_GPIO_MODE_L, mode) != ESP_OK) return ESP_FAIL;
    return ESP_OK;
}

static esp_err_t ioe_write(uint8_t pin, int level)
{
    uint16_t out;
    if (ioe_rd16(IOE_REG_GPIO_OUT_L, &out) != ESP_OK) return ESP_FAIL;
    if (level) {
        out |= (uint16_t)(1u << pin);
    } else {
        out &= (uint16_t)~(1u << pin);
    }
    return ioe_wr16(IOE_REG_GPIO_OUT_L, out);
}

static int ioe_read(uint8_t pin)
{
    uint16_t in;
    if (ioe_rd16(IOE_REG_GPIO_IN_L, &in) != ESP_OK) return -1;
    return (in & (uint16_t)(1u << pin)) ? 1 : 0;
}

void power_oled_reset(void)
{
    ioe_write(IOE_PIN_OLED_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(10));
    ioe_write(IOE_PIN_OLED_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(50));
}

void power_tp_reset(void)
{
    ioe_write(IOE_PIN_TP_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(10));
    ioe_write(IOE_PIN_TP_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(50));
}

esp_err_t power_init(i2c_master_bus_handle_t bus)
{
    uint8_t addr = IOE_ADDR_PRIMARY;
    if (i2c_master_probe(bus, addr, IOE_TIMEOUT_MS) != ESP_OK) {
        addr = IOE_ADDR_SECONDARY;
        if (i2c_master_probe(bus, addr, IOE_TIMEOUT_MS) != ESP_OK) {
            ESP_LOGE(TAG, "M5IOE1 not found (no ACK on 0x4F/0x6F)");
            return ESP_FAIL;
        }
    }
    i2c_device_config_t dcfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = addr,
        .scl_speed_hz = 100000,  // Shared multi-device bus + weak internal pull-ups; matches UserDemo's 100kHz (400kHz transfers fail)
    };
    esp_err_t err = i2c_master_bus_add_device(bus, &dcfg, &s_dev);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "add IOE device failed: %s", esp_err_to_name(err));
        return err;
    }
    ESP_LOGI(TAG, "M5IOE1 found at 0x%02X", addr);

    // After waking (the probe generates a START), disable auto-sleep so the device does not sleep while writing registers
    i2c_master_probe(bus, addr, 10);
    vTaskDelay(pdMS_TO_TICKS(10));
    uint8_t cfg = 0;
    if (ioe_rd8(IOE_REG_I2C_CFG, &cfg) == ESP_OK) {
        ioe_wr8(IOE_REG_I2C_CFG, cfg & (uint8_t)~IOE_I2C_SLEEP_MASK);
    }

    ioe_set_output(IOE_PIN_L3B_EN);
    ioe_set_output(IOE_PIN_OLED_RST);
    ioe_set_output(IOE_PIN_TP_RST);
    ioe_set_output(IOE_PIN_MUX_CTR);

    // Initial values: MUX_CTR=0, TP_RST=1, OLED_RST=1, L3B_EN=1
    ioe_write(IOE_PIN_MUX_CTR, 0);
    ioe_write(IOE_PIN_TP_RST, 1);
    ioe_write(IOE_PIN_OLED_RST, 1);
    ioe_write(IOE_PIN_L3B_EN, 1);

    // Ensure L3B_EN (AMOLED power rail) is driven high, confirmed by read-back (matches UserDemo retry logic)
    int retry = 0;
    while (retry < 12) {
        if (ioe_read(IOE_PIN_L3B_EN) == 1) {
            break;
        }
        ioe_write(IOE_PIN_L3B_EN, 1);
        vTaskDelay(pdMS_TO_TICKS(80));
        retry++;
    }
    if (retry >= 12) {
        ESP_LOGW(TAG, "L3B_EN read-back not confirmed high (panel may stay dark)");
    } else {
        ESP_LOGI(TAG, "L3B_EN high confirmed (retry=%d)", retry);
    }
    return ESP_OK;
}
