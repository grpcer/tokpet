cmake_minimum_required(VERSION 3.16)

# StopWatch board (new open-source reference board): ESP32-S3R8 + CO5300 466x466 round AMOLED
# Board-specific BSP lives in components/bsp/; board-agnostic components (tokpet_state/config/client/provisioning,
# dns_server) live in ../../shared. The shared tokpet_client/provisioning REQUIRES the board-specific ui,
# provided by stopwatch's own components/ui (which implements ui_update_state / ui_set_connection_status).
set(EXTRA_COMPONENT_DIRS "components/bsp" "../../shared")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(tokpet_stopwatch)
