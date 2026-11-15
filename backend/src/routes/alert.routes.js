import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../database/connection.js';
import { accessibleDeviceIds, requireAuth } from '../middleware/auth.js';
import { canResolveAlert } from '../services/alert.service.js';
import { MANUAL_RESOLUTION_RULES } from '../services/alert.policy.js';

export const alertRouter = new Hono();
const NoteSchema = z.object({
    note: z.string().trim().max(500).optional(),
});

alertRouter.use('*', requireAuth);

alertRouter.get('/', async (c) => {
    const user = c.get('authUser');
    const deviceIds = accessibleDeviceIds(user);
    if (deviceIds && deviceIds.length === 0) {
        return c.json({ success: true, alerts: [] });
    }
    const status = c.req.query('status');
    if (status && !['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
        return c.json({ success: false, message: 'Invalid alert status' }, 400);
    }
    const alerts = await prisma.alert.findMany({
        where: {
            ...(deviceIds ? { deviceId: { in: deviceIds } } : {}),
            ...(status ? { status } : {}),
        },
        orderBy: [{ status: 'asc' }, { lastSeen: 'desc' }],
        take: 100,
    });
    return c.json({ success: true, alerts });
});

alertRouter.post('/:id/ack', async (c) => {
    const user = c.get('authUser');
    if (!['ADMIN', 'OPERATOR'].includes(user.role)) {
        return c.json({ success: false, message: 'Operator role is required to acknowledge alerts' }, 403);
    }
    let payload;
    try {
        payload = await c.req.json();
    } catch {
        return c.json({ success: false, message: 'A valid JSON request body is required' }, 400);
    }
    const body = NoteSchema.safeParse(payload);
    if (!body.success) {
        return c.json({ success: false, message: 'Invalid acknowledgement note' }, 400);
    }
    const alert = await prisma.alert.findUnique({ where: { id: c.req.param('id') } });
    if (!alert || (user.role !== 'ADMIN' && !user.deviceIds.includes(alert.deviceId))) {
        return c.json({ success: false, message: 'Alert not found' }, 404);
    }
    if (alert.status === 'RESOLVED') {
        return c.json({ success: false, message: 'Resolved alert cannot be acknowledged' }, 409);
    }
    if (alert.status === 'ACKNOWLEDGED') {
        return c.json({ success: true, alert });
    }
    const updated = await prisma.alert.update({
        where: { id: alert.id },
        data: {
            status: 'ACKNOWLEDGED',
            acknowledgedByUserId: user.id,
            acknowledgedAt: new Date(),
            acknowledgementNote: body.data?.note ?? null,
        },
    });
    await prisma.auditEvent.create({
        data: {
            actorUserId: user.id,
            action: 'ALERT_ACKNOWLEDGED',
            targetType: 'alert',
            targetId: alert.id,
            reason: body.data?.note,
            outcome: 'success',
        },
    });
    return c.json({ success: true, alert: updated });
});

alertRouter.post('/:id/resolve', async (c) => {
    const user = c.get('authUser');
    if (!['ADMIN', 'OPERATOR'].includes(user.role)) {
        return c.json({ success: false, message: 'Operator role is required to resolve alerts' }, 403);
    }
    let payload;
    try {
        payload = await c.req.json();
    } catch {
        return c.json({ success: false, message: 'A valid JSON request body is required' }, 400);
    }
    const body = NoteSchema.safeParse(payload);
    if (!body.success) {
        return c.json({ success: false, message: 'Invalid resolution note' }, 400);
    }
    const alert = await prisma.alert.findUnique({ where: { id: c.req.param('id') } });
    if (!alert || (user.role !== 'ADMIN' && !user.deviceIds.includes(alert.deviceId))) {
        return c.json({ success: false, message: 'Alert not found' }, 404);
    }
    if (alert.status === 'RESOLVED') {
        return c.json({ success: true, alert });
    }
    const conditionRecovered = await canResolveAlert(alert);
    const manualResolution = MANUAL_RESOLUTION_RULES.includes(alert.ruleCode) && Boolean(body.data.note);
    if (!conditionRecovered && !manualResolution) {
        return c.json({ success: false, message: 'Alert condition has not recovered yet' }, 409);
    }
    const updated = await prisma.alert.update({
        where: { id: alert.id },
        data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            ...(body.data?.note ? {
                acknowledgementNote: [alert.acknowledgementNote, body.data.note].filter(Boolean).join('\n'),
            } : {}),
        },
    });
    await prisma.auditEvent.create({
        data: {
            actorUserId: user.id,
            action: 'ALERT_RESOLVED',
            targetType: 'alert',
            targetId: alert.id,
            reason: body.data?.note,
            outcome: 'success',
        },
    });
    return c.json({ success: true, alert: updated });
});
