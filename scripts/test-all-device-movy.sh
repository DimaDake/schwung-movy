#!/usr/bin/env bash
# Every device suite with tracks 1-4 on MOVY's own chains 0-3 — what `chtracks`
# = MOVY selects, and the arrangement that joins those tracks to the parallel
# render.
#
# The other half of the matrix is scripts/test-all-device-schwung.sh. Both are
# thin over test-all-device.sh, which reads TS_HOST_MODE; the fixture pins the
# host in prefs.json so the run does not depend on which Move set happens to be
# active.
set -uo pipefail
exec env TS_HOST_MODE=movy "$(dirname "$0")/test-all-device.sh" "$@"
