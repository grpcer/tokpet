#include "tokpet_provisioning.h"

#include <errno.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "dns_server.h"
#include "esp_check.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "lwip/inet.h"
#include "tokpet_config.h"
#include "tokpet_provisioning_status.h"
#include "ui.h"

static const char *TAG = "tokpet_prov";

#define PROV_CONNECTED_BIT BIT0
#define PROV_FAILED_BIT    BIT1
#define PROV_DONE_BITS     (PROV_CONNECTED_BIT | PROV_FAILED_BIT)

#define PROV_MAX_STA_CONN 4
#define PROV_SCAN_MAX_APS 16
#define PROV_CONNECT_TIMEOUT_MS 30000

extern const char provisioning_web_start[] asm("_binary_index_html_start");
extern const char provisioning_web_end[] asm("_binary_index_html_end");

typedef enum {
    PROV_STATE_IDLE = 0,
    PROV_STATE_CONNECTING,
    PROV_STATE_CONNECTED,
    PROV_STATE_FAILED,
} prov_state_t;

static EventGroupHandle_t s_event_group;
static httpd_handle_t s_httpd;
static dns_server_handle_t s_dns;
static bool s_started;
static prov_state_t s_state = PROV_STATE_IDLE;
static char s_fail_reason[24] = "timeout";
static char s_target_ssid[TOKPET_WIFI_SSID_MAX_LEN];
static tokpet_wifi_credentials_t s_pending_credentials;
static bool s_restart_scheduled;
static uint32_t s_attempt_id;

static const char *state_name(prov_state_t state)
{
    switch (state) {
    case PROV_STATE_CONNECTING:
        return "connecting";
    case PROV_STATE_CONNECTED:
        return "connected";
    case PROV_STATE_FAILED:
        return "failed";
    case PROV_STATE_IDLE:
    default:
        return "idle";
    }
}

static void set_failed(const char *reason)
{
    s_state = PROV_STATE_FAILED;
    strlcpy(s_fail_reason, reason != NULL ? reason : "timeout", sizeof(s_fail_reason));
    xEventGroupSetBits(s_event_group, PROV_FAILED_BIT);
    ui_set_connection_status(TOKPET_UI_STATUS_ERROR, tokpet_provisioning_status_message(s_fail_reason));
}

static void delayed_restart_task(void *arg)
{
    vTaskDelay(pdMS_TO_TICKS(8000));
    ESP_LOGI(TAG, "restarting after successful provisioning");
    esp_restart();
}

static void connect_timeout_task(void *arg)
{
    uint32_t attempt_id = (uint32_t)(uintptr_t)arg;
    vTaskDelay(pdMS_TO_TICKS(PROV_CONNECT_TIMEOUT_MS));
    if (s_state == PROV_STATE_CONNECTING && s_attempt_id == attempt_id) {
        ESP_LOGW(TAG, "STA connect timeout for SSID '%s'", s_target_ssid);
        set_failed("timeout");
    }
    vTaskDelete(NULL);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    if (event_base != WIFI_EVENT) {
        return;
    }

    if (event_id == WIFI_EVENT_AP_STACONNECTED) {
        wifi_event_ap_staconnected_t *event = (wifi_event_ap_staconnected_t *)event_data;
        ESP_LOGI(TAG, "station " MACSTR " joined AP, AID=%d", MAC2STR(event->mac), event->aid);
        return;
    }

    if (event_id == WIFI_EVENT_AP_STADISCONNECTED) {
        wifi_event_ap_stadisconnected_t *event = (wifi_event_ap_stadisconnected_t *)event_data;
        ESP_LOGI(TAG, "station " MACSTR " left AP, reason=%d", MAC2STR(event->mac), event->reason);
        return;
    }

    if (event_id == WIFI_EVENT_STA_DISCONNECTED && s_state == PROV_STATE_CONNECTING) {
        wifi_event_sta_disconnected_t *event = (wifi_event_sta_disconnected_t *)event_data;
        ESP_LOGW(TAG, "STA connect failed, reason=%d", event->reason);
        if (event->reason == WIFI_REASON_AUTH_EXPIRE ||
            event->reason == WIFI_REASON_AUTH_FAIL ||
            event->reason == WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT) {
            set_failed("wrong-password");
        } else if (event->reason == WIFI_REASON_NO_AP_FOUND) {
            set_failed("not-found");
        } else {
            set_failed("timeout");
        }
    }
}

static void ip_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    if (event_base != IP_EVENT || event_id != IP_EVENT_STA_GOT_IP || s_state != PROV_STATE_CONNECTING) {
        return;
    }

    ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
    ESP_LOGI(TAG, "provisioning WiFi got IP: " IPSTR, IP2STR(&event->ip_info.ip));
    esp_err_t save_ret = tokpet_config_save_wifi(&s_pending_credentials);
    if (save_ret != ESP_OK) {
        ESP_LOGE(TAG, "save WiFi config failed: %s", esp_err_to_name(save_ret));
        set_failed("save-failed");
        return;
    }

    s_state = PROV_STATE_CONNECTED;
    xEventGroupSetBits(s_event_group, PROV_CONNECTED_BIT);
    ui_set_connection_status(TOKPET_UI_STATUS_LINKING, "Configured");
    if (!s_restart_scheduled) {
        s_restart_scheduled = true;
        xTaskCreate(delayed_restart_task, "prov_restart", 2048, NULL, 5, NULL);
    }
}

