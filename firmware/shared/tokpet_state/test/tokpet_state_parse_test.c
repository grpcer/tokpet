#include <assert.h>
#include <math.h>
#include <string.h>

#include "tokpet_state.h"

static void parses_subscription_windows(void)
{
    const char *json =
        "{"
        "\"version\":1,"
        "\"fetchedAt\":\"2026-05-29T16:10:46.353Z\","
        "\"primary\":{\"providerId\":\"claude\",\"windowId\":\"five-hour\",\"usedPct\":91,\"mood\":\"stress\"},"
        "\"providers\":[{\"id\":\"claude\",\"displayName\":\"Claude\",\"mode\":\"subscription\","
        "\"result\":{\"mode\":\"subscription\",\"fetchedAt\":\"2026-05-29T16:10:46.000Z\",\"source\":\"live\","
        "\"windows\":["
        "{\"id\":\"five-hour\",\"label\":\"Past 5 hours\",\"usedPct\":91,\"resetsAt\":\"2026-05-29T18:22:00.000Z\",\"durationMins\":300},"
        "{\"id\":\"seven-day\",\"label\":\"Past 7 days\",\"usedPct\":46,\"resetsAt\":\"2026-05-30T13:00:00.000Z\",\"durationMins\":10080}"
        "]}}]}";

    tokpet_state_t state;
    assert(tokpet_state_parse_json(json, &state) == TOKPET_STATE_PARSE_OK);
    assert(state.version == 1);
    assert(strcmp(state.fetched_at, "2026-05-29T16:10:46.353Z") == 0);

    assert(state.has_primary);
    assert(strcmp(state.primary.provider_id, "claude") == 0);
    assert(strcmp(state.primary.window_id, "five-hour") == 0);
    assert(state.primary.used_pct == 91);
    assert(state.primary.mood == TOKPET_MOOD_STRESS);

    assert(state.five_hour.present);
    assert(strcmp(state.five_hour.id, "five-hour") == 0);
    assert(state.five_hour.used_pct == 91);
    assert(strcmp(state.five_hour.resets_at, "2026-05-29T18:22:00.000Z") == 0);

    assert(state.seven_day.present);
    assert(strcmp(state.seven_day.id, "seven-day") == 0);
    assert(state.seven_day.used_pct == 46);
    assert(strcmp(state.seven_day.resets_at, "2026-05-30T13:00:00.000Z") == 0);

    assert(state.provider_count == 1);
    assert(state.providers[0].present);
    assert(strcmp(state.providers[0].id, "claude") == 0);
    assert(state.providers[0].mode == TOKPET_PROVIDER_MODE_SUBSCRIPTION);
    assert(state.providers[0].five_hour.present);
    assert(state.providers[0].five_hour.used_pct == 91);
    assert(state.providers[0].seven_day.present);
    assert(state.providers[0].seven_day.used_pct == 46);
    assert(!state.providers[0].balance.present);
}

static void parses_deepseek_api_key_balance(void)
{
    const char *json =
        "{"
        "\"version\":1,"
        "\"fetchedAt\":\"2026-05-30T13:09:27.043Z\","
        "\"providers\":[{\"id\":\"deepseek\",\"displayName\":\"DeepSeek\",\"mode\":\"api-key\","
        "\"result\":{\"mode\":\"api-key\",\"fetchedAt\":\"2026-05-30T13:09:27.000Z\",\"source\":\"live\","
        "\"balance\":{\"remaining\":8.81,\"currency\":\"CNY\"}}}]}";

    tokpet_state_t state;
    assert(tokpet_state_parse_json(json, &state) == TOKPET_STATE_PARSE_OK);
    assert(state.provider_count == 1);
    assert(state.providers[0].present);
    assert(strcmp(state.providers[0].id, "deepseek") == 0);
    assert(state.providers[0].mode == TOKPET_PROVIDER_MODE_API_KEY);
    assert(state.providers[0].balance.present);
    assert(fabs(state.providers[0].balance.remaining - 8.81) < 0.001);
    assert(strcmp(state.providers[0].balance.currency, "CNY") == 0);
    // The subscription compatibility fields are not polluted.
    assert(!state.providers[0].five_hour.present);
    assert(!state.five_hour.present);
    assert(!state.seven_day.present);
}

