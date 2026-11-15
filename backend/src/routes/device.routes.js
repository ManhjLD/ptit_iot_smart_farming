import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../database/connection.js';
import { getDeviceRegistry, getDeviceStatus } from '../services/device.service.js';
import { accessibleDeviceIds, requireAuth, requireRole } from '../middleware/auth.js';
import { IrrigationRuleSchema } from '../schemas/irrigationRule.schema.js';
import { publishMessage } from '../services/mqtt.service.js';
export const deviceRouter = new Hono();

const CreateDeviceSchema = z.object({
    deviceId: z.string().trim().min(1).max(100)
        .regex(/^[A-Za-z0-9._-]+$/),
    deviceType: z.string().trim().min(1).max(100),
    zone: z.string().trim().max(100).optional(),
    assignedUserIds: z.array(z.string().uuid()).max(100).optional(),
});
const LifecycleSchema = z.object({
    lifecycle: z.enum(['PROVISIONED', 'ACTIVE', 'FAULT', 'MAINTENANCE', 'REVOKED', 'DECOMMISSIONED']),
    reason: z.string().trim().min(3).max(500),
});
const transitions = {
    REGISTERED: ['PROVISIONED', 'REVOKED'],
    PROVISIONED: ['ACTIVE', 'REVOKED'],
    ACTIVE: ['FAULT', 'MAINTENANCE', 'REVOKED'],
    FAULT: ['ACTIVE', 'MAINTENANCE', 'REVOKED'],
    MAINTENANCE: ['ACTIVE', 'REVOKED'],
    REVOKED: ['DECOMMISSIONED'],
    DECOMMISSIONED: [],
};

deviceRouter.get('/status', async (c) => {
    return c.json({
        success: true,
        ...getDeviceStatus(),
        timestamp: new Date().toISOString(),
    });
});
deviceRouter.get('/devices', requireAuth, async (c) => {
    try {
        const devices = await getDeviceRegistry(accessibleDeviceIds(c.get('authUser')));
        return c.json({ success: true, devices });
    }
    catch (error) {
        console.error('[devices] Failed to load registry:', error);
        return c.json({ success: false, message: 'Failed to load device registry' }, 500);
    }
});

deviceRouter.get('/audit', requireAuth, requireRole('ADMIN'), async (c) => {
    const events = await prisma.auditEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
    });
    return c.json({ success: true, events });
});

deviceRouter.post('/devices', requireAuth, requireRole('ADMIN'), async (c) => {
    const parsed = CreateDeviceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json({ success: false, message: 'Invalid device data', issues: parsed.error.flatten() }, 400);
    }

    const { assignedUserIds = [], ...deviceData } = parsed.data;
    try {
        const device = await prisma.$transaction(async (transaction) => {
            const created = await transaction.device.create({
                data: {
                    ...deviceData,
                    sourceMode: 'hardware',
                    lifecycle: 'REGISTERED',
                    irrigationRule: { create: {} },
                    assignments: {
                        create: [...new Set(assignedUserIds)].map((userId) => ({
                            user: { connect: { id: userId } },
                        })),
                    },
                },
                include: { assignments: { select: { userId: true } } },
            });
            await transaction.auditEvent.create({
                data: {
                    actorUserId: c.get('authUser').id,
                    action: 'DEVICE_REGISTERED',
                    targetType: 'device',
                    targetId: created.deviceId,
                    outcome: 'success',
                    details: { deviceType: created.deviceType, zone: created.zone },
                },
            });
            return created;
        });
        return c.json({ success: true, device }, 201);
    } catch (error) {
        if (error?.code === 'P2002') {
            return c.json({ success: false, message: 'Device ID already exists' }, 409);
        }
        if (error?.code === 'P2003') {
            return c.json({ success: false, message: 'One or more assigned users do not exist' }, 400);
        }
        throw error;
    }
});

deviceRouter.get('/devices/:deviceId/irrigation-rule', requireAuth, requireRole('ADMIN'), async (c) => {
    const deviceId = c.req.param('deviceId');
    const rule = await prisma.irrigationRule.findUnique({ where: { deviceId } });
    if (!rule) {
        return c.json({ success: false, message: 'Irrigation rule not found for device' }, 404);
    }
    return c.json({ success: true, rule });
});

