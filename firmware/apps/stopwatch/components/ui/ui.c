#include <stdio.h>
#include <string.h>

#include "ui.h"
#include "esp_lvgl_port.h"
#include "esp_log.h"
#include "lvgl.h"
#include "lcd_co5300.h"  // LCD_H_RES / LCD_V_RES

static const char *TAG = "ui";

// Build-time baked image assets (assets/gen_*.py: resvg|rsvg-convert + official LVGLImage.py, RGB565A8 premultiply)
LV_IMAGE_DECLARE(cat_chill);
LV_IMAGE_DECLARE(cat_uneasy);
LV_IMAGE_DECLARE(cat_panic);
LV_IMAGE_DECLARE(claude_logo);
LV_IMAGE_DECLARE(codex_logo);
LV_IMAGE_DECLARE(deepseek_logo);

// Stress color palette: green chill / amber alert / red stress
#define COLOR_CHILL  0x37D67A
#define COLOR_ALERT  0xFFB23E
#define COLOR_STRESS 0xFF4D4D
#define COLOR_SETUP  0x3E8EFF
#define COLOR_DIM    0x6B6B6B
#define COLOR_BG     0x000000

// DeepSeek-style prepaid wallet balance thresholds (CNY; USD/EUR reuse the same numbers for now, tune on real hardware / multi-currency later)
#define WALLET_LOW_REMAINING   5.0
#define WALLET_EMPTY_REMAINING 0.0

// tile kind: decides which widgets to build + which demux branch apply takes.
typedef enum {
    UI_TILE_KIND_PLACEHOLDER = 0,  // startup / 0 providers
    UI_TILE_KIND_SUBSCRIPTION,     // Claude/Codex: dual-ring halo cat + two readings
    UI_TILE_KIND_WALLET,           // DeepSeek-style api-key: single health ring + CNY wallet hero number
} ui_tile_kind_t;

typedef struct {
    bool used;
    char provider_id[TOKPET_PROVIDER_ID_MAX_LEN];
    ui_tile_kind_t kind;
    lv_obj_t *tile;
    lv_obj_t *cat;          // shared: single-image swaying cat
    // subscription-specific
    lv_obj_t *arc_5h;       // inner ring
    lv_obj_t *arc_7d;       // outer ring
    lv_obj_t *tag_5h;
    lv_obj_t *tag_7d;
    lv_obj_t *val_5h;
    lv_obj_t *val_7d;
    lv_obj_t *reset_5h;
    lv_obj_t *reset_7d;
    // wallet-specific
    lv_obj_t *ring;         // single health ring (full-circle decoration)
    lv_obj_t *ccy_tag;      // currency code (CNY/USD)
    lv_obj_t *amt_int;      // balance integer part
    lv_obj_t *amt_dec;      // .fractional part
    lv_obj_t *state_line;   // wallet status text
    // This round's provider result.kind=="error": keep the widgets' old values, only switch the top-left status to red Offline.
    bool is_error_state;
} ui_tile_t;

static ui_tile_t s_tiles[TOKPET_PROVIDER_MAX_COUNT];
static lv_obj_t *s_stage;              // full-screen stage: gesture switches tiles, avoids the live-scroll redraw of tileview
static lv_obj_t *s_status_overlay;     // global status line (dot+label), must be raised after rebuild
static lv_obj_t *s_status_dot;
static lv_obj_t *s_status_label;
static lv_obj_t *s_page_box;           // global page-indicator container
static lv_obj_t *s_page_dots[TOKPET_PROVIDER_MAX_COUNT];
static int s_tile_count;
static int s_active_idx;
static bool s_ready;
static tokpet_state_t s_cached_state;
static bool s_has_cached_state;
// tile topology signature "<id>:<mode>;..." ("@empty" for 0 providers); unchanged means skip rebuild, preserving swipe position + sway.
static char s_tile_signature[160];
// Network-layer status (set by tokpet_client via ui_set_connection_status); shown when the active tile is healthy,
// overridden by red "Offline" when the active tile is in error.
static tokpet_ui_status_level_t s_net_level = TOKPET_UI_STATUS_OFFLINE;
static char s_net_label[64] = "Starting";

static void ui_build_tiles_from_state_locked(const tokpet_state_t *state);
static void apply_state_locked(const tokpet_state_t *state);
static void refresh_active_tile_status_locked(void);

// ===== color / text util =====

static lv_color_t mood_color(int pct)
{
    switch (tokpet_mood_from_pct(pct)) {
        case TOKPET_MOOD_CHILL: return lv_color_hex(COLOR_CHILL);
        case TOKPET_MOOD_ALERT: return lv_color_hex(COLOR_ALERT);
        default:                return lv_color_hex(COLOR_STRESS);
    }
}

static lv_color_t balance_color(double remaining)
{
    if (remaining <= WALLET_EMPTY_REMAINING) return lv_color_hex(COLOR_STRESS);
    if (remaining <= WALLET_LOW_REMAINING)   return lv_color_hex(COLOR_ALERT);
    return lv_color_hex(COLOR_CHILL);
}

static tokpet_mood_t balance_mood(double remaining)
{
    if (remaining <= WALLET_EMPTY_REMAINING) return TOKPET_MOOD_STRESS;
    if (remaining <= WALLET_LOW_REMAINING)   return TOKPET_MOOD_ALERT;
    return TOKPET_MOOD_CHILL;
}

