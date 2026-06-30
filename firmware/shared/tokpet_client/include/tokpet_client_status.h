#pragma once

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    TOKPET_CLIENT_STATUS_MDNS_NOT_FOUND = 0,
    TOKPET_CLIENT_STATUS_HTTP_FAILED,
    TOKPET_CLIENT_STATUS_HTTP_STATUS,
    TOKPET_CLIENT_STATUS_TOO_LARGE,
    TOKPET_CLIENT_STATUS_PARSE_FAILED,
    TOKPET_CLIENT_STATUS_UPDATED,
} tokpet_client_status_t;

const char *tokpet_client_status_message(tokpet_client_status_t status);

#ifdef __cplusplus
}
#endif
