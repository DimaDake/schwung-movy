/* A virtual device (plan WP12, scripts/vdev.sh) is a container on this Mac.
 * Its "host" is `vdev<N>`: a name ssh resolves through the vdev ssh config
 * (vdev/bin/ssh puts it first on PATH), and that Node resolves here, to the
 * container's published bus port. Every other host is a real box. */
export const VDEV_BUS_BASE = 48777;

export const isVdev = (host: string): boolean => /^vdev\d+$/.test(host);

export function busEndpoint(host: string): { host: string; port: number } {
    return isVdev(host) ? { host: '127.0.0.1', port: VDEV_BUS_BASE + Number(host.slice(4)) } : { host, port: 47777 };
}
