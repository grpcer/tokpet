#include "tokpet_client.h"

#include <string.h>
#include <sys/param.h>

#include "esp_check.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "mdns.h"
#include "sdkconfig.h"
#include <stdlib.h>
#include "tokpet_config.h"
#include "tokpet_client_status.h"
#include "tokpet_state.h"
#include "ui.h"

static const char *TAG = "tokpet_client";

#define WIFI_CONNECTED_BIT BIT0
#define HTTP_MAX_RESPONSE_BYTES 8192
#define HTTP_TIMEOUT_MS 5000
#define STATE_URL_DEFAULT_PORT 4717
#define STATE_URL_PATH "/state"

typedef struct {
    char *buf;
    int cap;
    int len;
    bool overflow;
} http_capture_t;

static EventGroupHandle_t s_wifi_event_group;
static bool s_started;
static char s_state_url[TOKPET_STATE_URL_MAX_LEN];

static bool is_usable_companion_ipv4(const esp_ip4_addr_t *addr);

static void event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
        return;
    }

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        ESP_LOGW(TAG, "WiFi disconnected, reconnecting");
        esp_wifi_connect();
        ui_set_connection_status(TOKPET_UI_STATUS_LINKING, NULL);
        return;
    }

    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "WiFi got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        ui_set_connection_status(TOKPET_UI_STATUS_LINKING, NULL);
    }
}

static esp_err_t http_event_handler(esp_http_client_event_t *evt)
{
    if (evt->event_id != HTTP_EVENT_ON_DATA) {
        return ESP_OK;
    }

    http_capture_t *capture = (http_capture_t *)evt->user_data;
    if (capture == NULL || capture->buf == NULL || evt->data_len <= 0) {
        return ESP_OK;
    }

    if (capture->len + evt->data_len >= capture->cap) {
        int copy_len = MAX(0, capture->cap - capture->len - 1);
        if (copy_len > 0) {
            memcpy(capture->buf + capture->len, evt->data, copy_len);
            capture->len += copy_len;
            capture->buf[capture->len] = '\0';
        }
        capture->overflow = true;
        return ESP_FAIL;
    }

    memcpy(capture->buf + capture->len, evt->data, evt->data_len);
    capture->len += evt->data_len;
    capture->buf[capture->len] = '\0';
    return ESP_OK;
}

static esp_err_t build_state_url_from_mdns(char *out, size_t out_len)
{
    mdns_result_t *results = NULL;
    esp_err_t ret = mdns_query_ptr("_tokpet", "_tcp", 3000, 4, &results);
    if (ret != ESP_OK) {
        return ret;
    }
    if (results == NULL) {
        return ESP_ERR_NOT_FOUND;
    }

    esp_err_t result = ESP_ERR_NOT_FOUND;
    for (mdns_result_t *r = results; r != NULL; r = r->next) {
        for (mdns_ip_addr_t *addr = r->addr; addr != NULL; addr = addr->next) {
            if (addr->addr.type != ESP_IPADDR_TYPE_V4) {
                continue;
            }
            if (!is_usable_companion_ipv4(&addr->addr.u_addr.ip4)) {
                ESP_LOGW(TAG, "skipping unusable companion address: " IPSTR, IP2STR(&addr->addr.u_addr.ip4));
                continue;
            }
            uint16_t port = r->port != 0 ? r->port : STATE_URL_DEFAULT_PORT;
            int written = snprintf(out, out_len, "http://" IPSTR ":%u" STATE_URL_PATH,
                                   IP2STR(&addr->addr.u_addr.ip4), port);
            result = (written > 0 && written < out_len) ? ESP_OK : ESP_ERR_INVALID_SIZE;
            goto done;
        }
    }

done:
    mdns_query_results_free(results);
    return result;
}

static bool is_usable_companion_ipv4(const esp_ip4_addr_t *addr)
{
    if (addr == NULL) {
        return false;
    }

    uint8_t first = esp_ip4_addr1(addr);
    uint8_t second = esp_ip4_addr2(addr);
    if (first == 0 || first == 127 || first >= 224) {
        return false;
    }
    if (first == 169 && second == 254) {
        return false;
    }

    return true;
}

static esp_err_t resolve_state_url(void)
{
    esp_err_t ret = build_state_url_from_mdns(s_state_url, sizeof(s_state_url));
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "discovered companion: %s", s_state_url);
        return ESP_OK;
    }

    bool found = false;
    ret = tokpet_config_load_state_url(s_state_url, sizeof(s_state_url), &found);
    if (ret == ESP_OK && found) {
        ESP_LOGW(TAG, "using stored fallback state URL: %s", s_state_url);
        return ESP_OK;
    }

    ESP_LOGW(TAG, "companion mDNS service not found");
    ui_set_connection_status(TOKPET_UI_STATUS_ERROR, tokpet_client_status_message(TOKPET_CLIENT_STATUS_MDNS_NOT_FOUND));
    return ESP_ERR_NOT_FOUND;
}

