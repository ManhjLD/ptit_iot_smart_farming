import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../database/connection.js';
import { requireAuth } from '../middleware/auth.js';
import { publishMessage } from '../services/mqtt.service.js';

export const commandRouter = new Hono();
const CommandSchema = z.object({
    state: z.enum(['on', 'off']),
    reason: z.string().trim().min(3).max(200),
});
const EXPIRY_MS = 15_000;
const MAX_SENSOR_AGE_MS = 10 * 60 * 1000;
const COMMAND_TOPIC = process.env.MQTT_COMMAND_TOPIC || 'sf/devices/relay/command';

export function pumpStartBlockReason(reading, now = Date.now()) {
    if (!reading?.createdAt || now - reading.createdAt.getTime() > MAX_SENSOR_AGE_MS) {
        return 'Recent sensor readings are required before turning the pump on';
    }
    if (reading.rainDetected) return 'Pump start blocked because rain is detected';
    if (reading.waterLevel.toLowerCase() === 'low') {
        return 'Pump start blocked because reservoir water is low';
    }
    return null;
}

export function createRelayCommandPayload({ commandId, deviceId, desiredState, reason, issuedAt, expiresAt }) {
    return {
        command_id: commandId,
        device_id: deviceId,
        command: 'set_relay',
        state: desiredState ? 'on' : 'off',
        relayStatus: desiredState,
        reason,
        issued_at: issuedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        expires_at_epoch: Math.floor(expiresAt.getTime() / 1000),
    };
}

commandRouter.use('*', requireAuth);

commandRouter.post('/devices/:deviceId/commands', async (c) => {
    const user = c.get('authUser');
    if (!['ADMIN', 'OPERATOR'].includes(user.role)) {
        return c.json({ success: false, message: 'Operator role is required to control a device' }, 403);
    }

    const parsed = CommandSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json({ success: false, message: 'Invalid command', issues: parsed.error.flatten() }, 400);
    }

    const deviceId = c.req.param('deviceId');
    if (user.role !== 'ADMIN' && !user.deviceIds.includes(deviceId)) {
        return c.json({ success: false, message: 'Device is not assigned to this account' }, 403);
    }
    const idempotencyKey = c.req.header('idempotency-key');
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return c.json({ success: false, message: 'A valid Idempotency-Key header is required' }, 400);
    }

    const existing = await prisma.deviceCommand.findUnique({
        where: {
            requestedByUserId_idempotencyKey: {
                requestedByUserId: user.id,
                idempotencyKey,
            },
        },
    });
    if (existing) {
        if (existing.deviceId !== deviceId || existing.desiredState !== (parsed.data.state === 'on')) {
            return c.json({ success: false, message: 'Idempotency key was already used for a different command' }, 409);
        }
        return c.json({ success: true, command: existing }, 200);
    }

    const device = await prisma.device.findUnique({ where: { deviceId } });
    if (!device || device.lifecycle !== 'ACTIVE') {
        return c.json({ success: false, message: 'Device is not active' }, 409);
    }
    const heartbeatIntervalMs = Number(process.env.DEVICE_HEARTBEAT_INTERVAL_MS ?? 120000);
    if (!device.online || !device.lastSeen ||
        Date.now() - device.lastSeen.getTime() > Math.max(1000, heartbeatIntervalMs) * 3) {
        return c.json({ success: false, message: 'Device is offline; command was not sent' }, 409);
    }

    const desiredState = parsed.data.state === 'on';
    const latest = await prisma.sensorData.findFirst({
        where: { deviceId, sourceMode: 'hardware' },
        orderBy: { createdAt: 'desc' },
    });
    if (desiredState) {
        const blockReason = pumpStartBlockReason(latest);
        if (blockReason) {
            return c.json({ success: false, message: blockReason }, 409);
        }
    }

    const expiresAt = new Date(Date.now() + EXPIRY_MS);
    let command;
    try {
        command = await prisma.deviceCommand.create({
            data: {
                deviceId,
                requestedByUserId: user.id,
                idempotencyKey,
                desiredState,
                expiresAt,
            },
        });
    } catch (error) {
        if (error?.code === 'P2002') {
            const duplicate = await prisma.deviceCommand.findUnique({
                where: {
                    requestedByUserId_idempotencyKey: {
                        requestedByUserId: user.id,
                        idempotencyKey,
                    },
                },
            });
            if (duplicate) {
                if (duplicate.deviceId !== deviceId || duplicate.desiredState !== desiredState) {
                    return c.json({ success: false, message: 'Idempotency key was already used for a different command' }, 409);
                }
                return c.json({ success: true, command: duplicate }, 200);
            }
        }
        throw error;
    }

    const issuedAt = new Date();
    try {
        await publishMessage(COMMAND_TOPIC, createRelayCommandPayload({
            commandId: command.id,
            deviceId,
            desiredState,
            reason: parsed.data.reason,
            issuedAt,
            expiresAt,
        }), 1, false);
        await prisma.deviceCommand.updateMany({
            where: { id: command.id, status: 'PENDING' },
            data: { status: 'SENT', sentAt: issuedAt },
        });
        command = await prisma.deviceCommand.findUnique({ where: { id: command.id } });
        await prisma.auditEvent.create({
            data: {
                actorUserId: user.id,
                action: 'RELAY_COMMAND_SENT',
                targetType: 'device_command',
                targetId: command.id,
                reason: parsed.data.reason,
                outcome: 'sent',
                details: { deviceId, state: parsed.data.state },
            },
        });
    } catch (error) {
        await prisma.deviceCommand.updateMany({
            where: { id: command.id, status: { in: ['PENDING', 'SENT'] } },
            data: { status: 'REJECTED', resultReason: 'MQTT publish failed' },
        });
        command = await prisma.deviceCommand.findUnique({ where: { id: command.id } });
        console.error('[commands] MQTT publish failed:', error);
        return c.json({ success: false, message: 'Command could not be published', command }, 503);
    }

    return c.json({ success: true, command }, 202);
});

commandRouter.get('/:commandId', async (c) => {
    const user = c.get('authUser');
    const command = await prisma.deviceCommand.findUnique({
        where: { id: c.req.param('commandId') },
    });
    if (!command || (user.role !== 'ADMIN' &&
        (command.requestedByUserId !== user.id && !user.deviceIds.includes(command.deviceId)))) {
        return c.json({ success: false, message: 'Command not found' }, 404);
    }

    if (['PENDING', 'SENT', 'ACKNOWLEDGED'].includes(command.status) &&
        command.expiresAt <= new Date()) {
        const timedOut = await prisma.deviceCommand.updateMany({
            where: {
                id: command.id,
                status: { in: ['PENDING', 'SENT', 'ACKNOWLEDGED'] },
            },
            data: {
                status: 'TIMED_OUT',
                resultReason: 'Device acknowledgement timed out',
            },
        });
        if (timedOut.count) {
            command.status = 'TIMED_OUT';
            command.resultReason = 'Device acknowledgement timed out';
        }
    }
    return c.json({ success: true, command });
});
