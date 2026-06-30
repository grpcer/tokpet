#pragma once

#include <stdbool.h>

#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch.h"
#include "tokpet_state.h"

// Top connection status level (matches the atk-s3box ui interface, for use by shared tokpet_client/provisioning).
typedef enum {
    TOKPET_UI_STATUS_OFFLINE = 0,  // gray: not connected / idle
    TOKPET_UI_STATUS_LINKING,      // orange: WiFi connecting, handshake, reconnect
    TOKPET_UI_STATUS_ONLINE,       // green: companion /state OK
    TOKPET_UI_STATUS_SETUP,        // blue: SoftAP provisioning / missing WiFi credentials
    TOKPET_UI_STATUS_ERROR,        // red: mDNS/HTTP/Parse/Setup and other hard errors
} tokpet_ui_status_level_t;

// Initialize LVGL (esp_lvgl_port) wired to CO5300 + CST820 touch (tp may be NULL), build the minimal round-screen UI.
void ui_init(esp_lcd_panel_handle_t panel, esp_lcd_panel_io_handle_t io, esp_lcd_touch_handle_t tp);

// Refresh the dual rings + 5h/7d readings with the latest /state (called by shared tokpet_client, thread-safe).
void ui_update_state(const tokpet_state_t *state);

// Set the top connection status dot color + text (pass NULL for label to use the level's default short text).
void ui_set_connection_status(tokpet_ui_status_level_t level, const char *label);
