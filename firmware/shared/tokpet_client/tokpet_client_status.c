#include "tokpet_client_status.h"

const char *tokpet_client_status_message(tokpet_client_status_t status)
{
    switch (status) {
    case TOKPET_CLIENT_STATUS_MDNS_NOT_FOUND:
        return "Start Tokpet app";
    case TOKPET_CLIENT_STATUS_HTTP_FAILED:
        return "Companion unreachable";
    case TOKPET_CLIENT_STATUS_HTTP_STATUS:
        return "Companion HTTP error";
    case TOKPET_CLIENT_STATUS_TOO_LARGE:
        return "State too large";
    case TOKPET_CLIENT_STATUS_PARSE_FAILED:
        return "Bad state JSON";
    case TOKPET_CLIENT_STATUS_UPDATED:
    default:
        return "State updated";
    }
}
