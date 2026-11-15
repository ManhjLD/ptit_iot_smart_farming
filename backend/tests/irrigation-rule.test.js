import test from 'node:test';
import assert from 'node:assert/strict';
import { IrrigationRuleSchema } from '../src/schemas/irrigationRule.schema.js';

const defaultRule = {
    dryStartMoisturePercent: 10,
    wetStopMoisturePercent: 35,
    confirmationSamples: 3,
    restMinutes: 5,
};

test('irrigation rule accepts safe hysteresis and bounded timing values', () => {
    assert.equal(IrrigationRuleSchema.safeParse(defaultRule).success, true);
});

test('irrigation rule rejects inverted hysteresis and out-of-range values', () => {
    assert.equal(IrrigationRuleSchema.safeParse({
        ...defaultRule,
        wetStopMoisturePercent: 10,
    }).success, false);
    assert.equal(IrrigationRuleSchema.safeParse({
        ...defaultRule,
        confirmationSamples: 11,
    }).success, false);
    assert.equal(IrrigationRuleSchema.safeParse({
        ...defaultRule,
        restMinutes: 0,
    }).success, false);
});
