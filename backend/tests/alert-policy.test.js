import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSensorAlertConditions } from '../src/services/alert.policy.js';
import { alertRouter } from '../src/routes/alert.routes.js';

const reading = (overrides = {}) => ({
    soilMoisture: 45,
    rainDetected: false,
    waterLevel: 'High',
    ...overrides,
});

test('alert policy raises safety alerts for low reservoir and rain', () => {
    assert.deepEqual(
        evaluateSensorAlertConditions(reading({ waterLevel: 'Low', rainDetected: true, soilMoisture: 10 })),
        { LOW_WATER: true, RAIN_BLOCK: true, SOIL_DRY: false },
    );
});

test('soil dryness is raised only below threshold when watering is not blocked', () => {
    assert.equal(evaluateSensorAlertConditions(reading({ soilMoisture: 29 })).SOIL_DRY, true);
    assert.equal(evaluateSensorAlertConditions(reading({ soilMoisture: 30 })).SOIL_DRY, false);
    assert.equal(evaluateSensorAlertConditions(reading({ soilMoisture: 10, rainDetected: true })).SOIL_DRY, false);
});

test('alert policy rejects an invalid configured soil threshold', () => {
    assert.throws(() => evaluateSensorAlertConditions(reading(), 101), RangeError);
});

test('alert endpoints require an authenticated session', async () => {
    const response = await alertRouter.request('/');

    assert.equal(response.status, 401);
});
