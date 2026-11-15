import { SensorDataRepository } from '../repositories/sensorData.repository.js';
export class SensorDataService {
    sensorDataRepository;
    constructor() {
        this.sensorDataRepository = new SensorDataRepository();
    }
    async createSensorData(data) {
        try {
            const { record, duplicate } = await this.sensorDataRepository.create(data);
            return {
                success: true,
                message: duplicate ? 'Duplicate sensor message ignored' : 'Sensor data created successfully',
                data: record,
                duplicate,
            };
        }
        catch (error) {
            throw new Error(`Failed to create sensor data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getLatestSensorData(deviceIds) {
        try {
            const data = await this.sensorDataRepository.getLatest(deviceIds);
            if (!data) {
                return {
                    success: false,
                    message: 'No sensor data found',
                    data: null,
                };
            }
            return {
                success: true,
                message: 'Latest sensor data retrieved successfully',
                data,
            };
        }
        catch (error) {
            throw new Error(`Failed to get latest sensor data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getLatestSensorDataForDevice(deviceId) {
        try {
            const data = await this.sensorDataRepository.getLatestForDevice(deviceId);
            return data
                ? { success: true, message: 'Latest device sensor data retrieved', data }
                : { success: false, message: 'No sensor data for device', data: null };
        }
        catch (error) {
            throw new Error(`Failed to get latest sensor data for device: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getSensorData(query) {
        try {
            const { data, total } = await this.sensorDataRepository.getMany(query);
            const hasNext = query.offset + query.limit < total;
            const hasPrev = query.offset > 0;
            return {
                success: true,
                message: 'Sensor data retrieved successfully',
                data,
                meta: {
                    total,
                    limit: query.limit,
                    offset: query.offset,
                    hasNext,
                    hasPrev,
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to get sensor data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getSensorDataById(id, deviceIds) {
        try {
            const data = await this.sensorDataRepository.getById(id, deviceIds);
            if (!data) {
                return {
                    success: false,
                    message: 'Sensor data not found',
                    data: null,
                };
            }
            return {
                success: true,
                message: 'Sensor data retrieved successfully',
                data,
            };
        }
        catch (error) {
            throw new Error(`Failed to get sensor data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getSensorDataStats(hours = 24, deviceIds) {
        try {
            const stats = await this.sensorDataRepository.getStats(hours, deviceIds);
            return {
                success: true,
                message: 'Sensor data statistics retrieved successfully',
                data: {
                    periodHours: hours,
                    average: {
                        temperature: stats._avg.temperature,
                        humidity: stats._avg.humidity,
                        soilMoisture: stats._avg.soilMoisture,
                        soilTemperature: stats._avg.soilTemperature,
                    },
                    minimum: {
                        temperature: stats._min.temperature,
                        humidity: stats._min.humidity,
                        soilMoisture: stats._min.soilMoisture,
                        soilTemperature: stats._min.soilTemperature,
                    },
                    maximum: {
                        temperature: stats._max.temperature,
                        humidity: stats._max.humidity,
                        soilMoisture: stats._max.soilMoisture,
                        soilTemperature: stats._max.soilTemperature,
                    },
                    totalReadings: stats._count.id,
                    rainDetectionCount: stats.rainDetectionCount,
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to get sensor data statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async validateSensorData(data) {
        const warnings = [];
        if (data.temperature < -10 || data.temperature > 50) {
            warnings.push(`Temperature ${data.temperature}°C is outside normal range (-10°C to 50°C)`);
        }
        if (data.humidity < 10 || data.humidity > 95) {
            warnings.push(`Humidity ${data.humidity}% is outside normal range (10% to 95%)`);
        }
        if (data.soilMoisture < 0 || data.soilMoisture > 100) {
            warnings.push(`Soil moisture ${data.soilMoisture}% is outside valid range (0% to 100%)`);
        }
        if (data.soilTemperature !== undefined) {
            if (data.soilTemperature < -20 || data.soilTemperature > 60) {
                warnings.push(`Soil temperature ${data.soilTemperature}°C is outside normal range (-20°C to 60°C)`);
            }
            if (data.soilTemperature > data.temperature + 10) {
                warnings.push(`Soil temperature (${data.soilTemperature}°C) is unusually higher than air temperature (${data.temperature}°C)`);
            }
        }
        if (data.rainDetected && data.soilMoisture < 30) {
            warnings.push('Rain detected but soil moisture is low - possible sensor malfunction');
        }
        return {
            isValid: warnings.length === 0,
            warnings,
        };
    }
    async cleanupOldData(daysToKeep = 30) {
        try {
            const result = await this.sensorDataRepository.deleteOldRecords(daysToKeep);
            return {
                success: true,
                message: `Cleanup completed: ${result.count} old records deleted`,
                data: {
                    deletedCount: result.count,
                    daysKept: daysToKeep,
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to cleanup old data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
