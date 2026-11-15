import { prisma } from '../database/connection.js';

export const getDeviceStatus = () => ({
    deviceId: process.env.DEVICE_ID || process.env.HARDWARE_DEVICE_ID || 'esp32-01',
    source: 'hardware',
});

export const getDeviceRegistry = async (deviceIds) => {
    if (deviceIds && deviceIds.length === 0) return [];
    const devices = await prisma.device.findMany({
        where: { AND: [
            { sourceMode: 'hardware' },
            ...(deviceIds ? [{ deviceId: { in: deviceIds } }] : []),
        ] },
        orderBy: { lastSeen: 'desc' },
        take: 100,
    });
    const heartbeatIntervalMs = Number(process.env.DEVICE_HEARTBEAT_INTERVAL_MS ?? 120000);
    const staleAfterMs = Math.max(1000, heartbeatIntervalMs) * 3;
    const now = Date.now();

    return devices.map((device) => ({
        ...device,
        online: device.online &&
            device.lastSeen !== null &&
            now - device.lastSeen.getTime() <= staleAfterMs,
    }));
};
