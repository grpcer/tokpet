#pragma once

#include "driver/i2c_master.h"
#include "esp_err.h"

// Minimal GPIO driver for the M5IOE1 (PY32 IO expander).
// Phase 1 only handles the power rails and reset pins needed to bring up the
// CO5300 panel and CST820 touch; it does not pull in the full M5IOE1 component
// (ADC/PWM/NeoPixel/interrupts, etc. are not needed in Phase 1).
//
// On-board wiring (IOE internal pins, not ESP GPIO):
//   L3B_EN(PIN8/idx7)  AMOLED power-rail enable (required to light the panel, confirmed by read-back)
//   OLED_RST(PIN5/idx4) CO5300 reset
//   TP_RST(PIN4/idx3)  CST820 touch reset
//   MUX_CTR(PIN1/idx0) CH442E USB mux, set to 0

// Probe the IOE (0x4F primary / 0x6F secondary), configure the output pins above and power up (L3B_EN driven high, confirmed by read-back)
esp_err_t power_init(i2c_master_bus_handle_t bus);

// Reset the CO5300 panel via the IOE (low 10ms -> high 50ms)
void power_oled_reset(void);

// Reset the CST820 touch via the IOE (low 10ms -> high 50ms)
void power_tp_reset(void);
