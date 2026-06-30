#include "tokpet_state.h"

#include <ctype.h>
#include <string.h>

#include "cJSON.h"

static int clamp_pct(double value)
{
    if (value < 0) {
        return 0;
    }
    if (value > 100) {
        return 100;
    }
    return (int)(value + 0.5);
}

static void copy_json_string(cJSON *obj, const char *key, char *dst, size_t dst_len)
{
    if (dst_len == 0) {
        return;
    }
    dst[0] = '\0';
    cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (cJSON_IsString(item) && item->valuestring != NULL) {
        strlcpy(dst, item->valuestring, dst_len);
    }
}

static int json_int(cJSON *obj, const char *key, int default_value)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (!cJSON_IsNumber(item)) {
        return default_value;
    }
    return (int)item->valuedouble;
}

static int json_pct(cJSON *obj, const char *key)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (!cJSON_IsNumber(item)) {
        return 0;
    }
    return clamp_pct(item->valuedouble);
}

static bool contains_ci(const char *haystack, const char *needle)
{
    if (haystack == NULL || needle == NULL || needle[0] == '\0') {
        return false;
    }

    for (const char *h = haystack; *h != '\0'; h++) {
        const char *hp = h;
        const char *np = needle;
        while (*hp != '\0' && *np != '\0' &&
               tolower((unsigned char)*hp) == tolower((unsigned char)*np)) {
            hp++;
            np++;
        }
        if (*np == '\0') {
            return true;
        }
    }
    return false;
}

static tokpet_mood_t parse_mood(cJSON *primary, int used_pct)
{
    cJSON *mood = cJSON_GetObjectItemCaseSensitive(primary, "mood");
    if (cJSON_IsString(mood) && mood->valuestring != NULL) {
        if (strcmp(mood->valuestring, "stress") == 0) {
            return TOKPET_MOOD_STRESS;
        }
        if (strcmp(mood->valuestring, "alert") == 0) {
            return TOKPET_MOOD_ALERT;
        }
        if (strcmp(mood->valuestring, "chill") == 0) {
            return TOKPET_MOOD_CHILL;
        }
    }
    return tokpet_mood_from_pct(used_pct);
}

static void copy_window(tokpet_usage_window_t *dst, cJSON *window)
{
    memset(dst, 0, sizeof(*dst));
    dst->present = true;
    copy_json_string(window, "id", dst->id, sizeof(dst->id));
    copy_json_string(window, "label", dst->label, sizeof(dst->label));
    copy_json_string(window, "resetsAt", dst->resets_at, sizeof(dst->resets_at));
    dst->used_pct = json_pct(window, "usedPct");
    dst->duration_mins = json_int(window, "durationMins", 0);
}

static bool is_five_hour_window(cJSON *window)
{
    char id[TOKPET_WINDOW_ID_MAX_LEN] = {0};
    char label[TOKPET_WINDOW_LABEL_MAX_LEN] = {0};
    copy_json_string(window, "id", id, sizeof(id));
    copy_json_string(window, "label", label, sizeof(label));
    int duration_mins = json_int(window, "durationMins", 0);

    return strcmp(id, "5h") == 0 ||
           contains_ci(id, "5h") ||
           contains_ci(id, "five") ||
           contains_ci(label, "5h") ||
           contains_ci(label, "5 hours") ||
           contains_ci(label, "five hours") ||
           duration_mins == 300;
}

static bool is_seven_day_window(cJSON *window)
{
    char id[TOKPET_WINDOW_ID_MAX_LEN] = {0};
    char label[TOKPET_WINDOW_LABEL_MAX_LEN] = {0};
    copy_json_string(window, "id", id, sizeof(id));
    copy_json_string(window, "label", label, sizeof(label));
    int duration_mins = json_int(window, "durationMins", 0);

    return strcmp(id, "7d") == 0 ||
           contains_ci(id, "7d") ||
           contains_ci(id, "seven") ||
           contains_ci(label, "7d") ||
           contains_ci(label, "7 days") ||
           contains_ci(label, "seven days") ||
           duration_mins == 10080;
}

static tokpet_provider_mode_t parse_provider_mode(const char *mode)
{
    if (mode == NULL) {
        return TOKPET_PROVIDER_MODE_UNKNOWN;
    }
    if (strcmp(mode, "subscription") == 0) {
        return TOKPET_PROVIDER_MODE_SUBSCRIPTION;
    }
    if (strcmp(mode, "api-key") == 0) {
        return TOKPET_PROVIDER_MODE_API_KEY;
    }
    if (strcmp(mode, "relay") == 0) {
        return TOKPET_PROVIDER_MODE_RELAY;
    }
    return TOKPET_PROVIDER_MODE_UNKNOWN;
}

// DeepSeek's balance currency field is officially "CNY"/"USD"/"EUR"; other values keep their
// first N bytes verbatim, giving the UI a fallback for threshold checks (a value not on the
// whitelist is simply displayed as-is).
static void copy_balance(tokpet_state_balance_t *dst, cJSON *balance)
{
    memset(dst, 0, sizeof(*dst));
    if (!cJSON_IsObject(balance)) {
        return;
    }
    cJSON *remaining = cJSON_GetObjectItemCaseSensitive(balance, "remaining");
    if (!cJSON_IsNumber(remaining)) {
        return;
    }
    dst->present = true;
    dst->remaining = remaining->valuedouble;
    copy_json_string(balance, "currency", dst->currency, sizeof(dst->currency));
}

