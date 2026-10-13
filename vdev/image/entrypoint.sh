#!/bin/sh
# Boot of the virtual device: sshd (the harness's only way in, as on the
# box), then the stand-in Move as the stack's uid. The keys are the harness's
# own (.vdev/id_ed25519), mounted read-only by scripts/vdev.sh up.
set -e
for h in /root /home/ableton; do
    mkdir -p "$h/.ssh"
    cp /vdev-key.pub "$h/.ssh/authorized_keys"
done
chown -R ableton:users /home/ableton/.ssh
chmod 700 /root/.ssh /home/ableton/.ssh
ssh-keygen -A >/dev/null
echo "${VDEV_STACK_USER:-ableton}" > /run/vdev-stack
# On the box this is residue of Move's shim, which made it before movy-host
# took over; the dev inject tools ring its doorbell (scripts/inject-any.py)
# and die without it. Nothing reads it under movy-host.
head -c 72 /dev/zero > /dev/shm/schwung-control
chown ableton:users /dev/shm/schwung-control
chmod 666 /dev/shm/schwung-control
/etc/init.d/move start
exec /usr/sbin/sshd -D -e