static int signal_level_from_rssi(int rssi)
{
    if (rssi >= -55) {
        return 4;
    }
    if (rssi >= -67) {
        return 3;
    }
    if (rssi >= -78) {
        return 2;
    }
    return 1;
}

static bool auth_is_secure(wifi_auth_mode_t authmode)
{
    return authmode != WIFI_AUTH_OPEN;
}

static esp_err_t send_json(httpd_req_t *req, const char *json)
{
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_sendstr(req, json);
}

static esp_err_t root_get_handler(httpd_req_t *req)
{
    const uint32_t len = provisioning_web_end - provisioning_web_start;
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, provisioning_web_start, len);
}

static esp_err_t scan_get_handler(httpd_req_t *req)
{
    wifi_scan_config_t scan_config = {0};
    esp_err_t ret = esp_wifi_scan_start(&scan_config, true);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "scan failed: %s", esp_err_to_name(ret));
        ui_set_connection_status(TOKPET_UI_STATUS_ERROR, tokpet_provisioning_status_message("scan-failed"));
        httpd_resp_set_status(req, "500 Internal Server Error");
        return send_json(req, "{\"error\":\"scan-failed\"}");
    }

    wifi_ap_record_t records[PROV_SCAN_MAX_APS] = {0};
    uint16_t count = PROV_SCAN_MAX_APS;
    ESP_RETURN_ON_ERROR(esp_wifi_scan_get_ap_records(&count, records), TAG, "get scan records failed");

    cJSON *root = cJSON_CreateArray();
    if (root == NULL) {
        return ESP_ERR_NO_MEM;
    }
    for (int i = 0; i < count; i++) {
        if (records[i].ssid[0] == '\0') {
            continue;
        }
        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "ssid", (const char *)records[i].ssid);
        cJSON_AddNumberToObject(item, "level", signal_level_from_rssi(records[i].rssi));
        cJSON_AddBoolToObject(item, "secure", auth_is_secure(records[i].authmode));
        cJSON_AddItemToArray(root, item);
    }

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (json == NULL) {
        return ESP_ERR_NO_MEM;
    }
    ret = send_json(req, json);
    cJSON_free(json);
    return ret;
}

static esp_err_t read_body(httpd_req_t *req, char *buf, size_t buf_len)
{
    if (buf == NULL || buf_len == 0 || req->content_len >= buf_len) {
        return ESP_ERR_INVALID_SIZE;
    }

    size_t received = 0;
    while (received < req->content_len) {
        int ret = httpd_req_recv(req, buf + received, req->content_len - received);
        if (ret <= 0) {
            if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            return ESP_FAIL;
        }
        received += ret;
    }
    buf[received] = '\0';
    return ESP_OK;
}

static esp_err_t connect_post_handler(httpd_req_t *req)
{
    char body[192];
    esp_err_t ret = read_body(req, body, sizeof(body));
    if (ret != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return send_json(req, "{\"error\":\"bad-request\"}");
    }

    cJSON *root = cJSON_Parse(body);
    cJSON *ssid = cJSON_GetObjectItemCaseSensitive(root, "ssid");
    cJSON *password = cJSON_GetObjectItemCaseSensitive(root, "password");
    if (!cJSON_IsString(ssid) || ssid->valuestring == NULL || ssid->valuestring[0] == '\0') {
        cJSON_Delete(root);
        ui_set_connection_status(TOKPET_UI_STATUS_ERROR, tokpet_provisioning_status_message("bad-request"));
        httpd_resp_set_status(req, "400 Bad Request");
        return send_json(req, "{\"error\":\"missing-ssid\"}");
    }

    memset(&s_pending_credentials, 0, sizeof(s_pending_credentials));
    strlcpy(s_pending_credentials.ssid, ssid->valuestring, sizeof(s_pending_credentials.ssid));
    if (cJSON_IsString(password) && password->valuestring != NULL) {
        strlcpy(s_pending_credentials.password, password->valuestring, sizeof(s_pending_credentials.password));
    }
    cJSON_Delete(root);

    ESP_LOGI(TAG, "provisioning requested for SSID '%s'", s_pending_credentials.ssid);
    strlcpy(s_target_ssid, s_pending_credentials.ssid, sizeof(s_target_ssid));
    s_state = PROV_STATE_CONNECTING;
    s_attempt_id++;
    s_fail_reason[0] = '\0';
    xEventGroupClearBits(s_event_group, PROV_DONE_BITS);

    wifi_config_t wifi_config = {0};
    strlcpy((char *)wifi_config.sta.ssid, s_pending_credentials.ssid, sizeof(wifi_config.sta.ssid));
    strlcpy((char *)wifi_config.sta.password, s_pending_credentials.password, sizeof(wifi_config.sta.password));
    wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    wifi_config.sta.sae_pwe_h2e = WPA3_SAE_PWE_BOTH;

    ESP_RETURN_ON_ERROR(esp_wifi_set_config(WIFI_IF_STA, &wifi_config), TAG, "set STA config failed");
    esp_wifi_disconnect();
    ESP_RETURN_ON_ERROR(esp_wifi_connect(), TAG, "STA connect failed");
    xTaskCreate(connect_timeout_task, "prov_timeout", 2048, (void *)(uintptr_t)s_attempt_id, 5, NULL);
    ui_set_connection_status(TOKPET_UI_STATUS_LINKING, "Joining");
    return send_json(req, "{\"ok\":true}");
}

