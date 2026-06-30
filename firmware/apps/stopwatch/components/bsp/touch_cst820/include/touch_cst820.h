#pragma once

#include "driver/i2c_master.h"
#include "esp_lcd_touch.h"
#include "esp_err.h"

// CST820 (CST816 family) capacitive touch, I2C 0x15, shared bus, RST via M5IOE1
#define TOUCH_H_RES 466
#define TOUCH_V_RES 466

// Create the CST820 touch handle on the shared I2C bus. Call power_tp_reset() beforehand.
esp_err_t touch_cst820_init(i2c_master_bus_handle_t bus, esp_lcd_touch_handle_t *out_tp);
