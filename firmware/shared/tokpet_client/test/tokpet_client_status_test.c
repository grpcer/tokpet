#include <assert.h>
#include <string.h>

#include "tokpet_client_status.h"

int main(void)
{
    assert(strcmp(tokpet_client_status_message(TOKPET_CLIENT_STATUS_MDNS_NOT_FOUND), "Start Tokpet app") == 0);
    assert(strcmp(tokpet_client_status_message(TOKPET_CLIENT_STATUS_HTTP_FAILED), "Companion unreachable") == 0);
    assert(strcmp(tokpet_client_status_message(TOKPET_CLIENT_STATUS_HTTP_STATUS), "Companion HTTP error") == 0);
    assert(strcmp(tokpet_client_status_message(TOKPET_CLIENT_STATUS_TOO_LARGE), "State too large") == 0);
    assert(strcmp(tokpet_client_status_message(TOKPET_CLIENT_STATUS_PARSE_FAILED), "Bad state JSON") == 0);
    assert(strcmp(tokpet_client_status_message(TOKPET_CLIENT_STATUS_UPDATED), "State updated") == 0);
    return 0;
}
