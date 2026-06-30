#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define TOKPET_PROVIDER_ID_MAX_LEN 32
#define TOKPET_WINDOW_ID_MAX_LEN   32
#define TOKPET_WINDOW_LABEL_MAX_LEN 40
#define TOKPET_ISO_TIME_MAX_LEN    32
#define TOKPET_CURRENCY_MAX_LEN    8
#define TOKPET_PROVIDER_MAX_COUNT  4
#define TOKPET_PROVIDER_ERROR_CODE_MAX_LEN 32

typedef enum {
    TOKPET_MOOD_CHILL = 0,
    TOKPET_MOOD_ALERT,
    TOKPET_MOOD_STRESS,
} tokpet_mood_t;

typedef enum {
    TOKPET_PROVIDER_MODE_UNKNOWN = 0,
    TOKPET_PROVIDER_MODE_SUBSCRIPTION,
    TOKPET_PROVIDER_MODE_API_KEY,
    TOKPET_PROVIDER_MODE_RELAY,
} tokpet_provider_mode_t;

typedef enum {
    TOKPET_STATE_PARSE_OK = 0,
    TOKPET_STATE_PARSE_ERR_INVALID_ARG,
    TOKPET_STATE_PARSE_ERR_INVALID_JSON,
    TOKPET_STATE_PARSE_ERR_SCHEMA,
} tokpet_state_parse_result_t;

typedef struct {
    bool present;
    char id[TOKPET_WINDOW_ID_MAX_LEN];
    char label[TOKPET_WINDOW_LABEL_MAX_LEN];
    int used_pct;
    char resets_at[TOKPET_ISO_TIME_MAX_LEN];
    int duration_mins;
} tokpet_usage_window_t;

typedef struct {
    char provider_id[TOKPET_PROVIDER_ID_MAX_LEN];
    char window_id[TOKPET_WINDOW_ID_MAX_LEN];
    int used_pct;
    tokpet_mood_t mood;
} tokpet_primary_t;

// Prepaid wallet balance (api-key mode). `remaining=0` is a valid empty wallet state,
// which the UI shows as "Empty" based on a threshold check and does not count as a UsageError.
typedef struct {
    bool present;
    double remaining;
    char currency[TOKPET_CURRENCY_MAX_LEN];
} tokpet_state_balance_t;

// Each provider carries its own copy of windows / balance, and the UI looks up the matching
// screen to render by provider_id. `is_error=true` means this round's fetch failed
// (result.kind === "error"). When the UI sees is_error it must not overwrite the old data in
// the widgets -- it skips this round's update and keeps the previous numeric snapshot (windows /
// balance are zero-valued in the error case, so they must be skipped, otherwise they get wiped).
// **Do not overlay a translucent mask and do not write a "Reconnect" label** (the early approach
// was dropped; the device screen does not actively call for a reconnect); the top-left status
// indicator follows each board's existing path.
typedef struct {
    bool present;
    bool is_error;
    char id[TOKPET_PROVIDER_ID_MAX_LEN];
    tokpet_provider_mode_t mode;
    tokpet_usage_window_t five_hour;
    tokpet_usage_window_t seven_day;
    tokpet_state_balance_t balance;
    char error_code[TOKPET_PROVIDER_ERROR_CODE_MAX_LEN];
} tokpet_provider_state_t;

typedef struct {
    int version;
    char fetched_at[TOKPET_ISO_TIME_MAX_LEN];
    bool has_primary;
    tokpet_primary_t primary;
    // Compatibility snapshot: the first subscription provider's windows are also copied to the
    // top level, so the single-screen Claude rendering path is unaffected.
    tokpet_usage_window_t five_hour;
    tokpet_usage_window_t seven_day;
    int provider_count;
    tokpet_provider_state_t providers[TOKPET_PROVIDER_MAX_COUNT];
} tokpet_state_t;

void tokpet_state_init_empty(tokpet_state_t *state);
tokpet_mood_t tokpet_mood_from_pct(int pct);
const char *tokpet_mood_name(tokpet_mood_t mood);
tokpet_state_parse_result_t tokpet_state_parse_json(const char *json, tokpet_state_t *out);

#ifdef __cplusplus
}
#endif
