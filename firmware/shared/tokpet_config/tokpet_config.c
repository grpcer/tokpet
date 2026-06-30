#include "tokpet_config.h"

#include <string.h>

#include "esp_check.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "tokpet_config";
static const char *NVS_NAMESPACE = "tokpet";
static const char *KEY_WIFI_SSID = "wifi_ssid";
static const char *KEY_WIFI_PASSWORD = "wifi_pass";
static const char *KEY_STATE_URL = "state_url";

esp_err_t tokpet_config_init(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_RETURN_ON_ERROR(nvs_flash_erase(), TAG, "nvs erase failed");
        ret = nvs_flash_init();
    }
    return ret;
}

static esp_err_t get_string(nvs_handle_t nvs, const char *key, char *out, size_t out_len, bool *found)
{
    if (out == NULL || out_len == 0 || found == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    out[0] = '\0';
    *found = false;

    size_t required = 0;
    esp_err_t ret = nvs_get_str(nvs, key, NULL, &required);
    if (ret == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    ESP_RETURN_ON_ERROR(ret, TAG, "nvs get length failed");
    if (required > out_len) {
        return ESP_ERR_NVS_INVALID_LENGTH;
    }

    ret = nvs_get_str(nvs, key, out, &required);
    if (ret == ESP_OK) {
        *found = true;
    }
    return ret;
}

esp_err_t tokpet_config_load_wifi(tokpet_wifi_credentials_t *out, bool *found)
{
    if (out == NULL || found == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out, 0, sizeof(*out));
    *found = false;

    nvs_handle_t nvs = 0;
    esp_err_t open_ret = nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs);
    if (open_ret == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    ESP_RETURN_ON_ERROR(open_ret, TAG, "nvs open failed");

    bool ssid_found = false;
    bool password_found = false;
    esp_err_t ret = get_string(nvs, KEY_WIFI_SSID, out->ssid, sizeof(out->ssid), &ssid_found);
    if (ret == ESP_OK) {
        ret = get_string(nvs, KEY_WIFI_PASSWORD, out->password, sizeof(out->password), &password_found);
    }
    nvs_close(nvs);

    if (ret == ESP_OK) {
        *found = ssid_found && out->ssid[0] != '\0';
    }
    return ret;
}

esp_err_t tokpet_config_save_wifi(const tokpet_wifi_credentials_t *credentials)
{
    if (credentials == NULL || credentials->ssid[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    nvs_handle_t nvs = 0;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs), TAG, "nvs open failed");
    esp_err_t ret = nvs_set_str(nvs, KEY_WIFI_SSID, credentials->ssid);
    if (ret == ESP_OK) {
        ret = nvs_set_str(nvs, KEY_WIFI_PASSWORD, credentials->password);
    }
    if (ret == ESP_OK) {
        ret = nvs_commit(nvs);
    }
    nvs_close(nvs);
    return ret;
}

esp_err_t tokpet_config_clear_wifi(void)
{
    nvs_handle_t nvs = 0;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs), TAG, "nvs open failed");
    esp_err_t ret = nvs_erase_key(nvs, KEY_WIFI_SSID);
    if (ret == ESP_ERR_NVS_NOT_FOUND) {
        ret = ESP_OK;
    }
    if (ret == ESP_OK) {
        esp_err_t password_ret = nvs_erase_key(nvs, KEY_WIFI_PASSWORD);
        if (password_ret != ESP_ERR_NVS_NOT_FOUND) {
            ret = password_ret;
        }
    }
    if (ret == ESP_OK) {
        ret = nvs_commit(nvs);
    }
    nvs_close(nvs);
    return ret;
}

esp_err_t tokpet_config_load_state_url(char *out, size_t out_len, bool *found)
{
    nvs_handle_t nvs = 0;
    esp_err_t open_ret = nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs);
    if (open_ret == ESP_ERR_NVS_NOT_FOUND) {
        if (out != NULL && out_len > 0) {
            out[0] = '\0';
        }
        if (found != NULL) {
            *found = false;
        }
        return ESP_OK;
    }
    ESP_RETURN_ON_ERROR(open_ret, TAG, "nvs open failed");
    esp_err_t ret = get_string(nvs, KEY_STATE_URL, out, out_len, found);
    nvs_close(nvs);
    return ret;
}

esp_err_t tokpet_config_save_state_url(const char *url)
{
    if (url == NULL || url[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    nvs_handle_t nvs = 0;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs), TAG, "nvs open failed");
    esp_err_t ret = nvs_set_str(nvs, KEY_STATE_URL, url);
    if (ret == ESP_OK) {
        ret = nvs_commit(nvs);
    }
    nvs_close(nvs);
    return ret;
}
