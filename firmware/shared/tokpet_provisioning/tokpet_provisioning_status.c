#include "tokpet_provisioning_status.h"

#include <string.h>

const char *tokpet_provisioning_status_message(const char *reason)
{
    if (reason == NULL) {
        return "WiFi setup failed";
    }
    if (strcmp(reason, "wrong-password") == 0) {
        return "Wrong WiFi password";
    }
    if (strcmp(reason, "not-found") == 0) {
        return "Network not found";
    }
    if (strcmp(reason, "timeout") == 0) {
        return "WiFi timed out";
    }
    if (strcmp(reason, "scan-failed") == 0) {
        return "Scan failed";
    }
    if (strcmp(reason, "bad-request") == 0) {
        return "Setup form error";
    }
    if (strcmp(reason, "save-failed") == 0) {
        return "Save failed";
    }
    return "WiFi setup failed";
}
