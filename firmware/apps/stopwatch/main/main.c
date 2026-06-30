#include "esp_log.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch.h"
#include "esp_event.h"
#include "esp_netif.h"

#include "iic.h"
#include "power.h"
#include "lcd_co5300.h"
#include "touch_cst820.h"
#include "buttons.h"
#include "ui.h"
#include "tokpet_config.h"
#include "tokpet_client.h"
#include "tokpet_provisioning.h"

static const char *TAG = "tokpet_sw";

static void on_button(btn_id_t id, btn_event_t evt)
{
    ESP_LOGI(TAG, "BTN %c %s", id == BTN_A ? 'A' : 'B', evt == BTN_EVENT_LONG ? "LONG" : "SHORT");
    if (id == BTN_A && evt == BTN_EVENT_LONG) {
        // Long-press A = clear the WiFi credentials and reboot back into SoftAP provisioning (matches the old board's "re-provision" entry point)
        ESP_LOGW(TAG, "long-press A: clear WiFi creds -> reboot to provisioning");
        tokpet_config_clear_wifi();
        esp_restart();
    }
}

void app_main(void)
{
    ESP_LOGI(TAG, "Tokpet StopWatch boot ok");

    // BSP bring-up order: iic -> power(IOE power rails/reset) -> lcd -> touch -> ui -> buttons
    ESP_ERROR_CHECK(iic_init());
    ESP_ERROR_CHECK(power_init(iic_bus()));
    power_oled_reset();
    power_tp_reset();

    esp_lcd_panel_handle_t panel = NULL;
    esp_lcd_panel_io_handle_t io = NULL;
    ESP_ERROR_CHECK(lcd_co5300_init(&panel, &io));

    esp_lcd_touch_handle_t tp = NULL;
    if (touch_cst820_init(iic_bus(), &tp) != ESP_OK) {
        ESP_LOGW(TAG, "touch init failed");
        tp = NULL;
    }
    ui_init(panel, io, tp);
    ESP_ERROR_CHECK(buttons_init(on_button));

    // Network stack (shared): config -> netif -> event loop -> if credentials exist, STA + fetch data; otherwise SoftAP provisioning
    ESP_ERROR_CHECK(tokpet_config_init());
    ESP_ERROR_CHECK(esp_netif_init());
    esp_err_t ev = esp_event_loop_create_default();
    if (ev != ESP_OK && ev != ESP_ERR_INVALID_STATE) {
        ESP_ERROR_CHECK(ev);
    }

    tokpet_wifi_credentials_t cred = {0};
    bool has_wifi = false;
    ESP_ERROR_CHECK(tokpet_config_load_wifi(&cred, &has_wifi));
    if (has_wifi) {
        esp_err_t r = tokpet_client_start();
        if (r != ESP_OK) {
            ESP_LOGW(TAG, "tokpet_client_start: %s", esp_err_to_name(r));
        }
    } else {
        ESP_LOGI(TAG, "no WiFi creds -> SoftAP provisioning");
        esp_err_t r = tokpet_provisioning_start();
        if (r != ESP_OK) {
            ESP_LOGE(TAG, "tokpet_provisioning_start: %s", esp_err_to_name(r));
            ui_set_connection_status(TOKPET_UI_STATUS_ERROR, "Setup failed");
        }
    }

    ESP_LOGI(TAG, "init complete");
}
