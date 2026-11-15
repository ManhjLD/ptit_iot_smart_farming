import { prisma } from '../database/connection.js';
import { evaluateSensorAlertConditions, SENSOR_ALERT_RULES } from './alert.policy.js';

const ACTIVE_STATUSES = ['OPEN', 'ACKNOWLEDGED'];

export async function raiseAlert({ deviceId, ruleCode, severity, message }) {
    const active = await prisma.alert.findFirst({
        where: { deviceId, ruleCode, status: { in: ACTIVE_STATUSES } },
    });
    if (active) {
        return prisma.alert.update({
            where: { id: active.id },
            data: {
                lastSeen: new Date(),
                occurrenceCount: { increment: 1 },
                severity,
                message,
            },
        });
    }

    try {
        return await prisma.alert.create({
            data: { deviceId, ruleCode, severity, message },
        });
    } catch (error) {
        if (error?.code !== 'P2002') throw error;
        const concurrent = await prisma.alert.findFirst({
            where: { deviceId, ruleCode, status: { in: ACTIVE_STATUSES } },
        });
        if (!concurrent) throw error;
        return prisma.alert.update({
            where: { id: concurrent.id },
            data: {
                lastSeen: new Date(),
                occurrenceCount: { increment: 1 },
                severity,
                message,
            },
        });
    }
}

export async function resolveActiveAlert(deviceId, ruleCode) {
    return prisma.alert.updateMany({
        where: { deviceId, ruleCode, status: { in: ACTIVE_STATUSES } },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
}

export async function canResolveAlert(alert) {
    if (alert.ruleCode === 'DEVICE_OFFLINE') {
        const device = await prisma.device.findUnique({ where: { deviceId: alert.deviceId } });
        return device?.online === true;
    }
    if (!SENSOR_ALERT_RULES.includes(alert.ruleCode)) return false;

    const heartbeatIntervalMs = Number(process.env.DEVICE_HEARTBEAT_INTERVAL_MS ?? 120000);
    const freshAfterMs = Math.max(1000, heartbeatIntervalMs) * 3;
    const latest = await prisma.sensorData.findFirst({
        where: {
            deviceId: alert.deviceId,
            sourceMode: 'hardware',
            createdAt: { not: null, gte: new Date(Date.now() - freshAfterMs) },
        },
        orderBy: { createdAt: 'desc' },
    });
    if (!latest) return false;
    const threshold = Number(process.env.SOIL_DRY_ALERT_THRESHOLD_PERCENT ?? 30);
    const conditions = evaluateSensorAlertConditions(latest, threshold);
    return conditions[alert.ruleCode] === false;
}

export function activeAlertStatuses() {
    return ACTIVE_STATUSES;
}
