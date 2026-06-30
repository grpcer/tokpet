#include "buttons.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"
#include "esp_log.h"

static const char *TAG = "buttons";

#define BTN_A_GPIO   2
#define BTN_B_GPIO   1
#define POLL_MS      20
#define DEBOUNCE_MS  30
#define LONG_MS      1000

typedef struct {
    int gpio;
    btn_id_t id;
    bool pressed;
    int64_t press_ms;
    bool long_fired;
} btn_state_t;

static btn_cb_t s_cb = NULL;
static btn_state_t s_btn[2];

static void poll_task(void *arg)
{
    (void)arg;
    while (1) {
        int64_t now = esp_timer_get_time() / 1000;
        for (int i = 0; i < 2; i++) {
            btn_state_t *b = &s_btn[i];
            bool down = (gpio_get_level(b->gpio) == 0);  // pressed = low (pull-up)
            if (down && !b->pressed) {
                b->pressed = true;
                b->press_ms = now;
                b->long_fired = false;
            } else if (down && b->pressed) {
                if (!b->long_fired && (now - b->press_ms) >= LONG_MS) {
                    b->long_fired = true;
                    if (s_cb) s_cb(b->id, BTN_EVENT_LONG);
                }
            } else if (!down && b->pressed) {
                int64_t held = now - b->press_ms;
                b->pressed = false;
                if (!b->long_fired && held >= DEBOUNCE_MS) {
                    if (s_cb) s_cb(b->id, BTN_EVENT_SHORT);
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
    }
}

esp_err_t buttons_init(btn_cb_t cb)
{
    s_cb = cb;
    s_btn[0] = (btn_state_t){.gpio = BTN_A_GPIO, .id = BTN_A};
    s_btn[1] = (btn_state_t){.gpio = BTN_B_GPIO, .id = BTN_B};

    gpio_config_t cfg = {
        .pin_bit_mask = (1ULL << BTN_A_GPIO) | (1ULL << BTN_B_GPIO),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    esp_err_t err = gpio_config(&cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "gpio_config failed: %s", esp_err_to_name(err));
        return err;
    }
    xTaskCreate(poll_task, "btn_poll", 3072, NULL, 5, NULL);
    ESP_LOGI(TAG, "buttons init (A=GPIO%d, B=GPIO%d)", BTN_A_GPIO, BTN_B_GPIO);
    return ESP_OK;
}
