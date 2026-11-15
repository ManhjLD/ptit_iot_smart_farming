import { SensorDataService } from '../services/sensorData.service.js';
import { createSensorDataSchema, sensorDataQuerySchema, } from '../schemas/sensorData.schema.js';
import { sendResponse } from '../utils/responseHandler.js';
import { sendError } from '../utils/errorHandler.js';
import { accessibleDeviceIds } from '../middleware/auth.js';
export class SensorDataController {
    sensorDataService;
    constructor() {
        this.sensorDataService = new SensorDataService();
    }
    async createSensorData(c) {
        try {
            const body = await c.req.json();
            const validatedData = createSensorDataSchema.parse(body);
            const validation = await this.sensorDataService.validateSensorData(validatedData);
            const result = await this.sensorDataService.createSensorData(validatedData);
            const response = {
                ...result.data,
                validation: {
                    warnings: validation.warnings,
                },
            };
            return sendResponse(c, response, result.message, 201);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async getLatestSensorData(c) {
        try {
            const result = await this.sensorDataService.getLatestSensorData(accessibleDeviceIds(c.get('authUser')));
            if (!result.success) {
                return sendResponse(c, null, result.message, 404);
            }
            return sendResponse(c, result.data, result.message);
        }
        catch (error) {
            return sendError(c, error, 500);
        }
    }
    async getSensorData(c) {
        try {
            const query = c.req.query();
            const validatedQuery = sensorDataQuerySchema.parse(query);
            validatedQuery.deviceIds = accessibleDeviceIds(c.get('authUser'));
            const result = await this.sensorDataService.getSensorData(validatedQuery);
            return sendResponse(c, result, result.message);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async getSensorDataById(c) {
        try {
            const id = c.req.param('id');
            if (!id) {
                return sendError(c, new Error('Missing sensor ID'), 400);
            }
            const sensorId = BigInt(id);
            const result = await this.sensorDataService.getSensorDataById(sensorId, accessibleDeviceIds(c.get('authUser')));
            if (!result.success) {
                return sendResponse(c, null, result.message, 404);
            }
            return sendResponse(c, result.data, result.message);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async getSensorDataStats(c) {
        try {
            const hoursParam = c.req.query('hours');
            const hours = hoursParam ? parseInt(hoursParam, 10) : 24;
            if (hours <= 0 || hours > 168) {
                return sendError(c, new Error('Hours must be between 1 and 168'), 400);
            }
            const result = await this.sensorDataService.getSensorDataStats(hours, accessibleDeviceIds(c.get('authUser')));
            return sendResponse(c, result.data, result.message);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async cleanupSensorData(c) {
        try {
            const daysParam = c.req.query('days');
            const days = daysParam ? parseInt(daysParam, 10) : 30;
            if (days < 7) {
                return sendError(c, new Error('Cannot delete data newer than 7 days'), 400);
            }
            const result = await this.sensorDataService.cleanupOldData(days);
            return sendResponse(c, result.data, result.message);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async healthCheck(c) {
        try {
            const result = await this.sensorDataService.getLatestSensorData(accessibleDeviceIds(c.get('authUser')));
            const isHealthy = result.success && result.data !== null;
            const lastDataAge = result.data?.createdAt
                ? Date.now() - new Date(result.data.createdAt).getTime()
                : null;
            return sendResponse(c, {
                status: isHealthy ? 'healthy' : 'warning',
                hasData: result.success && result.data !== null,
                lastDataAgeMinutes: lastDataAge
                    ? Math.floor(lastDataAge / (1000 * 60))
                    : null,
                message: isHealthy
                    ? 'Sensor data service is operational'
                    : 'No recent sensor data found',
            });
        }
        catch (error) {
            return sendError(c, error, 500);
        }
    }
}
