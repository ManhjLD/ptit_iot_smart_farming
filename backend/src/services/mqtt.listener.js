import { getMqttClient, publishMessage, waitForMqttReady } from './mqtt.service.js';
import { createSensorDataSchema } from '../schemas/sensorData.schema.js';
import { SensorDataService } from './sensorData.service.js';
import { RelayLogService } from './relayLog.service.js';
import { prisma } from '../database/connection.js';
import { matchTopic, tryParseJSON, extractRelayStatus, toBigIntId, } from '../utils/mqtt.utils.js';
import { raiseAlert, resolveActiveAlert } from './alert.service.js';
import { evaluateSensorAlertConditions, SENSOR_ALERT_RULES } from './alert.policy.js';
const sensorService = new SensorDataService();
const relayService = new RelayLogService();
const RAW_SENSOR_TOPICS = process.env.MQTT_SENSOR_TOPICS || 'sf/+/sensor';
const RAW_RELAY_TOPICS = process.env.MQTT_RELAY_TOPICS || 'sf/+/relay';
const STATUS_TOPICS = (process.env.MQTT_STATUS_TOPICS || 'sf/+/status')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
const ACK_TOPICS = (process.env.MQTT_ACK_TOPICS || 'sf/+/ack')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
const IRRIGATION_CONFIG_ACK_TOPICS = (process.env.MQTT_IRRIGATION_CONFIG_ACK_TOPICS || 'sf/+/config/irrigation/ack')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
const SENSOR_TOPICS = RAW_SENSOR_TOPICS.split(',')
    .map((t) => t.trim())
    .filter(Boolean);
const RELAY_TOPICS = RAW_RELAY_TOPICS.split(',')
    .map((t) => t.trim())
    .filter(Boolean);
const SUB_TOPICS = Array.from(new Set([
    ...SENSOR_TOPICS,
    ...RELAY_TOPICS,
    ...STATUS_TOPICS,
    ...ACK_TOPICS,
    ...IRRIGATION_CONFIG_ACK_TOPICS,
]));
const isSensorTopic = (topic) => SENSOR_TOPICS.some((t) => matchTopic(t, topic)) ||
    topic.includes('/sensor');
const isRelayTopic = (topic) => RELAY_TOPICS.some((t) => matchTopic(t, topic)) ||
    topic.includes('/relay');
const isStatusTopic = (topic) => STATUS_TOPICS.some((t) => matchTopic(t, topic)) ||
    topic.includes('/status');
const isAckTopic = (topic) => ACK_TOPICS.some((t) => matchTopic(t, topic)) ||
    topic.includes('/ack');