void tokpet_state_init_empty(tokpet_state_t *state)
{
    if (state == NULL) {
        return;
    }
    memset(state, 0, sizeof(*state));
    state->version = 1;
}

tokpet_mood_t tokpet_mood_from_pct(int pct)
{
    if (pct >= 80) {
        return TOKPET_MOOD_STRESS;
    }
    if (pct >= 50) {
        return TOKPET_MOOD_ALERT;
    }
    return TOKPET_MOOD_CHILL;
}

const char *tokpet_mood_name(tokpet_mood_t mood)
{
    switch (mood) {
    case TOKPET_MOOD_STRESS:
        return "stress";
    case TOKPET_MOOD_ALERT:
        return "alert";
    case TOKPET_MOOD_CHILL:
    default:
        return "chill";
    }
}

tokpet_state_parse_result_t tokpet_state_parse_json(const char *json, tokpet_state_t *out)
{
    if (json == NULL || out == NULL) {
        return TOKPET_STATE_PARSE_ERR_INVALID_ARG;
    }

    cJSON *root = cJSON_Parse(json);
    if (root == NULL) {
        return TOKPET_STATE_PARSE_ERR_INVALID_JSON;
    }
    if (!cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return TOKPET_STATE_PARSE_ERR_SCHEMA;
    }

    tokpet_state_t state;
    tokpet_state_init_empty(&state);
    state.version = json_int(root, "version", 0);
    copy_json_string(root, "fetchedAt", state.fetched_at, sizeof(state.fetched_at));
    if (state.version != 1) {
        cJSON_Delete(root);
        return TOKPET_STATE_PARSE_ERR_SCHEMA;
    }

    cJSON *primary = cJSON_GetObjectItemCaseSensitive(root, "primary");
    if (cJSON_IsObject(primary)) {
        state.has_primary = true;
        copy_json_string(primary, "providerId", state.primary.provider_id, sizeof(state.primary.provider_id));
        copy_json_string(primary, "windowId", state.primary.window_id, sizeof(state.primary.window_id));
        state.primary.used_pct = json_pct(primary, "usedPct");
        state.primary.mood = parse_mood(primary, state.primary.used_pct);
    }

    cJSON *providers = cJSON_GetObjectItemCaseSensitive(root, "providers");
    if (cJSON_IsArray(providers)) {
        cJSON *provider = NULL;
        cJSON_ArrayForEach(provider, providers) {
            if (state.provider_count >= TOKPET_PROVIDER_MAX_COUNT) {
                break;
            }

            cJSON *result = cJSON_GetObjectItemCaseSensitive(provider, "result");
            if (!cJSON_IsObject(result)) {
                continue;
            }

            // When result.kind === "error" the provider still occupies a slot, but only id /
            // mode / error_code are filled, so the UI can find the old tile by provider_id, keep
            // last round's data, and overlay a reconnect hint.
            // The old logic used continue here, which would rebuild the whole screen into a
            // placeholder when provider_count=0.
            cJSON *kind = cJSON_GetObjectItemCaseSensitive(result, "kind");
            bool is_error = cJSON_IsString(kind) && strcmp(kind->valuestring, "error") == 0;

            tokpet_provider_state_t *slot = &state.providers[state.provider_count];
            memset(slot, 0, sizeof(*slot));

            if (is_error) {
                slot->present = true;
                slot->is_error = true;
                copy_json_string(provider, "id", slot->id, sizeof(slot->id));
                copy_json_string(result, "code", slot->error_code, sizeof(slot->error_code));
                // The error result has no result.mode; take it from the top-level provider.mode to decide the tile kind
                char mode_buf[16] = {0};
                copy_json_string(provider, "mode", mode_buf, sizeof(mode_buf));
                slot->mode = parse_provider_mode(mode_buf);
                state.provider_count++;
                continue;
            }

            cJSON *mode = cJSON_GetObjectItemCaseSensitive(result, "mode");
            if (!cJSON_IsString(mode)) {
                continue;
            }

            slot->present = true;
            // The top-level provider's id (matches result.providerId)
            copy_json_string(provider, "id", slot->id, sizeof(slot->id));
            slot->mode = parse_provider_mode(mode->valuestring);

            if (slot->mode == TOKPET_PROVIDER_MODE_SUBSCRIPTION) {
                cJSON *windows = cJSON_GetObjectItemCaseSensitive(result, "windows");
                if (cJSON_IsArray(windows)) {
                    cJSON *window = NULL;
                    cJSON_ArrayForEach(window, windows) {
                        if (!cJSON_IsObject(window)) {
                            continue;
                        }
                        if (!slot->five_hour.present && is_five_hour_window(window)) {
                            copy_window(&slot->five_hour, window);
                            if (!state.five_hour.present) {
                                state.five_hour = slot->five_hour;
                            }
                        }
                        if (!slot->seven_day.present && is_seven_day_window(window)) {
                            copy_window(&slot->seven_day, window);
                            if (!state.seven_day.present) {
                                state.seven_day = slot->seven_day;
                            }
                        }
                    }
                }
            } else if (slot->mode == TOKPET_PROVIDER_MODE_API_KEY) {
                cJSON *balance = cJSON_GetObjectItemCaseSensitive(result, "balance");
                copy_balance(&slot->balance, balance);
            }

            state.provider_count++;
        }
    }

    *out = state;
    cJSON_Delete(root);
    return TOKPET_STATE_PARSE_OK;
}
