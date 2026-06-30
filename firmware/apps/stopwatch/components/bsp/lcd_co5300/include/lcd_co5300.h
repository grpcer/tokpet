#pragma once

#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_err.h"

// CO5300 round AMOLED (QSPI), 466x466 visible
#define LCD_H_RES 466
#define LCD_V_RES 466

// QSPI pins (from UserDemo hal_display.cpp)
#define LCD_SPI_HOST SPI2_HOST
#define LCD_PIN_SCLK 40
#define LCD_PIN_D0   41
#define LCD_PIN_D1   42
#define LCD_PIN_D2   46
#define LCD_PIN_D3   45
#define LCD_PIN_CS   39
#define LCD_PIN_TE   38  // tearing sync, not used in Phase 1 yet
// RST is not wired to the ESP; it goes through the M5IOE1 (see the power component)

// Initialize the SPI bus + CO5300 panel (QSPI). out_panel/out_io may be NULL.
// Note: call power_init() (L3B_EN power rail) + power_oled_reset() (panel reset) beforehand.
esp_err_t lcd_co5300_init(esp_lcd_panel_handle_t *out_panel, esp_lcd_panel_io_handle_t *out_io);
