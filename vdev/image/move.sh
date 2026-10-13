#!/bin/sh
# /opt/move/Move on the virtual device: the stock stack's two processes the
# harness and launch-standalone.sh know by name, and nothing else. There is
# no SPI to hold, so "Move is up" costs nothing and frees nothing.
/usr/local/bin/shadow_ui infinity &
exec /opt/move/MoveOriginal infinity
