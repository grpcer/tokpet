#pragma once

#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define TOKPET_WIFI_SSID_MAX_LEN 33
#define TOKPET_WIFI_PASSWORD_MAX_LEN 65
#define TOKPET_STATE_URL_MAX_LEN 128

typedef struct {
    char ssid[TOKPET_WIFI_SSID_MAX_LEN];
    char password[TOKPET_WIFI_PASSWORD_MAX_LEN];
} tokpet_wifi_credentials_t;

esp_err_t tokpet_config_init(void);
esp_err_t tokpet_config_load_wifi(tokpet_wifi_credentials_t *out, bool *found);
esp_err_t tokpet_config_save_wifi(const tokpet_wifi_credentials_t *credentials);
esp_err_t tokpet_config_clear_wifi(void);
esp_err_t tokpet_config_load_state_url(char *out, size_t out_len, bool *found);
esp_err_t tokpet_config_save_state_url(const char *url);

#ifdef __cplusplus
}
#endif
