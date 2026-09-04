#!/usr/bin/env bash
# Every device suite with tracks 1-4 on SCHWUNG's four shadow slots — the stock
# arrangement, and what `chtracks` = SCHWUNG selects.
#
# The other half of the matrix is scripts/test-all-device-movy.sh. Both are thin
# over test-all-device.sh, which reads TS_HOST_MODE; the fixture pins the host in
# prefs.json so the run does not depend on which Move set happens to be active.
set -uo pipefail
exec env TS_HOST_MODE=schwung "$(dirname "$0")/test-all-device.sh" "$@"