static esp_err_t fetch_state_once(void)
{
    if (s_state_url[0] == '\0') {
        ESP_RETURN_ON_ERROR(resolve_state_url(), TAG, "resolve state URL failed");
    }

    char *response = calloc(1, HTTP_MAX_RESPONSE_BYTES);
    if (response == NULL) {
        return ESP_ERR_NO_MEM;
    }

    http_capture_t capture = {
        .buf = response,
        .cap = HTTP_MAX_RESPONSE_BYTES,
        .len = 0,
        .overflow = false,
    };

    esp_http_client_config_t config = {
        .url = s_state_url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = HTTP_TIMEOUT_MS,
        .event_handler = http_event_handler,
        .user_data = &capture,
        .buffer_size = 1024,
        .buffer_size_tx = 512,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == NULL) {
        free(response);
        return ESP_ERR_NO_MEM;
    }

    esp_err_t ret = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "GET /state failed: %s", esp_err_to_name(ret));
        s_state_url[0] = '\0';
        ui_set_connection_status(TOKPET_UI_STATUS_ERROR, tokpet_client_status_message(TOKPET_CLIENT_STATUS_HTTP_FAILED));
        free(response);
        return ret;
    }
    if (status != HttpStatus_Ok) {
        ESP_LOGW(TAG, "GET /state status=%d", status);
        s_state_url[0] = '\0';
        ui_set_connection_status(TOKPET_UI_STATUS_ERROR, tokpet_client_status_message(TOKPET_CLIENT_STATUS_HTTP_STATUS));
        free(response);
        return ESP_ERR_INVALID_RESPONSE;
    }
    if (capture.overflow) {
        ESP_LOGW(TAG, "GET /state response too large");
        ui_set_connection_status(TOKPET_UI_STATUS_ERROR, tokpet_client_status_message(TOKPET_CLIENT_STATUS_TOO_LARGE));
        free(response);
        return ESP_ERR_INVALID_SIZE;
    }

    tokpet_state_t state;
    tokpet_state_parse_result_t parse_ret = tokpet_state_parse_json(response, &state);
    if (parse_ret != TOKPET_STATE_PARSE_OK) {
        ESP_LOGW(TAG, "GET /state parse failed: %d", parse_ret);
        ui_set_connection_status(TOKPET_UI_STATUS_ERROR, tokpet_client_status_message(TOKPET_CLIENT_STATUS_PARSE_FAILED));
        free(response);
        return ESP_ERR_INVALID_RESPONSE;
    }

    ESP_LOGI(TAG, "state v%d: 5h=%d%s 7d=%d%s primary=%d%s",
             state.version,
             state.five_hour.used_pct,
             state.five_hour.present ? "%" : "%(missing)",
             state.seven_day.used_pct,
             state.seven_day.present ? "%" : "%(missing)",
             state.primary.used_pct,
             state.has_primary ? "%" : "%(missing)");
    ui_update_state(&state);
    ui_set_connection_status(TOKPET_UI_STATUS_ONLINE, NULL);
    free(response);
    return ESP_OK;
}

static void poll_task(void *arg)
{
    while (true) {
        EventBits_t bits = xEventGroupWaitBits(
            s_wifi_event_group,
            WIFI_CONNECTED_BIT,
            pdFALSE,
            pdTRUE,
            pdMS_TO_TICKS(30000));

        if ((bits & WIFI_CONNECTED_BIT) != 0) {
            esp_err_t ret = fetch_state_once();
            if (ret != ESP_OK) {
                ESP_LOGW(TAG, "keeping cached state after fetch error: %s", esp_err_to_name(ret));
            }
            vTaskDelay(pdMS_TO_TICKS(CONFIG_TOKPET_STATE_REFRESH_MS));
        } else {
            ESP_LOGW(TAG, "WiFi wait timeout");
            ui_set_connection_status(TOKPET_UI_STATUS_LINKING, "Waiting WiFi");
            vTaskDelay(pdMS_TO_TICKS(5000));
        }
    }
}

esp_err_t tokpet_client_start(void)
{
    if (s_started) {
        return ESP_OK;
    }

    tokpet_wifi_credentials_t credentials = {0};
    bool has_wifi = false;
    ESP_RETURN_ON_ERROR(tokpet_config_load_wifi(&credentials, &has_wifi), TAG, "load WiFi config failed");
    if (!has_wifi) {
        ESP_LOGW(TAG, "no WiFi credentials in NVS");
        ui_set_connection_status(TOKPET_UI_STATUS_SETUP, NULL);
        return ESP_ERR_INVALID_STATE;
    }

    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "netif init failed");
    esp_err_t event_ret = esp_event_loop_create_default();
    if (event_ret != ESP_OK && event_ret != ESP_ERR_INVALID_STATE) {
        ESP_RETURN_ON_ERROR(event_ret, TAG, "event loop init failed");
    }

    s_wifi_event_group = xEventGroupCreate();
    if (s_wifi_event_group == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_netif_t *sta_netif = esp_netif_create_default_wifi_sta();
    if (sta_netif == NULL) {
        return ESP_ERR_NO_MEM;
    }

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&cfg), TAG, "wifi init failed");
    ESP_RETURN_ON_ERROR(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, event_handler, NULL, NULL),
                        TAG, "wifi handler register failed");
    ESP_RETURN_ON_ERROR(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, event_handler, NULL, NULL),
                        TAG, "ip handler register failed");
    ESP_RETURN_ON_ERROR(mdns_init(), TAG, "mDNS init failed");

    wifi_config_t wifi_config = {0};
    strlcpy((char *)wifi_config.sta.ssid, credentials.ssid, sizeof(wifi_config.sta.ssid));
    strlcpy((char *)wifi_config.sta.password, credentials.password, sizeof(wifi_config.sta.password));
    wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    wifi_config.sta.sae_pwe_h2e = WPA3_SAE_PWE_BOTH;

    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "set wifi mode failed");
    ESP_RETURN_ON_ERROR(esp_wifi_set_config(WIFI_IF_STA, &wifi_config), TAG, "set wifi config failed");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi start failed");

    BaseType_t task_ok = xTaskCreate(poll_task, "tokpet_poll", 8192, NULL, 5, NULL);
    if (task_ok != pdPASS) {
        return ESP_ERR_NO_MEM;
    }

    s_started = true;
    ESP_LOGI(TAG, "WiFi STA starting, SSID='%s'", credentials.ssid);
    ui_set_connection_status(TOKPET_UI_STATUS_LINKING, NULL);
    return ESP_OK;
}