static void parses_subscription_and_api_key_together(void)
{
    const char *json =
        "{"
        "\"version\":1,"
        "\"fetchedAt\":\"2026-05-30T14:00:00.000Z\","
        "\"primary\":{\"providerId\":\"claude\",\"windowId\":\"seven-day\",\"usedPct\":46,\"mood\":\"alert\"},"
        "\"providers\":["
        "{\"id\":\"claude\",\"displayName\":\"Claude\",\"mode\":\"subscription\","
        "\"result\":{\"mode\":\"subscription\",\"fetchedAt\":\"2026-05-30T14:00:00.000Z\",\"source\":\"live\","
        "\"windows\":["
        "{\"id\":\"five-hour\",\"label\":\"Past 5 hours\",\"usedPct\":8,\"resetsAt\":\"2026-05-30T18:22:00.000Z\",\"durationMins\":300},"
        "{\"id\":\"seven-day\",\"label\":\"Past 7 days\",\"usedPct\":46,\"resetsAt\":\"2026-06-06T14:00:00.000Z\",\"durationMins\":10080}"
        "]}},"
        "{\"id\":\"deepseek\",\"displayName\":\"DeepSeek\",\"mode\":\"api-key\","
        "\"result\":{\"mode\":\"api-key\",\"fetchedAt\":\"2026-05-30T14:00:00.000Z\",\"source\":\"live\","
        "\"balance\":{\"remaining\":110.0,\"currency\":\"CNY\"}}}]}";

    tokpet_state_t state;
    assert(tokpet_state_parse_json(json, &state) == TOKPET_STATE_PARSE_OK);
    assert(state.provider_count == 2);

    // claude
    assert(strcmp(state.providers[0].id, "claude") == 0);
    assert(state.providers[0].mode == TOKPET_PROVIDER_MODE_SUBSCRIPTION);
    assert(state.providers[0].five_hour.used_pct == 8);
    assert(state.providers[0].seven_day.used_pct == 46);
    assert(!state.providers[0].balance.present);

    // deepseek
    assert(strcmp(state.providers[1].id, "deepseek") == 0);
    assert(state.providers[1].mode == TOKPET_PROVIDER_MODE_API_KEY);
    assert(state.providers[1].balance.present);
    assert(fabs(state.providers[1].balance.remaining - 110.0) < 0.001);
    assert(strcmp(state.providers[1].balance.currency, "CNY") == 0);
    assert(!state.providers[1].five_hour.present);

    // The top-level compatibility snapshot comes from the first subscription provider.
    assert(state.five_hour.present);
    assert(state.five_hour.used_pct == 8);
    assert(state.seven_day.present);
    assert(state.seven_day.used_pct == 46);
}

