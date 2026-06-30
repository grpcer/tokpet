#include <assert.h>
#include <string.h>

#include "tokpet_provisioning_status.h"

int main(void)
{
    assert(strcmp(tokpet_provisioning_status_message("wrong-password"), "Wrong WiFi password") == 0);
    assert(strcmp(tokpet_provisioning_status_message("not-found"), "Network not found") == 0);
    assert(strcmp(tokpet_provisioning_status_message("timeout"), "WiFi timed out") == 0);
    assert(strcmp(tokpet_provisioning_status_message("scan-failed"), "Scan failed") == 0);
    assert(strcmp(tokpet_provisioning_status_message("bad-request"), "Setup form error") == 0);
    assert(strcmp(tokpet_provisioning_status_message("save-failed"), "Save failed") == 0);
    assert(strcmp(tokpet_provisioning_status_message("unknown"), "WiFi setup failed") == 0);
    assert(strcmp(tokpet_provisioning_status_message(NULL), "WiFi setup failed") == 0);
    return 0;
}
