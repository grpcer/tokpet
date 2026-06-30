#pragma once

#include "driver/i2c_master.h"
#include "esp_err.h"

// StopWatch shared I2C bus (I2C_NUM_0): IOE/PMIC/touch/IMU/RTC all hang off this one
#define IIC_SDA_GPIO 47
#define IIC_SCL_GPIO 48

// Create the shared I2C master bus (idempotent)
esp_err_t iic_init(void);

// Return the bus handle (valid after iic_init, otherwise NULL)
i2c_master_bus_handle_t iic_bus(void);