deviceRouter.put('/devices/:deviceId/irrigation-rule', requireAuth, requireRole('ADMIN'), async (c) => {
    const parsedBody = await c.req.json().catch(() => null);
    const parsed = IrrigationRuleSchema.safeParse(parsedBody);
    if (!parsed.success) {
        return c.json({ success: false, message: 'Invalid irrigation rule', issues: parsed.error.flatten() }, 400);
    }
    const deviceId = c.req.param('deviceId');
    const device = await prisma.device.findUnique({ where: { deviceId } });
    if (!device || ['REVOKED', 'DECOMMISSIONED'].includes(device.lifecycle)) {
        return c.json({ success: false, message: 'Active or provisioned device not found' }, 404);
    }
    const rule = await prisma.irrigationRule.upsert({
        where: { deviceId },
        create: { deviceId, ...parsed.data },
        update: {
            ...parsed.data,
            version: { increment: 1 },
            appliedVersion: null,
            appliedAt: null,
        },
    });
    await prisma.auditEvent.create({
        data: {
            actorUserId: c.get('authUser').id,
            action: 'IRRIGATION_RULE_UPDATED',
            targetType: 'device',
            targetId: deviceId,
            outcome: 'saved',
            details: parsed.data,
        },
    });
    try {
        await publishMessage(`sf/${deviceId}/config/irrigation`, {
            device_id: deviceId,
            version: rule.version,
            dry_start_moisture_percent: rule.dryStartMoisturePercent,
            wet_stop_moisture_percent: rule.wetStopMoisturePercent,
            confirmation_samples: rule.confirmationSamples,
            rest_minutes: rule.restMinutes,
        }, 1, true);
    } catch (error) {
        console.error(`[irrigation-rules] Rule saved but MQTT sync failed for ${deviceId}:`, error);
        return c.json({
            success: false,
            configSaved: true,
            publishedToMqtt: false,
            message: 'Rule saved, but could not be synchronized to the device',
            rule,
        }, 503);
    }
    return c.json({ success: true, rule, publishedToMqtt: true });
});

deviceRouter.patch('/devices/:deviceId/lifecycle', requireAuth, requireRole('ADMIN'), async (c) => {
    const parsed = LifecycleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json({ success: false, message: 'Invalid lifecycle transition', issues: parsed.error.flatten() }, 400);
    }
    const deviceId = c.req.param('deviceId');
    const { lifecycle, reason } = parsed.data;
    const actorUserId = c.get('authUser').id;
    const result = await prisma.$transaction(async (transaction) => {
        const current = await transaction.device.findUnique({ where: { deviceId } });
        if (!current) return { error: 'NOT_FOUND' };
        if (!transitions[current.lifecycle]?.includes(lifecycle)) {
            return { error: 'INVALID_TRANSITION', current: current.lifecycle };
        }
        const updated = await transaction.device.update({
            where: { deviceId },
            data: {
                lifecycle,
                ...(lifecycle === 'REVOKED' || lifecycle === 'DECOMMISSIONED'
                    ? { online: false }
                    : {}),
            },
        });
        await transaction.auditEvent.create({
            data: {
                actorUserId,
                action: lifecycle === 'REVOKED' ? 'DEVICE_REVOKED' : 'DEVICE_LIFECYCLE_CHANGED',
                targetType: 'device',
                targetId: deviceId,
                reason,
                outcome: 'success',
                details: { previous: current.lifecycle, next: lifecycle },
            },
        });
        return { device: updated };
    });

    if (result.error === 'NOT_FOUND') {
        return c.json({ success: false, message: 'Device not found' }, 404);
    }
    if (result.error === 'INVALID_TRANSITION') {
        return c.json({
            success: false,
            message: `Cannot change device lifecycle from ${result.current} to ${lifecycle}`,
        }, 409);
    }
    return c.json({
        success: true,
        device: result.device,
        ...(lifecycle === 'REVOKED'
            ? { brokerCredentialRevocationRequired: true }
            : {}),
    });
});
