idf_component_register(
    SRCS "tokpet_client.c" "tokpet_client_status.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_wifi esp_event esp_netif esp_http_client tokpet_config tokpet_state ui mdns
)
