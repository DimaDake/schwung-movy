# The virtual device (plan WP12): a Move's filesystem and process surface on
# glibc 2.35 / aarch64, the device's own, so movy-host (the vdev build) and
# every module's dsp.so run natively. Built by scripts/vdev.sh image.
FROM ubuntu:22.04
RUN apt-get update -qq \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      openssh-server procps psmisc file python3 \
 && rm -rf /var/lib/apt/lists/*
# The device's ableton: uid 1000, group users (100), plus ablspi.
RUN groupadd -g 1000 ablspi && useradd -u 1000 -g users -G ablspi -m -s /bin/sh ableton \
 && mkdir -p /run/sshd /opt/move \
 && printf 'PermitRootLogin prohibit-password\nPasswordAuthentication no\nUseDNS no\nMaxSessions 64\nMaxStartups 64\n' \
      > /etc/ssh/sshd_config.d/vdev.conf
# The device's /data, as scripts/vdev.sh snapshot read it (ownership kept).
ADD snapshot.tar /data/
# Stand-ins for the stock stack: the harness looks for these by NAME (pidof)
# and launch-standalone.sh kills them by name, so copies of sleep are enough.
RUN cp /bin/sleep /opt/move/MoveOriginal && cp /bin/sleep /usr/local/bin/shadow_ui
# The snapshot's schwung-heal is setuid root, and it "heals" /opt/move/Move
# back to schwung's real boot entrypoint, which then cannot boot anything
# here: launch-standalone.sh's Move restart never came back. A stub that
# heals nothing, and not setuid, so every caller takes its no-helper path.
RUN printf '#!/bin/sh\nexit 1\n' > /data/UserData/schwung/bin/schwung-heal \
 && chmod 755 /data/UserData/schwung/bin/schwung-heal
COPY move.sh /opt/move/Move
COPY init-move.sh /etc/init.d/move
COPY entrypoint.sh /vdev-entrypoint
RUN chmod 755 /opt/move/Move /etc/init.d/move /vdev-entrypoint
ENTRYPOINT ["/vdev-entrypoint"]
