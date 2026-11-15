export const SENSOR_ALERT_RULES = ['LOW_WATER', 'RAIN_BLOCK', 'SOIL_DRY'];
export const MANUAL_RESOLUTION_RULES = ['SENSOR_INVALID', 'PUMP_MAX_RUNTIME', 'COMMAND_REJECTED'];

export function evaluateSensorAlertConditions(reading, soilDryThreshold = 30) {
    if (!Number.isFinite(soilDryThreshold) || soilDryThreshold < 0 || soilDryThreshold > 100) {
        throw new RangeError('Soil dry alert threshold must be between 0 and 100 percent');
    }

    const lowWater = String(reading.waterLevel).toLowerCase() === 'low';
    const rainDetected = reading.rainDetected === true;
    return {
        LOW_WATER: lowWater,
        RAIN_BLOCK: rainDetected,
        SOIL_DRY: reading.soilMoisture < soilDryThreshold && !rainDetected && !lowWater,
    };
}
