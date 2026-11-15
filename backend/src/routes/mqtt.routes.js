import { Hono } from 'hono';
import { z } from 'zod';
import { publishMessage, mqttStatus, } from '../services/mqtt.service.js';
import { RelayLogService } from '../services/relayLog.service.js';
import { SensorDataService } from '../services/sensorData.service.js';
import { extractRelayStatus, toBigIntId, } from '../utils/mqtt.utils.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
export const mqttRouter = new Hono();
const relayLogService = new RelayLogService();
const sensorDataService = new SensorDataService();
mqttRouter.use('*', requireAuth);
mqttRouter.get('/health', (c) => {
    const status = mqttStatus();
    return c.json({
        success: true,
        mqtt: status,
        timestamp: new Date().toISOString(),
    });
});
const PublishSchema = z.object({
    topic: z.string().min(1),
    payload: z.any().optional().default(''),
    qos: z
        .union([z.literal(0), z.literal(1), z.literal(2)])
        .optional()
        .default(0),
    retain: z.boolean().optional().default(false),
});
mqttRouter.post('/publish', requireRole('ADMIN'), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = PublishSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({
            success: false,
            message: 'Invalid body',
            issues: parsed.error.flatten(),
        }, 400);
    }
    const { topic, payload, qos, retain } = parsed.data;
    if (topic === (process.env.MQTT_COMMAND_TOPIC || 'sf/devices/relay/command') ||
        /(^|\/)relay\/command(?:\/|$)/.test(topic) ||
        /(^|\/)command(?:\/|$)/.test(topic)) {
        return c.json({
            success: false,
            message: 'Relay commands must use the authenticated command lifecycle endpoint',
        }, 400);
    }
    try {
        await publishMessage(topic, payload, qos, retain);
        let relayPersisted = false;
        let relayMessage;
        const isRelayCommand = topic.includes('/relay') && topic.includes('/command');
        if (isRelayCommand) {
            const desired = extractRelayStatus(payload);
            if (desired !== null) {
                let sensorReadingId = toBigIntId(payload?.sensorReadingId);
                const deviceId = payload && typeof payload === 'object' &&
                    typeof payload.device_id === 'string'
                    ? String(payload.device_id)
                    : undefined;
                if (sensorReadingId && deviceId) {
                    const selected = await sensorDataService.getSensorDataById(sensorReadingId);
                    if (selected.data?.deviceId !== deviceId) {
                        sensorReadingId = null;
                    }
                }
                if (!sensorReadingId) {
                    try {
                        const latest = deviceId
                            ? await sensorDataService.getLatestSensorDataForDevice(deviceId)
                            : await sensorDataService.getLatestSensorData();
                        const id = latest.data?.id;
                        const idBig = toBigIntId(id);
                        if (idBig)
                            sensorReadingId = idBig;
                    }
                    catch { }
                }
                if (sensorReadingId) {
                    try {
                        const res = await relayLogService.logRelayStateChange(desired, 'frontend-command', sensorReadingId);
                        relayPersisted = !!res.success;
                        relayMessage = res.message;
                    }
                    catch (e) {
                        relayMessage =
                            e?.message ?? 'Failed to persist relay state';
                    }
                }
                else {
                    relayMessage =
                        'No sensorReadingId available to log relay state';
                }
            }
            else {
                relayMessage = 'Relay command payload missing state/status';
            }
        }
        return c.json({
            success: true,
            message: 'Published',
            topic,
            qos,
            retain,
            relayPersisted,
            relayMessage,
            timestamp: new Date().toISOString(),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to publish';
        return c.json({ success: false, message }, 500);
    }
});
