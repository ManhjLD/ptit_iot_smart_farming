import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceRouter } from '../src/routes/device.routes.js';
import { createSensorDataSchema, sensorDataQuerySchema } from '../src/schemas/sensorData.schema.js';

test('device status reports the configured physical ESP32', async () => {
    const previousDeviceId = process.env.DEVICE_ID;
    process.env.DEVICE_ID = 'esp32-test-01';

    try {
        const response = await deviceRouter.request('/status');
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.deviceId, 'esp32-test-01');
        assert.equal(body.source, 'hardware');
    }
    finally {
        if (previousDeviceId === undefined) {
            delete process.env.DEVICE_ID;
        }
        else {
            process.env.DEVICE_ID = previousDeviceId;
        }
    }
});

test('irrigation-rule endpoints require an authenticated Admin session', async () => {
    const response = await deviceRouter.request('/devices/esp32-01/irrigation-rule');
    const registryResponse = await deviceRouter.request('/devices');

    assert.equal(response.status, 401);
    assert.equal(registryResponse.status, 401);
});

test('sensor data defaults to hardware source', () => {
    const reading = {
        temperature: 25,
        humidity: 60,
        soilMoisture: 45,
        rainDetected: false,
        waterLevel: 'High',
        deviceId: 'esp32-01',
    };

    const parsed = createSensorDataSchema.parse(reading);
    assert.equal(parsed.sourceMode, 'hardware');
    assert.equal(createSensorDataSchema.safeParse({ ...reading, sourceMode: 'external' }).success, false);
    assert.equal(sensorDataQuerySchema.safeParse({ sourceMode: 'external' }).success, false);
});

test('versioned telemetry requires a unique message envelope and per-sensor validity', () => {
    const reading = {
        temperature: 25,
        humidity: 60,
        soilMoisture: 45,
        soilTemperature: 20,
        rainDetected: false,
        waterLevel: 'High',
        deviceId: 'esp32-01',
        schemaVersion: 1,
        messageId: 'esp32-01-boot-sequence',
        sequence: 1,
        sensorValid: true,
        measuredAt: null,
        sensorValidity: {
            air_temperature: true,
            humidity: true,
            soil_moisture: true,
            soil_temperature: true,
            rain: true,
            water_level: true,
        },
    };

    assert.equal(createSensorDataSchema.safeParse(reading).success, true);
    assert.equal(createSensorDataSchema.safeParse({
        ...reading,
        messageId: undefined,
    }).success, false);
    assert.equal(createSensorDataSchema.safeParse({
        ...reading,
        sensorValidity: { ...reading.sensorValidity, soil_moisture: false },
    }).success, false);
});
