#!/bin/sh
# /etc/init.d/move on the virtual device: start/stop the stand-in stack, as
# the stack's uid (the entrypoint's VDEV_STACK_USER, kept in /run/vdev-stack).
U=$(cat /run/vdev-stack 2>/dev/null || echo ableton)
case "$1" in
    start) su "$U" -s /bin/sh -c 'nohup /opt/move/Move >/dev/null 2>&1 &' ;;
    stop)  pkill -x MoveOriginal; pkill -x shadow_ui; true ;;
    restart) "$0" stop; sleep 0.2; "$0" start ;;
    *) echo "usage: $0 start|stop|restart" >&2; exit 2 ;;
esac