// A `result.kind === "error"` provider still occupies a slot with is_error=true,
// so the UI can find the old tile by provider_id, keep the old data, and overlay a reconnect hint.
static void keeps_error_provider_slot(void)
{
    const char *json =
        "{"
        "\"version\":1,"
        "\"fetchedAt\":\"2026-05-30T14:00:00.000Z\","
        "\"providers\":["
        "{\"id\":\"claude\",\"displayName\":\"Claude\",\"mode\":\"subscription\","
        "\"result\":{\"kind\":\"error\",\"code\":\"auth-expired\",\"message\":\"login expired\","
        "\"fetchedAt\":\"2026-05-30T14:00:00.000Z\"}},"
        "{\"id\":\"deepseek\",\"displayName\":\"DeepSeek\",\"mode\":\"api-key\","
        "\"result\":{\"mode\":\"api-key\",\"fetchedAt\":\"2026-05-30T14:00:00.000Z\",\"source\":\"live\","
        "\"balance\":{\"remaining\":1.5,\"currency\":\"CNY\"}}}]}";

    tokpet_state_t state;
    assert(tokpet_state_parse_json(json, &state) == TOKPET_STATE_PARSE_OK);
    assert(state.provider_count == 2);

    // claude enters a slot, marked is_error; the subscription tile is derived from the top-level provider.mode
    assert(state.providers[0].present);
    assert(state.providers[0].is_error);
    assert(strcmp(state.providers[0].id, "claude") == 0);
    assert(state.providers[0].mode == TOKPET_PROVIDER_MODE_SUBSCRIPTION);
    assert(strcmp(state.providers[0].error_code, "auth-expired") == 0);
    // error does not fill windows / balance / top-level compatibility snapshot
    assert(!state.providers[0].five_hour.present);
    assert(!state.providers[0].seven_day.present);
    assert(!state.providers[0].balance.present);
    assert(!state.five_hour.present);
    assert(!state.seven_day.present);

    // healthy deepseek parses normally
    assert(state.providers[1].present);
    assert(!state.providers[1].is_error);
    assert(strcmp(state.providers[1].id, "deepseek") == 0);
    assert(state.providers[1].mode == TOKPET_PROVIDER_MODE_API_KEY);
    assert(state.providers[1].balance.present);
}

// When all providers are in error, provider_count still reflects the count,
// so the UI will not rebuild the tiles into a placeholder just because the signature becomes "@empty".
static void all_providers_error_keeps_tile_count(void)
{
    const char *json =
        "{"
        "\"version\":1,"
        "\"fetchedAt\":\"2026-05-30T14:00:00.000Z\","
        "\"providers\":["
        "{\"id\":\"claude\",\"displayName\":\"Claude\",\"mode\":\"subscription\","
        "\"result\":{\"kind\":\"error\",\"code\":\"auth-expired\","
        "\"fetchedAt\":\"2026-05-30T14:00:00.000Z\"}},"
        "{\"id\":\"deepseek\",\"displayName\":\"DeepSeek\",\"mode\":\"api-key\","
        "\"result\":{\"kind\":\"error\",\"code\":\"http-401\","
        "\"fetchedAt\":\"2026-05-30T14:00:00.000Z\"}}]}";

    tokpet_state_t state;
    assert(tokpet_state_parse_json(json, &state) == TOKPET_STATE_PARSE_OK);
    assert(state.provider_count == 2);
    assert(state.providers[0].is_error);
    assert(state.providers[0].mode == TOKPET_PROVIDER_MODE_SUBSCRIPTION);
    assert(strcmp(state.providers[0].error_code, "auth-expired") == 0);
    assert(state.providers[1].is_error);
    assert(state.providers[1].mode == TOKPET_PROVIDER_MODE_API_KEY);
    assert(strcmp(state.providers[1].error_code, "http-401") == 0);
}

static void accepts_empty_provider_list(void)
{
    tokpet_state_t state;
    assert(tokpet_state_parse_json("{\"version\":1,\"fetchedAt\":\"2026-05-29T16:10:46.353Z\",\"providers\":[]}", &state) ==
           TOKPET_STATE_PARSE_OK);
    assert(state.version == 1);
    assert(!state.has_primary);
    assert(!state.five_hour.present);
    assert(!state.seven_day.present);
}

static void rejects_malformed_json(void)
{
    tokpet_state_t state;
    assert(tokpet_state_parse_json("{", &state) == TOKPET_STATE_PARSE_ERR_INVALID_JSON);
}

int main(void)
{
    parses_subscription_windows();
    parses_deepseek_api_key_balance();
    parses_subscription_and_api_key_together();
    keeps_error_provider_slot();
    all_providers_error_keeps_tile_count();
    accepts_empty_provider_list();
    rejects_malformed_json();
    return 0;
}
