# Tokpet Firmware

Firmware for the **Tokpet device** — a round-screen ESP32-S3 desk pet that turns
the [companion service](../README.md)'s `GET /state` feed into a live, glanceable
display. Concentric rings show your AI usage windows; a cat in the middle shifts
from calm to panicked as you burn through your quota.

This is a standard [ESP-IDF](https://docs.espressif.com/projects/esp-idf/)
project. If you have the toolchain installed, flashing it is one command.

> The companion (the npm `tokpet` service) does the talking to AI providers and
> serves `/state`. The device is a thin, self-contained client: it joins your
> Wi-Fi, finds the companion over mDNS, polls `/state`, and renders it. It never
> talks to a provider directly and needs no internet of its own once it can
> reach the companion on your LAN.

## Reference hardware

The reference board is the **M5Stack StopWatch** — a compact ESP32-S3 module with
a round AMOLED. The firmware is split so the board-specific parts are isolated
(see [Architecture](#architecture)); porting to a similar ESP32-S3 + CO5300 board
means swapping the BSP, not the app.

| Part            | Component                                                          |
| --------------- | ----------------------------------------------------------------- |
| **MCU**         | ESP32-S3 (R8 — 8 MB Octal PSRAM, 16 MB flash)                      |
| **Display**     | CO5300 **466 × 466 round AMOLED**, QSPI, driven by LVGL 9          |
| **Touch**       | CST820 capacitive (CST816 family), I2C                            |
| **Buttons**     | Two tactile keys — `A` (GPIO2) and `B` (GPIO1), active-low         |
| **Power / IO**  | I2C IO-expander (M5IOE1) gating the AMOLED rail (`L3B_EN`) and the display / touch reset lines |
| **Console**     | Native USB-Serial-JTAG (no external UART bridge — flash over USB)  |

## What it shows

The on-screen UI is the **halo cat**:

- **Concentric rings** — the outer ring is the 7-day window, the inner ring the
  5-hour window. Each ring's color encodes pressure: green (`chill`) → amber
  (`alert`) → red (`stress`). The more-pressured window gets a soft glow.
- **The cat** — three moods (chill / uneasy / panic) track the primary window, so
  a glance reads as a feeling, not a number. It sways and "breathes" gently.
- **Readouts** — each window shows its used-percentage and a reset countdown.
- **Provider tiles** — with more than one provider activated, swipe between tiles;
  prepaid wallets (e.g. DeepSeek) render a balance instead of rolling windows.
- **Connection dot** — top-of-screen status: offline, linking, online, setup, or
  error.

## Architecture

The firmware is deliberately layered so board-specific code never leaks into the
networking/UI logic:

```
firmware/
├── apps/
│   └── stopwatch/                 # The StopWatch board application (ESP-IDF project root)
│       ├── main/                  # app_main: brings up BSP, then the network stack
│       ├── components/
│       │   ├── bsp/               # Board support — swap these to port to new hardware
│       │   │   ├── iic/           #   shared I2C master bus
│       │   │   ├── power/         #   IO-expander: AMOLED power rail + resets
│       │   │   ├── lcd_co5300/    #   CO5300 QSPI panel bring-up
│       │   │   └── touch_cst820/  #   CST820 touch
│       │   ├── buttons/           # GPIO buttons (short / long press)
│       │   └── ui/                # LVGL "halo cat" UI (implements ui_update_state, etc.)
│       ├── partitions.csv
│       ├── sdkconfig.defaults
│       └── dependencies.lock      # Pinned managed components
├── shared/                        # Board-agnostic components (reusable across boards)
│   ├── tokpet_state/              #   parse the companion's /state JSON
│   ├── tokpet_config/             #   NVS-backed Wi-Fi + provider config
│   ├── tokpet_client/             #   Wi-Fi STA + mDNS discovery + /state polling
│   ├── tokpet_provisioning/       #   SoftAP captive-portal Wi-Fi setup
│   └── dns_server/                #   captive-portal DNS responder
└── provisioning-web/
    └── index.html                 # Captive-portal page, embedded into the firmware
```

The app's `CMakeLists.txt` pulls in `components/bsp` and `../../shared` via
`EXTRA_COMPONENT_DIRS`. The shared `tokpet_client` and `tokpet_provisioning`
components depend on a board-provided `ui` component that implements
`ui_update_state()` and `ui_set_connection_status()` — that's the seam a new
board fills in.

## How it connects

**Boot** (`main/main.c`): bring up the BSP in order — I2C → power (rails + resets)
→ LCD → touch → UI → buttons — then start the network stack.

- **If Wi-Fi credentials are stored** (in NVS), `tokpet_client` joins the network,
  discovers the companion via mDNS (`_tokpet._tcp`, default port `4717`), and
  polls `GET /state` every `CONFIG_TOKPET_STATE_REFRESH_MS` milliseconds
  (5 s by default), feeding each snapshot to the UI.
- **If there are no credentials**, `tokpet_provisioning` starts a SoftAP and a
  captive portal. Connect a phone to the device's setup hotspot, pick your
  Wi-Fi, and enter the password (the portal opens automatically; if not, browse
  to `http://192.168.4.1`). Credentials are saved to NVS and the device reboots
  into the client path.

**Re-provisioning:** long-press button `A` (~1 s) to clear the saved Wi-Fi and
reboot back into setup — handy when moving the device to a new network. See the
companion's [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) for the full flow.

## Build & flash

### Prerequisites

- **ESP-IDF 5.5.x** (pinned: 5.5.4) for the **esp32s3** target —
  [install guide](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/get-started/).
- Activate it in your shell: `. $IDF_PATH/export.sh`.

Managed components (the CO5300 panel driver, the CST816/CST820 touch driver,
`esp_lvgl_port` with LVGL 9.5, and `mdns`) are listed in each component's
`idf_component.yml` and pinned in `dependencies.lock`. The IDF component manager
downloads them into a (git-ignored) `managed_components/` on the first build — no
manual vendoring needed.

### Commands

From the repository root, point `idf.py` at the app with `-C`:

```bash
idf.py -C firmware/apps/stopwatch set-target esp32s3
idf.py -C firmware/apps/stopwatch build

# Flash + open the serial monitor (find the port with: ls /dev/cu.* on macOS).
# The board exposes a native USB-Serial-JTAG port, so flashing is plain USB.
idf.py -C firmware/apps/stopwatch -p /dev/cu.usbmodemXXXX flash monitor
```

(Equivalently, `cd firmware/apps/stopwatch` first and drop the `-C` flag.)
Exit the monitor with `Ctrl-]`.

## Configuration

Defaults live in [`apps/stopwatch/sdkconfig.defaults`](apps/stopwatch/sdkconfig.defaults);
the notable knobs:

- `CONFIG_TOKPET_STATE_REFRESH_MS` — `/state` poll interval (default `5000`).
- 8 MB Octal PSRAM and 16 MB flash enabled for the AMOLED framebuffers.
- Native USB-Serial-JTAG console (no UART bridge).
- A custom [`partitions.csv`](apps/stopwatch/partitions.csv) sized for the 16 MB
  flash.

The generated `sdkconfig` and `managed_components/` are build artifacts and are
git-ignored; only `sdkconfig.defaults` and `dependencies.lock` are tracked.

## Status

Bring-up of the StopWatch board is working end-to-end: CO5300 panel, CST820 touch,
buttons, the halo-cat LVGL UI, on-device SoftAP provisioning, mDNS discovery, and
`/state` polling. The board-agnostic `shared/` components are intended to be
reused for future boards.

## License

[Apache-2.0](../LICENSE), same as the rest of Tokpet.