// Cat's three mood sprites (chill/uneasy/panic).
static const lv_image_dsc_t *cat_for_mood(tokpet_mood_t m)
{
    switch (m) {
        case TOKPET_MOOD_ALERT:  return &cat_uneasy;
        case TOKPET_MOOD_STRESS: return &cat_panic;
        default:                 return &cat_chill;
    }
}

static lv_color_t status_color(tokpet_ui_status_level_t level)
{
    switch (level) {
        case TOKPET_UI_STATUS_ONLINE:  return lv_color_hex(COLOR_CHILL);
        case TOKPET_UI_STATUS_LINKING: return lv_color_hex(COLOR_ALERT);
        case TOKPET_UI_STATUS_SETUP:   return lv_color_hex(COLOR_SETUP);
        case TOKPET_UI_STATUS_ERROR:   return lv_color_hex(COLOR_STRESS);
        default:                       return lv_color_hex(COLOR_DIM);
    }
}

static const char *status_text(tokpet_ui_status_level_t level)
{
    switch (level) {
        case TOKPET_UI_STATUS_ONLINE:  return "Online";
        case TOKPET_UI_STATUS_LINKING: return "Linking";
        case TOKPET_UI_STATUS_SETUP:   return "Setup";
        case TOKPET_UI_STATUS_ERROR:   return "Error";
        default:                       return "Offline";
    }
}

// ISO8601 UTC -> epoch seconds (ported from atk-s3box; does not rely on the device RTC, only computes differences).
static bool parse_iso_utc_seconds(const char *iso, int64_t *out)
{
    if (out == NULL) {
        return false;
    }
    *out = 0;
    if (iso == NULL || iso[0] == '\0') {
        return false;
    }
    int year = 0, mon = 0, day = 0, hour = 0, min = 0, sec = 0;
    if (sscanf(iso, "%d-%d-%dT%d:%d:%d", &year, &mon, &day, &hour, &min, &sec) != 6) {
        return false;
    }
    if (year < 1970 || mon < 1 || mon > 12 || day < 1 || day > 31 ||
        hour < 0 || hour > 23 || min < 0 || min > 59 || sec < 0 || sec > 60) {
        return false;
    }
    static const int days_before_month[] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
    int y = year - 1970;
    int leap_days = (year - 1969) / 4 - (year - 1901) / 100 + (year - 1601) / 400;
    bool leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    int days = y * 365 + leap_days + days_before_month[mon - 1] + (day - 1);
    if (leap && mon > 2) {
        days++;
    }
    *out = (int64_t)days * 86400 + hour * 3600 + min * 60 + sec;
    return true;
}

// Reset countdown short format: resets_at - fetched_at, taking the largest readable unit (d / h / m), prefixed with the refresh glyph.
static void format_reset_label(const char *fetched_at,
                               const tokpet_usage_window_t *w,
                               char *out, size_t out_len)
{
    int64_t fetched = 0, reset = 0;
    if (w == NULL || !w->present || w->resets_at[0] == '\0' ||
        !parse_iso_utc_seconds(fetched_at, &fetched) ||
        !parse_iso_utc_seconds(w->resets_at, &reset)) {
        snprintf(out, out_len, LV_SYMBOL_REFRESH " --");
        return;
    }
    long diff = (long)(reset - fetched);
    if (diff < 0) {
        diff = 0;
    }
    if (diff >= 86400) {
        snprintf(out, out_len, LV_SYMBOL_REFRESH " %ldd", diff / 86400);
    } else if (diff >= 3600) {
        snprintf(out, out_len, LV_SYMBOL_REFRESH " %ldh", diff / 3600);
    } else {
        snprintf(out, out_len, LV_SYMBOL_REFRESH " %ldm", diff / 60);
    }
}

