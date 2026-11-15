import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayCommandPayload, pumpStartBlockReason } from '../src/routes/command.routes.js';

const now = Date.now();
const safeReading = {
    createdAt: new Date(now - 1000),
    rainDetected: false,
    waterLevel: 'High',
};

test('pump start policy allows a recent reading with safe rain and water conditions', () => {
    assert.equal(pumpStartBlockReason(safeReading, now), null);
});

test('pump start policy rejects stale readings, rain, and low reservoir water', () => {
    assert.match(pumpStartBlockReason({ ...safeReading, createdAt: new Date(now - 600_001) }, now), /Recent sensor readings/);
    assert.match(pumpStartBlockReason({ ...safeReading, rainDetected: true }, now), /rain/i);
    assert.match(pumpStartBlockReason({ ...safeReading, waterLevel: 'Low' }, now), /water is low/i);
    assert.match(pumpStartBlockReason(null, now), /Recent sensor readings/);
});

test('relay MQTT command includes the ESP32 relay field and target metadata', () => {
    const issuedAt = new Date('2026-11-14T09:00:00.000Z');
    const expiresAt = new Date('2026-11-14T09:00:15.000Z');
    const payload = createRelayCommandPayload({
        commandId: 'command-123',
        deviceId: 'esp32-01',
        desiredState: true,
        reason: 'Dashboard operator requested relay state',
        issuedAt,
        expiresAt,
    });

    assert.equal(payload.command_id, 'command-123');
    assert.equal(payload.device_id, 'esp32-01');
    assert.equal(payload.state, 'on');
    assert.equal(payload.relayStatus, true);
    assert.equal(payload.expires_at_epoch, Math.floor(expiresAt.getTime() / 1000));
});
