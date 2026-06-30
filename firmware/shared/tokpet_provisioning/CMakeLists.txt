idf_component_register(
    SRCS "tokpet_provisioning.c" "tokpet_provisioning_status.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_wifi esp_event esp_netif esp_http_server json tokpet_config ui dns_server
    EMBED_FILES "../../provisioning-web/index.html"
)
