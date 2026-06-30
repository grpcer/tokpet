#pragma once

#include "esp_err.h"

typedef enum {
    BTN_A = 0,  // GPIO2 (KEYA)
    BTN_B = 1,  // GPIO1 (KEYB)
} btn_id_t;

typedef enum {
    BTN_EVENT_SHORT,
    BTN_EVENT_LONG,
} btn_event_t;

typedef void (*btn_cb_t)(btn_id_t id, btn_event_t evt);

// Initialize the directly-wired buttons (GPIO2=A / GPIO1=B, pull-up, pressed = low) and start the polling task. cb may be NULL.
esp_err_t buttons_init(btn_cb_t cb);