const isIrrigationConfigAckTopic = (topic) => IRRIGATION_CONFIG_ACK_TOPICS.some((t) => matchTopic(t, topic));
const deviceIdFrom = (topic, payload) => {
    if (typeof payload.device_id === 'string' && payload.device_id.trim()) {
        const payloadDeviceId = payload.device_id.trim();
        const topicDeviceId = topic.split('/')[1] || null;
        if (topicDeviceId && payloadDeviceId !== topicDeviceId) {
            console.warn(`[MQTT] Payload device ID does not match topic on ${topic}`);
            return null;
        }
        return payloadDeviceId;
    }
    return topic.split('/')[1] || null;
};
const updateDevice = async (deviceId, details, canActivateProvisioned = true) => {
    const current = await prisma.device.findUnique({ where: { deviceId } });
    if (!current || current.lifecycle === 'REVOKED' || current.lifecycle === 'DECOMMISSIONED') {
        return false;
    }

    const activate = canActivateProvisioned &&
        current.lifecycle === 'PROVISIONED' &&
        details.online === true;
    await prisma.device.update({
        where: { deviceId },
        data: {
            ...details,
            ...(activate ? { lifecycle: 'ACTIVE' } : {}),
            lastSeen: new Date(),
        },
    });
    if (activate) {
        await prisma.auditEvent.create({
            data: {
                action: 'DEVICE_ACTIVATED',
                targetType: 'device',
                targetId: deviceId,
                outcome: 'success',
                details: { actor: 'system', reason: 'Device heartbeat received' },
            },
        });
    }
    if (details.online === true) {
        await resolveActiveAlert(deviceId, 'DEVICE_OFFLINE');
    }
    return current.lifecycle === 'ACTIVE' || activate;
};
const handleSensorMessage = async (topic, payload) => {
    const json = tryParseJSON(payload);
    if (!json || typeof json !== 'object') {
        console.warn(`[MQTT] Ignoring non-JSON or empty message on ${topic}`);
        return;
    }
    const source = json;
    const deviceId = deviceIdFrom(topic, source);
    const sourceMode = 'hardware';
    if (source.sensor_valid === false) {
        if (deviceId) {
            const device = await prisma.device.findUnique({ where: { deviceId } });
            if (device && !['REVOKED', 'DECOMMISSIONED'].includes(device.lifecycle)) {
                await raiseAlert({
                    deviceId,
                    ruleCode: 'SENSOR_INVALID',
                    severity: 'WARNING',
                    message: Array.isArray(source.errors)
                        ? source.errors.map(String).join('; ')
                        : 'Device reported invalid sensor data',
                });
            }
            await updateDevice(deviceId, {
                sourceMode,
                online: true,
                lastError: Array.isArray(source.errors)
                    ? source.errors.map(String).join('; ')
                    : 'Sensor reported invalid telemetry',
            }, false);
        }
        console.warn(`[MQTT] Sensor reported invalid telemetry on ${topic}`);
        return;
    }
    const measuredAtEpoch = source.measured_at_epoch;
    const measuredAt = Number.isSafeInteger(measuredAtEpoch) &&
        measuredAtEpoch >= 1700000000 &&
        measuredAtEpoch <= Math.floor(Date.now() / 1000) + 300
        ? new Date(measuredAtEpoch * 1000)
        : null;
    const normalized = {
        temperature: source.temperature ?? source.air_temperature,
        humidity: source.humidity,
        soilMoisture: source.soilMoisture ?? source.soil_moisture,
        soilTemperature: source.soilTemperature ?? source.soil_temperature,
        rainDetected: source.rainDetected ?? source.rain_detected,
        waterLevel: source.waterLevel ?? source.water_level,
        schemaVersion: source.schema_version,
        messageId: source.message_id,
        sequence: source.sequence,
        sensorValid: source.sensor_valid,
        ...(source.schema_version !== undefined ? { measuredAt } : {}),
        sensorValidity: source.sensor_validity,
        deviceId: deviceId ?? undefined,
        sourceMode,
    };
    const parsed = createSensorDataSchema.safeParse(normalized);
    if (!parsed.success) {
        if (deviceId) {
            const device = await prisma.device.findUnique({ where: { deviceId } });
            if (device && !['REVOKED', 'DECOMMISSIONED'].includes(device.lifecycle)) {
                const errors = parsed.error.issues.map((issue) =>
                    `${issue.path.join('.') || 'payload'}: ${issue.message}`,
                );
                await raiseAlert({
                    deviceId,
                    ruleCode: 'SENSOR_INVALID',
                    severity: 'WARNING',
                    message: errors.join('; ').slice(0, 1000),
                });
                await updateDevice(deviceId, {
                    sourceMode: 'hardware',
                    online: true,
                    lastError: errors.join('; ').slice(0, 1000),
                }, false);
            }
        }
        console.warn('[MQTT] Invalid sensor payload:', parsed.error.flatten());
        return;
    }
    try {
        const accepted = deviceId
            ? await updateDevice(deviceId, {
                sourceMode,
                online: true,
                lastError: Array.isArray(source.errors) && source.errors.length
                    ? source.errors.map(String).join('; ')
                    : null,
            })
            : false;
        if (!accepted) {
            console.warn(`[MQTT] Ignoring telemetry from an unprovisioned, inactive, or revoked device: ${deviceId ?? 'unknown'}`);
            return;
        }
        const res = await sensorService.createSensorData(parsed.data);
        if (res.duplicate) {
            console.log(`[MQTT] Duplicate sensor message ${parsed.data.messageId} ignored`);
            return;
        }
        const soilDryThreshold = Number(process.env.SOIL_DRY_ALERT_THRESHOLD_PERCENT ?? 30);
        const conditions = evaluateSensorAlertConditions(parsed.data, soilDryThreshold);
        const sensorAlertDetails = {
            LOW_WATER: {
                severity: 'CRITICAL',
                message: 'Reservoir water level is low; pump start is blocked',
            },
            RAIN_BLOCK: {
                severity: 'WARNING',
                message: 'Rain detected; automatic pump start is blocked',
            },
            SOIL_DRY: {
                severity: 'WARNING',
                message: `Soil moisture is below the configured ${soilDryThreshold}% alert threshold`,
            },
        };
        for (const ruleCode of SENSOR_ALERT_RULES) {
            if (conditions[ruleCode]) {
                await raiseAlert({ deviceId, ruleCode, ...sensorAlertDetails[ruleCode] });
            } else {
                await resolveActiveAlert(deviceId, ruleCode);
            }
        }
        await resolveActiveAlert(deviceId, 'SENSOR_INVALID');
        if (!res.success) {
            console.warn('[MQTT] Failed to store sensor data:', res.message);
        }
        else {
            console.log('[MQTT] Sensor data stored from', topic);
        }
    }
    catch (err) {
        console.error('[MQTT] Error storing sensor data:', err);
    }
};
const handleStatusMessage = async (topic, payload) => {
    const json = tryParseJSON(payload);
    if (!json || typeof json !== 'object') {
        console.warn(`[MQTT] Ignoring non-JSON status message on ${topic}`);
        return;
    }
    const message = json;
    const deviceId = deviceIdFrom(topic, message);
    if (!deviceId) {
        console.warn(`[MQTT] Status message has no device ID on ${topic}`);
        return;
    }
    const accepted = await updateDevice(deviceId, {
        sourceMode: 'hardware',
        online: message.online === true || message.status === 'online',
        ...(typeof message.firmware_version === 'string'
            ? { firmwareVersion: message.firmware_version }
            : {}),
        ...(typeof message.relay === 'string' ? { relayState: message.relay } : {}),
        lastError: typeof message.error === 'string' ? message.error : null,
    });
    if (accepted && Number.isSafeInteger(message.irrigation_rule_version) &&
        message.irrigation_rule_version > 0) {
        await markIrrigationRuleApplied(deviceId, message.irrigation_rule_version, topic);
    }
    if (!accepted && message.online === true) {
        console.warn(`[MQTT] Device heartbeat cannot activate an unprovisioned or revoked device: ${deviceId}`);
    }
};
const handleAckMessage = async (topic, payload) => {
    const message = tryParseJSON(payload);
    if (!message || typeof message !== 'object' ||
        typeof message.command_id !== 'string' ||
        typeof message.device_id !== 'string' ||
        typeof message.executed !== 'boolean' ||
        typeof message.actual_state !== 'boolean') {
        console.warn(`[MQTT] Invalid command acknowledgement on ${topic}`);
        return;
    }

    const command = await prisma.deviceCommand.findUnique({ where: { id: message.command_id } });
    const topicDeviceId = topic.split('/')[1];
    if (!command || command.deviceId !== message.device_id ||
        (topicDeviceId && topicDeviceId !== message.device_id)) {
        console.warn(`[MQTT] Ignoring acknowledgement for unknown or mismatched command on ${topic}`);
        return;
    }
    if (['SUCCEEDED', 'REJECTED', 'TIMED_OUT', 'CANCELLED'].includes(command.status)) {
        return;
    }
    if (command.expiresAt <= new Date()) {
        await prisma.deviceCommand.updateMany({
            where: { id: command.id, status: { in: ['PENDING', 'SENT', 'ACKNOWLEDGED'] } },
            data: { status: 'TIMED_OUT', resultReason: 'Acknowledgement received after expiry' },
        });
        return;
    }

    const succeeded = message.executed && message.actual_state === command.desiredState;
    const status = succeeded ? 'SUCCEEDED' : 'REJECTED';
    const resultReason = typeof message.reason === 'string'
        ? message.reason.slice(0, 500)
        : succeeded ? null : 'Device rejected the command or reported a different state';
    const updated = await prisma.deviceCommand.updateMany({
        where: { id: command.id, status: { in: ['PENDING', 'SENT', 'ACKNOWLEDGED'] } },
        data: {
            status,
            actualState: message.actual_state,
            resultReason,
            acknowledgedAt: new Date(),
        },
    });
    if (!updated.count) return;

    const device = await prisma.device.findUnique({ where: { deviceId: command.deviceId } });
    if (device && device.lifecycle === 'ACTIVE') {
        await prisma.device.update({
            where: { deviceId: command.deviceId },
            data: { relayState: message.actual_state ? 'on' : 'off', lastSeen: new Date() },
        });
    }
    await prisma.auditEvent.create({
        data: {
            actorUserId: command.requestedByUserId,
            action: 'RELAY_COMMAND_ACKNOWLEDGED',
            targetType: 'device_command',
            targetId: command.id,
            outcome: status.toLowerCase(),
            details: { deviceId: command.deviceId, actualState: message.actual_state, reason: resultReason },
        },
    });
    if (succeeded) {
        await resolveActiveAlert(command.deviceId, 'COMMAND_REJECTED');
        const latest = await sensorService.getLatestSensorDataForDevice(command.deviceId);
        const sensorReadingId = toBigIntId(latest.data?.id);
        if (sensorReadingId) {
            await prisma.relayLog.create({
                data: {
                    relayStatus: message.actual_state,
                    triggerReason: 'command-acknowledged',
                    sensorReadingId,
                    commandId: command.id,
                },
            });
        }
    } else {
        await raiseAlert({
            deviceId: command.deviceId,
            ruleCode: 'COMMAND_REJECTED',
            severity: 'WARNING',
            message: resultReason || 'Device rejected the relay command',
        });
    }
};
const markIrrigationRuleApplied = async (deviceId, version, topic) => {
    const updated = await prisma.irrigationRule.updateMany({
        where: { deviceId, version },
        data: { appliedVersion: version, appliedAt: new Date() },
    });
    if (!updated.count) {
        console.warn(`[MQTT] Ignoring stale irrigation config acknowledgement on ${topic}`);
    }
};
const handleIrrigationConfigAck = async (topic, payload) => {
    const message = tryParseJSON(payload);
    const topicDeviceId = topic.split('/')[1];
    if (!message || typeof message !== 'object' ||
        typeof message.device_id !== 'string' ||
        message.device_id !== topicDeviceId ||
        !Number.isSafeInteger(message.version) ||
        message.version <= 0 ||
        typeof message.applied !== 'boolean') {
        console.warn(`[MQTT] Invalid irrigation config acknowledgement on ${topic}`);
        return;
    }
    if (!message.applied) {
        console.warn(`[MQTT] Device rejected irrigation rule v${message.version} for ${topicDeviceId}`);
        return;
    }
    await markIrrigationRuleApplied(topicDeviceId, message.version, topic);
};
const handleRelayMessage = async (topic, payload) => {
    const json = tryParseJSON(payload);
    if (!json || typeof json !== 'object') {
        console.warn(`[MQTT] Ignoring non-JSON relay message on ${topic}`);
        return;
    }
    const relayStatus = extractRelayStatus(json);
    if (relayStatus === null) {
        console.warn('[MQTT] Relay payload missing status/state');
        return;
    }
    const relayPayload = json;
    const relayDeviceId = deviceIdFrom(topic, relayPayload);
    if (!relayDeviceId) {
        console.warn(`[MQTT] Ignoring relay event with an unverified device ID on ${topic}`);
        return;
    }
    if (relayDeviceId) {
        try {
            const accepted = await updateDevice(relayDeviceId, {
                sourceMode: 'hardware',
                online: true,
                relayState: relayStatus ? 'on' : 'off',
            }, false);
            if (!accepted) {
                console.warn(`[MQTT] Ignoring relay event from an inactive or revoked device: ${relayDeviceId}`);
                return;
            }
        } catch (error) {
            console.error('[MQTT] Failed to update device relay state:', error);
        }
    }
    if (typeof json.command_id === 'string') {
        return;
    }
    const triggerReason = typeof json.triggerReason === 'string'
        ? json.triggerReason
        : typeof json.reason === 'string'
            ? json.reason
            : 'auto';
    if (relayDeviceId && /maximum pump runtime/i.test(triggerReason)) {
        await raiseAlert({
            deviceId: relayDeviceId,
            ruleCode: 'PUMP_MAX_RUNTIME',
            severity: 'CRITICAL',
            message: triggerReason,
        });
    }
    let sensorReadingId = toBigIntId(json.sensorReadingId);
    if (!sensorReadingId &&
        json.sensor &&
        typeof json.sensor === 'object') {
        const parsed = createSensorDataSchema.safeParse(json.sensor);
        if (parsed.success) {
            try {
                const created = await sensorService.createSensorData(parsed.data);
                const id = created.data?.id;
                const idBig = toBigIntId(id);
                if (idBig)
                    sensorReadingId = idBig;
            }
            catch (e) {
                console.error('[MQTT] Failed to create sensor data from relay message:', e);
            }
        }
    }
    if (!sensorReadingId) {
        try {
            const latest = relayDeviceId
                ? await sensorService.getLatestSensorDataForDevice(relayDeviceId)
                : await sensorService.getLatestSensorData();
            const id = latest.data?.id;
            const idBig = toBigIntId(id);
            if (idBig)
                sensorReadingId = idBig;
        }
        catch (e) {
            console.error('[MQTT] Failed to retrieve latest sensor data for relay log:', e);
        }
    }
    if (!sensorReadingId) {
        console.warn('[MQTT] No sensorReadingId available for relay log; skipping.');
        return;
    }
    try {
        const res = await relayService.logRelayStateChange(relayStatus, triggerReason, sensorReadingId);
        if (!res.success) {
            console.warn('[MQTT] Relay log not stored:', res.message);
        }
        else {
            console.log('[MQTT] Relay state logged from', topic, '->', relayStatus ? 'ON' : 'OFF');
        }
    }
    catch (err) {
        console.error('[MQTT] Error storing relay log:', err);
    }
};
const monitorDeviceHeartbeats = async () => {
    const heartbeatIntervalMs = Number(process.env.DEVICE_HEARTBEAT_INTERVAL_MS ?? 120000);
    const staleAfterMs = Math.max(1000, heartbeatIntervalMs) * 3;
    const cutoff = new Date(Date.now() - staleAfterMs);
    const staleDevices = await prisma.device.findMany({
        where: {
            lifecycle: 'ACTIVE',
            online: true,
            lastSeen: { lt: cutoff },
        },
        select: { deviceId: true },
    });
    for (const { deviceId } of staleDevices) {
        const updated = await prisma.device.updateMany({
            where: { deviceId, lifecycle: 'ACTIVE', online: true, lastSeen: { lt: cutoff } },
            data: { online: false },
        });
        if (updated.count) {
            await raiseAlert({
                deviceId,
                ruleCode: 'DEVICE_OFFLINE',
                severity: 'WARNING',
                message: 'Device heartbeat timed out',
            });
        }
    }
};
const publishStoredIrrigationRules = async () => {
    const rules = await prisma.irrigationRule.findMany({
        include: { device: { select: { lifecycle: true } } },
    });
    for (const rule of rules) {
        if (['REVOKED', 'DECOMMISSIONED'].includes(rule.device.lifecycle)) continue;
        try {
            await publishMessage(`sf/${rule.deviceId}/config/irrigation`, {
                device_id: rule.deviceId,
                version: rule.version,
                dry_start_moisture_percent: rule.dryStartMoisturePercent,
                wet_stop_moisture_percent: rule.wetStopMoisturePercent,
                confirmation_samples: rule.confirmationSamples,
                rest_minutes: rule.restMinutes,
            }, 1, true);
        } catch (error) {
            console.error(`[MQTT] Failed to synchronize irrigation rule for ${rule.deviceId}:`, error);
        }
    }
};
export const startMqttListeners = async () => {
    const client = getMqttClient();
    await waitForMqttReady();
    const subs = {};
    for (const t of SUB_TOPICS)
        subs[t] = { qos: 1 };
    await new Promise((resolve, reject) => {
        client.subscribe(subs, (err) => {
            if (err)
                return reject(err);
            console.log('📡 MQTT subscribed to topics:', SUB_TOPICS.join(', '));
            resolve();
        });
    });
    const onMessage = async (topic, payload) => {
        try {
            if (isIrrigationConfigAckTopic(topic)) {
                await handleIrrigationConfigAck(topic, payload);
                return;
            }
            if (isAckTopic(topic)) {
                await handleAckMessage(topic, payload);
                return;
            }
            if (isSensorTopic(topic)) {
                await handleSensorMessage(topic, payload);
                return;
            }
            if (isRelayTopic(topic)) {
                await handleRelayMessage(topic, payload);
                return;
            }
            if (isStatusTopic(topic)) {
                await handleStatusMessage(topic, payload);
                return;
            }
        }
        catch (e) {
            console.error('[MQTT] Message handler error:', e);
        }
    };
    client.removeAllListeners('message');
    client.on('message', onMessage);
    await publishStoredIrrigationRules();
    const heartbeatMonitor = setInterval(() => {
        monitorDeviceHeartbeats().catch((error) => {
            console.error('[MQTT] Failed to monitor device heartbeats:', error);
        });
    }, Math.max(10_000, Number(process.env.DEVICE_HEARTBEAT_INTERVAL_MS ?? 120000) / 2));
    heartbeatMonitor.unref();
};