static esp_err_t status_get_handler(httpd_req_t *req)
{
    char json[96];
    if (s_state == PROV_STATE_FAILED) {
        snprintf(json, sizeof(json), "{\"state\":\"failed\",\"reason\":\"%s\"}", s_fail_reason);
    } else {
        snprintf(json, sizeof(json), "{\"state\":\"%s\"}", state_name(s_state));
    }
    return send_json(req, json);
}

static esp_err_t http_404_handler(httpd_req_t *req, httpd_err_code_t err)
{
    httpd_resp_set_status(req, "303 See Other");
    httpd_resp_set_hdr(req, "Location", "/");
    return httpd_resp_sendstr(req, "Redirect to the Tokpet setup page");
}

static esp_err_t start_webserver(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_open_sockets = 4;
    config.lru_purge_enable = true;
    config.uri_match_fn = httpd_uri_match_wildcard;

    ESP_RETURN_ON_ERROR(httpd_start(&s_httpd, &config), TAG, "httpd start failed");

    const httpd_uri_t root = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = root_get_handler,
    };
    const httpd_uri_t scan = {
        .uri = "/api/scan",
        .method = HTTP_GET,
        .handler = scan_get_handler,
    };
    const httpd_uri_t connect = {
        .uri = "/api/connect",
        .method = HTTP_POST,
        .handler = connect_post_handler,
    };
    const httpd_uri_t status = {
        .uri = "/api/status",
        .method = HTTP_GET,
        .handler = status_get_handler,
    };

    ESP_RETURN_ON_ERROR(httpd_register_uri_handler(s_httpd, &root), TAG, "register root failed");
    ESP_RETURN_ON_ERROR(httpd_register_uri_handler(s_httpd, &scan), TAG, "register scan failed");
    ESP_RETURN_ON_ERROR(httpd_register_uri_handler(s_httpd, &connect), TAG, "register connect failed");
    ESP_RETURN_ON_ERROR(httpd_register_uri_handler(s_httpd, &status), TAG, "register status failed");
    ESP_RETURN_ON_ERROR(httpd_register_err_handler(s_httpd, HTTPD_404_NOT_FOUND, http_404_handler),
                        TAG, "register 404 failed");
    return ESP_OK;
}

static void start_dns_redirect(void)
{
    dns_server_config_t config = DNS_SERVER_CONFIG_SINGLE("*", "WIFI_AP_DEF");
    s_dns = start_dns_server(&config);
    if (s_dns == NULL) {
        ESP_LOGW(TAG, "DNS captive redirect failed to start");
    }
}

static void make_ap_ssid(char *out, size_t out_len)
{
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
    snprintf(out, out_len, "Tokpet-%02X%02X", mac[4], mac[5]);
}

esp_err_t tokpet_provisioning_start(void)
{
    if (s_started) {
        return ESP_OK;
    }

    s_event_group = xEventGroupCreate();
    if (s_event_group == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_netif_create_default_wifi_ap();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&cfg), TAG, "wifi init failed");
    ESP_RETURN_ON_ERROR(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL, NULL),
                        TAG, "wifi handler register failed");
    ESP_RETURN_ON_ERROR(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, ip_event_handler, NULL, NULL),
                        TAG, "ip handler register failed");

    char ssid[32] = {0};
    make_ap_ssid(ssid, sizeof(ssid));
    wifi_config_t ap_config = {0};
    strlcpy((char *)ap_config.ap.ssid, ssid, sizeof(ap_config.ap.ssid));
    ap_config.ap.ssid_len = strlen(ssid);
    ap_config.ap.max_connection = PROV_MAX_STA_CONN;
    ap_config.ap.authmode = WIFI_AUTH_OPEN;

    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_APSTA), TAG, "set APSTA mode failed");
    ESP_RETURN_ON_ERROR(esp_wifi_set_config(WIFI_IF_AP, &ap_config), TAG, "set AP config failed");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi start failed");

    esp_netif_ip_info_t ip_info = {0};
    esp_netif_get_ip_info(esp_netif_get_handle_from_ifkey("WIFI_AP_DEF"), &ip_info);
    ESP_LOGI(TAG, "SoftAP started: SSID='%s' IP=" IPSTR, ssid, IP2STR(&ip_info.ip));
    ui_set_connection_status(TOKPET_UI_STATUS_SETUP, ssid);

    ESP_RETURN_ON_ERROR(start_webserver(), TAG, "webserver start failed");
    start_dns_redirect();

    s_state = PROV_STATE_IDLE;
    s_started = true;
    return ESP_OK;
}