// A tile's child widgets are CLICKABLE+SCROLLABLE by default and swallow the tileview swipe, so both flags must be cleared (proven on the old board).
static void clear_swipe_block(lv_obj_t *obj)
{
    lv_obj_remove_flag(obj, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
}

static ui_tile_t *tile_by_provider(const char *id)
{
    if (id == NULL || id[0] == '\0') {
        return NULL;
    }
    for (int i = 0; i < TOKPET_PROVIDER_MAX_COUNT; i++) {
        if (s_tiles[i].used && strcmp(s_tiles[i].provider_id, id) == 0) {
            return &s_tiles[i];
        }
    }
    return NULL;
}

// ===== Cat sway (single-image rotation; no scaling -- rotation+scale together cause a "split in half", fixed for good on 2a hardware) =====

static void cat_rotate_cb(void *obj, int32_t v) { lv_image_set_rotation((lv_obj_t *)obj, v); }

static void start_cat_anim(lv_obj_t *cat)
{
    lv_image_set_pivot(cat, 64, 118);  // pivot at the feet (128px sprite, viewBox feet y92 -> ~118)
    lv_anim_t sway;
    lv_anim_init(&sway);
    lv_anim_set_var(&sway, cat);
    lv_anim_set_exec_cb(&sway, cat_rotate_cb);
    lv_anim_set_values(&sway, -45, 45);          // +/-4.5 deg (rotation unit is 0.1 deg)
    lv_anim_set_duration(&sway, 1700);
    lv_anim_set_playback_duration(&sway, 1700);  // 3.4s for a full round trip
    lv_anim_set_path_cb(&sway, lv_anim_path_ease_in_out);
    lv_anim_set_repeat_count(&sway, LV_ANIM_REPEAT_INFINITE);
    lv_anim_start(&sway);
}

static lv_obj_t *make_cat(lv_obj_t *parent)
{
    lv_obj_t *cat = lv_image_create(parent);
    lv_image_set_src(cat, &cat_chill);
    lv_image_set_antialias(cat, true);  // RGB565A8 premultiply + AA -> smooth rotated edges with no dark fringe
    start_cat_anim(cat);
    return cat;
}

// Ring: size=stroke center diameter, width=stroke width. rotation 270 starts at the top, range 0-100.
static lv_obj_t *make_ring(lv_obj_t *parent, int size, int width)
{
    lv_obj_t *arc = lv_arc_create(parent);
    lv_obj_set_size(arc, size, size);
    lv_obj_center(arc);
    lv_arc_set_rotation(arc, 270);
    lv_arc_set_bg_angles(arc, 0, 360);
    lv_arc_set_range(arc, 0, 100);
    lv_arc_set_value(arc, 0);
    clear_swipe_block(arc);  // arc is CLICKABLE+SCROLLABLE by default, swallows swipe
    lv_obj_remove_style(arc, NULL, LV_PART_KNOB);
    lv_obj_set_style_bg_opa(arc, LV_OPA_TRANSP, LV_PART_KNOB);
    lv_obj_set_style_pad_all(arc, 0, LV_PART_KNOB);
    lv_obj_set_style_arc_width(arc, width, LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc, width, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(arc, lv_color_hex(0x2A2A2A), LV_PART_MAIN);
    lv_obj_set_style_arc_color(arc, lv_color_hex(COLOR_DIM), LV_PART_INDICATOR);
    return arc;
}

// ===== Subscription tile (Claude/Codex halo cat, ported from 2a well) =====

static const lv_image_dsc_t *subscription_logo_for(const char *id)
{
    if (id != NULL && strcmp(id, "codex") == 0) {
        return &codex_logo;
    }
    return &claude_logo;
}

// well single reading column: small tag + large number(36) with a small %(16) baseline-aligned + refresh-glyph countdown(14).
static void make_reading_col(lv_obj_t *parent, const char *tag, lv_obj_t **out_tag,
                             lv_obj_t **out_val, lv_obj_t **out_reset)
{
    lv_obj_t *col = lv_obj_create(parent);
    lv_obj_remove_style_all(col);
    clear_swipe_block(col);
    lv_obj_set_size(col, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(col, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(col, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(col, 3, 0);

    *out_tag = lv_label_create(col);
    lv_label_set_text(*out_tag, tag);
    lv_obj_set_style_text_font(*out_tag, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(*out_tag, lv_color_hex(0x8B8B8B), 0);

    lv_obj_t *vrow = lv_obj_create(col);
    lv_obj_remove_style_all(vrow);
    clear_swipe_block(vrow);
    lv_obj_set_size(vrow, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(vrow, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(vrow, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
    lv_obj_set_style_pad_column(vrow, 1, 0);
    *out_val = lv_label_create(vrow);
    lv_label_set_text(*out_val, "--");
    lv_obj_set_style_text_font(*out_val, &lv_font_montserrat_36, 0);
    lv_obj_set_style_text_color(*out_val, lv_color_white(), 0);
    lv_obj_t *pct = lv_label_create(vrow);
    lv_label_set_text(pct, "%");
    lv_obj_set_style_text_font(pct, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(pct, lv_color_hex(0xBBBBBB), 0);

    *out_reset = lv_label_create(col);
    lv_label_set_text(*out_reset, LV_SYMBOL_REFRESH " --");
    lv_obj_set_style_text_font(*out_reset, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(*out_reset, lv_color_hex(0x7A7A82), 0);
}

static void build_subscription_tile(lv_obj_t *tile, ui_tile_t *t)
{
    t->arc_7d = make_ring(tile, 452, 18);  // outer ring 7d, close to the round-screen edge
    t->arc_5h = make_ring(tile, 392, 18);  // inner ring 5h

    // Cat (left) + Claude/Codex logo (right): attached directly to the tile, absolutely positioned (not in a flex container: the
    // container would clip the cat's rotation invalidation area and leave a ghost, lesson from 2a hardware). Position follows 2a (whole group centered, shifted up 29 to center cat/readings).
    t->cat = make_cat(tile);
    lv_obj_align(t->cat, LV_ALIGN_CENTER, -60, -29);
    lv_obj_t *logo = lv_image_create(tile);
    lv_image_set_src(logo, subscription_logo_for(t->provider_id));
    lv_image_set_antialias(logo, true);
    lv_obj_align(logo, LV_ALIGN_CENTER, 56, -29);

    // Two-reading row: 5H | vertical divider | 7D (equal weight), centered below
    lv_obj_t *readrow = lv_obj_create(tile);
    lv_obj_remove_style_all(readrow);
    clear_swipe_block(readrow);
    lv_obj_set_size(readrow, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(readrow, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(readrow, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(readrow, 18, 0);
    make_reading_col(readrow, "5H", &t->tag_5h, &t->val_5h, &t->reset_5h);
    lv_obj_t *divider = lv_obj_create(readrow);
    lv_obj_remove_style_all(divider);
    clear_swipe_block(divider);
    lv_obj_set_size(divider, 1, 46);
    lv_obj_set_style_bg_color(divider, lv_color_hex(0x2A2A30), 0);
    lv_obj_set_style_bg_opa(divider, LV_OPA_COVER, 0);
    make_reading_col(readrow, "7D", &t->tag_7d, &t->val_7d, &t->reset_7d);
    lv_obj_align(readrow, LV_ALIGN_CENTER, 0, 94);
}

static void apply_subscription_locked(ui_tile_t *t, const tokpet_state_t *state,
                                      const tokpet_provider_state_t *prov)
{
    const tokpet_usage_window_t *five  = (prov && prov->five_hour.present)  ? &prov->five_hour  : &state->five_hour;
    const tokpet_usage_window_t *seven = (prov && prov->seven_day.present)  ? &prov->seven_day  : &state->seven_day;
    int p5 = five->present ? five->used_pct : 0;
    int p7 = seven->present ? seven->used_pct : 0;
    lv_color_t c5 = mood_color(p5), c7 = mood_color(p7);

    lv_arc_set_value(t->arc_5h, p5);
    lv_arc_set_value(t->arc_7d, p7);
    lv_obj_set_style_arc_color(t->arc_5h, c5, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(t->arc_7d, c7, LV_PART_INDICATOR);
    lv_obj_set_style_text_color(t->tag_5h, c5, 0);
    lv_obj_set_style_text_color(t->tag_7d, c7, 0);
    lv_label_set_text_fmt(t->val_5h, "%d", p5);
    lv_label_set_text_fmt(t->val_7d, "%d", p7);

    char buf[24];
    format_reset_label(state->fetched_at, five, buf, sizeof(buf));
    lv_label_set_text(t->reset_5h, buf);
    format_reset_label(state->fetched_at, seven, buf, sizeof(buf));
    lv_label_set_text(t->reset_7d, buf);

    // Cat mood follows this tile's own stress (taking the more stressed window), matching the ring color.
    lv_image_set_src(t->cat, cat_for_mood(tokpet_mood_from_pct(p5 > p7 ? p5 : p7)));
}

// ===== Wallet tile (DeepSeek-style api-key, per product aesthetic: single health ring + CNY wallet hero number) =====

static const lv_image_dsc_t *wallet_logo_for(const char *id)
{
    if (strcmp(id, "deepseek") == 0) {
        return &deepseek_logo;
    }
    return NULL;  // unknown api-key provider: skip the logo for now (bake an image per id later)
}

static void build_wallet_tile(lv_obj_t *tile, ui_tile_t *t)
{
    // Single health ring (full-circle decoration): DeepSeek only reports remaining with no cap, so drawing a progress arc = faking a capacity;
    // a full ring value=100 + color-coded health is honest, and keeps the "halo" identity. Reuses the outer-ring geometry 452/18.
    t->ring = make_ring(tile, 452, 18);
    lv_arc_set_value(t->ring, 100);
    lv_obj_set_style_arc_color(t->ring, lv_color_hex(COLOR_BG), LV_PART_MAIN);  // track=background color, hides the gray seam edge
    lv_obj_set_style_arc_color(t->ring, lv_color_hex(COLOR_CHILL), LV_PART_INDICATOR);

    // Cat (left) + whale logo (right), same position as subscription -> family consistency.
    t->cat = make_cat(tile);
    lv_obj_align(t->cat, LV_ALIGN_CENTER, -60, -29);
    const lv_image_dsc_t *logo_src = wallet_logo_for(t->provider_id);
    if (logo_src != NULL) {
        lv_obj_t *logo = lv_image_create(tile);
        lv_image_set_src(logo, logo_src);
        lv_image_set_antialias(logo, true);
        lv_obj_align(logo, LV_ALIGN_CENTER, 56, -29);
    }

    // Wallet hero column (reusing the Claude reading column's three-part layout: tag / large number / subtext):
    // currency code(16) / integer(48)+decimal(16) baseline / status text(16).
    lv_obj_t *hero = lv_obj_create(tile);
    lv_obj_remove_style_all(hero);
    clear_swipe_block(hero);
    lv_obj_set_size(hero, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(hero, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(hero, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(hero, 4, 0);

    t->ccy_tag = lv_label_create(hero);
    lv_label_set_text(t->ccy_tag, "CNY");
    lv_obj_set_style_text_font(t->ccy_tag, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_letter_space(t->ccy_tag, 3, 0);
    lv_obj_set_style_text_color(t->ccy_tag, lv_color_hex(COLOR_CHILL), 0);

    lv_obj_t *amtrow = lv_obj_create(hero);  // integer + decimal baseline alignment
    lv_obj_remove_style_all(amtrow);
    clear_swipe_block(amtrow);
    lv_obj_set_size(amtrow, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(amtrow, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(amtrow, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
    lv_obj_set_style_pad_column(amtrow, 1, 0);
    t->amt_int = lv_label_create(amtrow);
    lv_label_set_text(t->amt_int, "--");
    lv_obj_set_style_text_font(t->amt_int, &lv_font_montserrat_48, 0);
    lv_obj_set_style_text_color(t->amt_int, lv_color_white(), 0);
    t->amt_dec = lv_label_create(amtrow);
    lv_label_set_text(t->amt_dec, ".--");
    lv_obj_set_style_text_font(t->amt_dec, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(t->amt_dec, lv_color_hex(0xBBBBBB), 0);

    t->state_line = lv_label_create(hero);
    lv_label_set_text(t->state_line, "");
    lv_obj_set_style_text_font(t->state_line, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(t->state_line, lv_color_hex(COLOR_CHILL), 0);

    lv_obj_align(hero, LV_ALIGN_CENTER, 0, 84);
}

static void apply_wallet_locked(ui_tile_t *t, const tokpet_provider_state_t *prov)
{
    bool present = prov->balance.present;
    double remaining = present ? prov->balance.remaining : 0.0;
    const char *ccy = (present && prov->balance.currency[0] != '\0') ? prov->balance.currency : "CNY";
    lv_color_t color = balance_color(remaining);

    lv_obj_set_style_arc_color(t->ring, color, LV_PART_INDICATOR);
    lv_label_set_text(t->ccy_tag, ccy);
    lv_obj_set_style_text_color(t->ccy_tag, color, 0);

    if (!present) {
        lv_label_set_text(t->amt_int, "--");
        lv_label_set_text(t->amt_dec, ".--");
    } else {
        int int_part = (int)remaining;
        int dec_raw = (int)((remaining - (double)int_part) * 100.0 + 0.5);
        if (dec_raw >= 100) {  // rounding carry
            int_part += 1;
            dec_raw = 0;
        }
        if (dec_raw < 0) {
            dec_raw = 0;
        }
        unsigned dec_part = (unsigned)dec_raw % 100u;  // narrow to [0,99] to feed the compiler, avoiding format-truncation
        char int_buf[16], dec_buf[8];
        snprintf(int_buf, sizeof(int_buf), "%d", int_part);
        snprintf(dec_buf, sizeof(dec_buf), ".%02u", dec_part);
        lv_label_set_text(t->amt_int, int_buf);
        lv_label_set_text(t->amt_dec, dec_buf);
    }

    const char *state_text;
    if (!present) {
        state_text = "No balance data";
    } else if (remaining <= WALLET_EMPTY_REMAINING) {
        state_text = "Wallet empty";
    } else if (remaining <= WALLET_LOW_REMAINING) {
        state_text = "Low balance";
    } else {
        state_text = "Wallet healthy";
    }
    lv_label_set_text(t->state_line, state_text);
    lv_obj_set_style_text_color(t->state_line, color, 0);

    lv_image_set_src(t->cat, cat_for_mood(balance_mood(remaining)));
}

// ===== Placeholder tile (startup before network / 0 providers) =====

static void build_placeholder_tile(lv_obj_t *tile, ui_tile_t *t)
{
    t->cat = make_cat(tile);
    lv_obj_align(t->cat, LV_ALIGN_CENTER, 0, -36);

    lv_obj_t *title = lv_label_create(tile);
    lv_label_set_text(title, "Tokpet");
    lv_obj_set_style_text_font(title, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_letter_space(title, 2, 0);
    lv_obj_set_style_text_color(title, lv_color_white(), 0);
    lv_obj_align(title, LV_ALIGN_CENTER, 0, 56);

    t->state_line = lv_label_create(tile);
    lv_obj_set_width(t->state_line, 300);
    lv_obj_set_style_text_align(t->state_line, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_font(t->state_line, &lv_font_montserrat_14, 0);
    lv_label_set_text(t->state_line, "Open the Tokpet console to add a provider");
    lv_obj_set_style_text_color(t->state_line, lv_color_hex(0x8B8B8B), 0);
    lv_obj_align(t->state_line, LV_ALIGN_CENTER, 0, 86);
}

// ===== Global chrome: status line + page indicator =====

static void build_status_overlay(lv_obj_t *scr)
{
    s_status_overlay = lv_obj_create(scr);
    lv_obj_remove_style_all(s_status_overlay);
    clear_swipe_block(s_status_overlay);
    lv_obj_set_size(s_status_overlay, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(s_status_overlay, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(s_status_overlay, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(s_status_overlay, 6, 0);

    s_status_dot = lv_obj_create(s_status_overlay);
    lv_obj_remove_style_all(s_status_dot);
    lv_obj_set_size(s_status_dot, 10, 10);
    lv_obj_set_style_radius(s_status_dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(s_status_dot, status_color(TOKPET_UI_STATUS_OFFLINE), 0);
    lv_obj_set_style_bg_opa(s_status_dot, LV_OPA_COVER, 0);

    s_status_label = lv_label_create(s_status_overlay);
    lv_label_set_text(s_status_label, s_net_label);
    lv_obj_set_style_text_font(s_status_label, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(s_status_label, lv_color_hex(0x8B8B8B), 0);

    lv_obj_align(s_status_overlay, LV_ALIGN_CENTER, 0, -117);  // top of the well (original 2a status line position)
}

static void build_page_box(lv_obj_t *scr)
{
    s_page_box = lv_obj_create(scr);
    lv_obj_remove_style_all(s_page_box);
    clear_swipe_block(s_page_box);
    lv_obj_set_size(s_page_box, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(s_page_box, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(s_page_box, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(s_page_box, 6, 0);
    lv_obj_align(s_page_box, LV_ALIGN_CENTER, 0, 152);  // bottom of the well
}

// Page indicator: one dot per tile, active white, the rest dim gray. A single dot at the bottom is redundant for one provider -> draw only when >=2.
static void refresh_page_indicator_locked(void)
{
    if (s_page_box == NULL) {
        return;
    }
    lv_obj_clean(s_page_box);
    for (int i = 0; i < TOKPET_PROVIDER_MAX_COUNT; i++) {
        s_page_dots[i] = NULL;
    }
    if (s_tile_count < 2) {
        return;
    }
    for (int i = 0; i < s_tile_count; i++) {
        s_page_dots[i] = lv_obj_create(s_page_box);
        lv_obj_remove_style_all(s_page_dots[i]);
        lv_obj_set_size(s_page_dots[i], 6, 6);
        lv_obj_set_style_radius(s_page_dots[i], LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_opa(s_page_dots[i], LV_OPA_COVER, 0);
        lv_obj_set_style_bg_color(s_page_dots[i],
            lv_color_hex(i == s_active_idx ? 0xFFFFFF : COLOR_DIM), 0);
    }
}

// After rebuilding the tileview, the new tv has the highest z-order and covers the overlay, so bring the overlay back to the top.
static void raise_overlays_locked(void)
{
    if (s_status_overlay != NULL) {
        lv_obj_move_foreground(s_status_overlay);
    }
    if (s_page_box != NULL) {
        lv_obj_move_foreground(s_page_box);
    }
}

static void set_tile_visible_locked(ui_tile_t *t, bool visible)
{
    if (t == NULL || !t->used || t->tile == NULL) {
        return;
    }
    if (visible) {
        lv_obj_remove_flag(t->tile, LV_OBJ_FLAG_HIDDEN);
        lv_obj_move_foreground(t->tile);
        if (t->cat != NULL) {
            start_cat_anim(t->cat);
        }
    } else {
        lv_obj_add_flag(t->tile, LV_OBJ_FLAG_HIDDEN);
        if (t->cat != NULL) {
            lv_anim_delete(t->cat, NULL);
            lv_image_set_rotation(t->cat, 0);
        }
    }
}

static void switch_active_tile_locked(int next_idx)
{
    if (next_idx < 0 || next_idx >= s_tile_count || next_idx == s_active_idx) {
        return;
    }
    for (int i = 0; i < s_tile_count; i++) {
        if (!s_tiles[i].used || s_tiles[i].tile == NULL) {
            continue;
        }
        set_tile_visible_locked(&s_tiles[i], i == next_idx);
    }
    s_active_idx = next_idx;
    for (int j = 0; j < s_tile_count; j++) {
        if (s_page_dots[j] != NULL) {
            lv_obj_set_style_bg_color(s_page_dots[j],
                lv_color_hex(next_idx == j ? 0xFFFFFF : COLOR_DIM), 0);
        }
    }
    refresh_active_tile_status_locked();  // top-left status follows the active tile
    raise_overlays_locked();
    ESP_LOGI(TAG, "tile -> %s", s_tiles[next_idx].provider_id);
}

static void stage_gesture_cb(lv_event_t *e)
{
    lv_indev_t *indev = lv_indev_active();
    if (indev == NULL || s_tile_count <= 1) {
        return;
    }
    lv_dir_t dir = lv_indev_get_gesture_dir(indev);
    if (dir == LV_DIR_LEFT && s_active_idx < s_tile_count - 1) {
        switch_active_tile_locked(s_active_idx + 1);
    } else if (dir == LV_DIR_RIGHT && s_active_idx > 0) {
        switch_active_tile_locked(s_active_idx - 1);
    }
}

// ===== signature / rebuild =====

static void compute_signature(const tokpet_state_t *state, char *out, size_t out_len)
{
    out[0] = '\0';
    int active = 0;
    for (int i = 0; i < state->provider_count && active < TOKPET_PROVIDER_MAX_COUNT; i++) {
        const tokpet_provider_state_t *p = &state->providers[i];
        if (!p->present || p->id[0] == '\0') {
            continue;
        }
        char chunk[64];
        snprintf(chunk, sizeof(chunk), "%s:%d;", p->id, (int)p->mode);
        strncat(out, chunk, out_len - strlen(out) - 1);
        active++;
    }
    if (active == 0) {
        strncpy(out, "@empty", out_len - 1);
        out[out_len - 1] = '\0';
    }
}

static void destroy_tiles_locked(void)
{
    for (int i = 0; i < TOKPET_PROVIDER_MAX_COUNT; i++) {
        if (!s_tiles[i].used) {
            continue;
        }
        // Kill the sway anim (bound to cat, not auto-stopped on obj delete) so it does not run on as a dangling reference after the obj is deleted.
        if (s_tiles[i].cat != NULL) {
            lv_anim_delete(s_tiles[i].cat, NULL);
        }
    }
    if (s_stage != NULL) {
        lv_obj_delete(s_stage);  // recursively destroys all tiles + children
        s_stage = NULL;
    }
    memset(s_tiles, 0, sizeof(s_tiles));
    s_tile_count = 0;
    s_active_idx = 0;
}

static lv_obj_t *create_stage_locked(lv_obj_t *scr)
{
    lv_obj_t *stage = lv_obj_create(scr);
    lv_obj_remove_style_all(stage);
    lv_obj_set_size(stage, LCD_H_RES, LCD_V_RES);
    lv_obj_set_pos(stage, 0, 0);
    lv_obj_set_style_bg_color(stage, lv_color_black(), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(stage, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_remove_flag(stage, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(stage, LV_OBJ_FLAG_GESTURE_BUBBLE);
    lv_obj_add_event_cb(stage, stage_gesture_cb, LV_EVENT_GESTURE, NULL);
    return stage;
}

static void init_tile_common(lv_obj_t *tile)
{
    lv_obj_remove_style_all(tile);
    lv_obj_set_size(tile, LCD_H_RES, LCD_V_RES);
    lv_obj_set_pos(tile, 0, 0);
    lv_obj_remove_flag(tile, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scrollbar_mode(tile, LV_SCROLLBAR_MODE_OFF);
    lv_obj_set_style_bg_color(tile, lv_color_black(), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(tile, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_pad_all(tile, 0, LV_PART_MAIN);
}

static void build_placeholder_root_locked(void)
{
    lv_obj_t *scr = lv_screen_active();
    s_stage = create_stage_locked(scr);
    lv_obj_t *tile = lv_obj_create(s_stage);
    init_tile_common(tile);
    s_tiles[0].used = true;
    strlcpy(s_tiles[0].provider_id, "@placeholder", sizeof(s_tiles[0].provider_id));
    s_tiles[0].kind = UI_TILE_KIND_PLACEHOLDER;
    s_tiles[0].tile = tile;
    build_placeholder_tile(tile, &s_tiles[0]);
    s_tile_count = 1;
    s_active_idx = 0;
    refresh_page_indicator_locked();
    raise_overlays_locked();
}

static void ui_build_tiles_from_state_locked(const tokpet_state_t *state)
{
    destroy_tiles_locked();
    lv_obj_t *scr = lv_screen_active();

    const tokpet_provider_state_t *actives[TOKPET_PROVIDER_MAX_COUNT];
    int active_count = 0;
    for (int i = 0; i < state->provider_count && active_count < TOKPET_PROVIDER_MAX_COUNT; i++) {
        const tokpet_provider_state_t *p = &state->providers[i];
        if (p->present && p->id[0] != '\0') {
            actives[active_count++] = p;
        }
    }
    if (active_count == 0) {
        build_placeholder_root_locked();
        return;
    }

    s_stage = create_stage_locked(scr);
    for (int i = 0; i < active_count; i++) {
        const tokpet_provider_state_t *p = actives[i];
        lv_obj_t *tile = lv_obj_create(s_stage);
        init_tile_common(tile);
        if (i != 0) {
            lv_obj_add_flag(tile, LV_OBJ_FLAG_HIDDEN);
        }
        s_tiles[i].used = true;
        strlcpy(s_tiles[i].provider_id, p->id, sizeof(s_tiles[i].provider_id));
        s_tiles[i].tile = tile;
        if (p->mode == TOKPET_PROVIDER_MODE_SUBSCRIPTION) {
            s_tiles[i].kind = UI_TILE_KIND_SUBSCRIPTION;
            build_subscription_tile(tile, &s_tiles[i]);
        } else if (p->mode == TOKPET_PROVIDER_MODE_API_KEY) {
            s_tiles[i].kind = UI_TILE_KIND_WALLET;
            build_wallet_tile(tile, &s_tiles[i]);
        } else {
            s_tiles[i].kind = UI_TILE_KIND_PLACEHOLDER;
            build_placeholder_tile(tile, &s_tiles[i]);
        }
        set_tile_visible_locked(&s_tiles[i], i == 0);
    }
    s_tile_count = active_count;
    s_active_idx = 0;
    refresh_page_indicator_locked();
    raise_overlays_locked();
    ESP_LOGI(TAG, "tiles rebuilt: %d", s_tile_count);
}

// ===== apply state =====

static void apply_state_locked(const tokpet_state_t *state)
{
    for (int i = 0; i < state->provider_count; i++) {
        const tokpet_provider_state_t *prov = &state->providers[i];
        if (!prov->present) {
            continue;
        }
        ui_tile_t *t = tile_by_provider(prov->id);
        if (t == NULL) {
            continue;
        }
        t->is_error_state = prov->is_error;
        if (prov->is_error) {
            continue;  // keep the widgets' old values; top-left status switched to Offline by refresh_active_tile_status_locked
        }
        if (t->kind == UI_TILE_KIND_SUBSCRIPTION) {
            apply_subscription_locked(t, state, prov);
        } else if (t->kind == UI_TILE_KIND_WALLET) {
            apply_wallet_locked(t, prov);
        }
    }
    refresh_active_tile_status_locked();
}

// ===== build root =====

static void ui_build_root(void)
{
    lv_obj_t *scr = lv_screen_active();
    lv_obj_remove_flag(scr, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(scr, 0, 0);

    build_placeholder_root_locked();   // start with the placeholder first
    build_status_overlay(scr);         // build the overlay once, later rebuilds only swap the tileview
    build_page_box(scr);
    strlcpy(s_tile_signature, "@empty", sizeof(s_tile_signature));

    // Invalidate the whole screen on the first frame to clear GRAM residue after the CO5300 soft reset (section 4.7: full-screen invalidate only on first frame + state switches).
    lv_obj_invalidate(scr);
}

void ui_init(esp_lcd_panel_handle_t panel, esp_lcd_panel_io_handle_t io, esp_lcd_touch_handle_t tp)
{
    const lvgl_port_cfg_t port_cfg = ESP_LVGL_PORT_INIT_CONFIG();
    ESP_ERROR_CHECK(lvgl_port_init(&port_cfg));

    const lvgl_port_display_cfg_t disp_cfg = {
        .io_handle = io,
        .panel_handle = panel,
        // The QSPI panel's internal DMA is banded as 64 lines x2 (the largest contiguous DMA-capable internal block is only 136KB; 100/80 lines hit a buf2
        // OOM -> black screen, 64 settled on 2a hardware). A full-screen PSRAM buffer is unusable (SPI master priv TX bounce allocation fails).
        .buffer_size = LCD_H_RES * 64,
        .double_buffer = true,
        .hres = LCD_H_RES,
        .vres = LCD_V_RES,
        .monochrome = false,
        .color_format = LV_COLOR_FORMAT_RGB565,
        .flags = {
            .buff_dma = true,
            .buff_spiram = false,
            .swap_bytes = true,  // LVGL RGB565 byte order is the reverse of CO5300
        },
    };
    lv_display_t *disp = lvgl_port_add_disp(&disp_cfg);
    if (disp == NULL) {
        ESP_LOGE(TAG, "lvgl_port_add_disp failed");
        return;
    }

    if (tp != NULL) {
        const lvgl_port_touch_cfg_t touch_cfg = {.disp = disp, .handle = tp};
        if (lvgl_port_add_touch(&touch_cfg) == NULL) {
            ESP_LOGE(TAG, "lvgl_port_add_touch failed");
        }
    }

    if (lvgl_port_lock(0)) {
        ui_build_root();
        s_ready = true;
        if (s_has_cached_state) {  // /state arrived before ui_init (shouldn't happen in theory, kept for symmetry)
            char sig[160];
            compute_signature(&s_cached_state, sig, sizeof(sig));
            if (strcmp(sig, s_tile_signature) != 0) {
                ui_build_tiles_from_state_locked(&s_cached_state);
                strlcpy(s_tile_signature, sig, sizeof(s_tile_signature));
            }
            apply_state_locked(&s_cached_state);
        }
        lvgl_port_unlock();
    }
    ESP_LOGI(TAG, "ui init done: gesture stage (awaiting providers)");
}

void ui_update_state(const tokpet_state_t *state)
{
    if (state == NULL) {
        return;
    }
    s_cached_state = *state;
    s_has_cached_state = true;
    if (!s_ready) {
        return;
    }
    if (!lvgl_port_lock(0)) {
        return;
    }
    char sig[160];
    compute_signature(state, sig, sizeof(sig));
    if (strcmp(sig, s_tile_signature) != 0) {
        ui_build_tiles_from_state_locked(state);  // rebuild only when topology changes, preserving swipe position + sway
        strlcpy(s_tile_signature, sig, sizeof(s_tile_signature));
    }
    apply_state_locked(state);
    lvgl_port_unlock();
}

// Combine network-layer status + the active tile's provider error to decide the top-left status. active error -> red Offline override.
static void refresh_active_tile_status_locked(void)
{
    if (s_status_dot == NULL || s_status_label == NULL) {
        return;
    }
    bool active_error = false;
    if (s_active_idx >= 0 && s_active_idx < TOKPET_PROVIDER_MAX_COUNT) {
        const ui_tile_t *t = &s_tiles[s_active_idx];
        if (t->used && t->is_error_state) {
            active_error = true;
        }
    }
    lv_color_t color;
    const char *text;
    if (active_error) {
        color = lv_color_hex(COLOR_STRESS);
        text = "Offline";
    } else {
        color = status_color(s_net_level);
        text = s_net_label;
    }
    lv_obj_set_style_bg_color(s_status_dot, color, 0);
    lv_obj_set_style_text_color(s_status_label, color, 0);
    lv_label_set_text(s_status_label, text);
    lv_obj_update_layout(s_status_overlay);
    lv_obj_align(s_status_overlay, LV_ALIGN_CENTER, 0, -117);
    lv_obj_invalidate(s_status_overlay);
}

void ui_set_connection_status(tokpet_ui_status_level_t level, const char *label)
{
    if (!s_ready) {
        return;
    }
    const char *src = (label != NULL && label[0] != '\0') ? label : status_text(level);
    if (s_net_level == level && strcmp(s_net_label, src) == 0) {
        return;
    }
    if (!lvgl_port_lock(0)) {
        return;
    }
    s_net_level = level;
    strlcpy(s_net_label, src, sizeof(s_net_label));
    refresh_active_tile_status_locked();
    lvgl_port_unlock();
}
