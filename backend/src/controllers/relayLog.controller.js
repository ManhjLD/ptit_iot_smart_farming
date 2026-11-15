import { RelayLogService } from '../services/relayLog.service.js';
import { createRelayLogSchema, relayLogQuerySchema, } from '../schemas/relayLog.schema.js';
import { sendResponse } from '../utils/responseHandler.js';
import { sendError } from '../utils/errorHandler.js';
import { accessibleDeviceIds } from '../middleware/auth.js';
export class RelayLogController {
    relayLogService;
    constructor() {
        this.relayLogService = new RelayLogService();
    }
    async createRelayLog(c) {
        try {
            const body = await c.req.json();
            const validatedData = createRelayLogSchema.parse(body);
            const result = await this.relayLogService.createRelayLog(validatedData);
            return sendResponse(c, result.data, result.message, 201);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async getLatestRelayLog(c) {
        try {
            const result = await this.relayLogService.getLatestRelayLog(accessibleDeviceIds(c.get('authUser')));
            if (!result.success) {
                return sendResponse(c, null, result.message);
            }
            return sendResponse(c, result.data, result.message);
        }
        catch (error) {
            return sendError(c, error, 500);
        }
    }
    async getRelayLogs(c) {
        try {
            const query = c.req.query();
            const validatedQuery = relayLogQuerySchema.parse(query);
            validatedQuery.deviceIds = accessibleDeviceIds(c.get('authUser'));
            const result = await this.relayLogService.getRelayLogs(validatedQuery);
            return sendResponse(c, result, result.message);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async getRelayLogById(c) {
        try {
            const id = c.req.param('id');
            if (!id) {
                return sendError(c, new Error('Missing relay log ID'), 400);
            }
            const relayLogId = BigInt(id);
            const result = await this.relayLogService.getRelayLogById(relayLogId, accessibleDeviceIds(c.get('authUser')));
            if (!result.success) {
                return sendResponse(c, null, result.message, 404);
            }
            return sendResponse(c, result.data, result.message);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async getRelayStats(c) {
        try {
            const hoursParam = c.req.query('hours');
            const hours = hoursParam ? parseInt(hoursParam, 10) : 24;
            if (hours <= 0 || hours > 168) {
                return sendError(c, new Error('Hours must be between 1 and 168'), 400);
            }
            const result = await this.relayLogService.getRelayStats(hours, accessibleDeviceIds(c.get('authUser')));
            return sendResponse(c, result.data, result.message);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async getCurrentRelayStatus(c) {
        try {
            const result = await this.relayLogService.getCurrentRelayStatus(accessibleDeviceIds(c.get('authUser')));
            return sendResponse(c, result.data, result.message);
        }
        catch (error) {
            return sendError(c, error, 500);
        }
    }
    async logRelayStateChange(c) {
        try {
            const body = await c.req.json();
            const { relayStatus, triggerReason, sensorReadingId } = body;
            if (typeof relayStatus !== 'boolean') {
                return sendError(c, new Error('relayStatus must be a boolean'), 400);
            }
            if (typeof triggerReason !== 'string' ||
                triggerReason.trim() === '') {
                return sendError(c, new Error('triggerReason is required and must be a non-empty string'), 400);
            }
            if (!sensorReadingId) {
                return sendError(c, new Error('sensorReadingId is required'), 400);
            }
            const result = await this.relayLogService.logRelayStateChange(relayStatus, triggerReason, BigInt(sensorReadingId));
            const statusCode = result.success ? 201 : 400;
            return sendResponse(c, result.data, result.message, statusCode);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async getOperationDuration(c) {
        try {
            const hoursParam = c.req.query('hours');
            const hours = hoursParam ? parseInt(hoursParam, 10) : 24;
            if (hours <= 0 || hours > 168) {
                return sendError(c, new Error('Hours must be between 1 and 168'), 400);
            }
            const result = await this.relayLogService.getOperationDuration(hours, accessibleDeviceIds(c.get('authUser')));
            return sendResponse(c, result.data, result.message);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async cleanupRelayLogs(c) {
        try {
            const daysParam = c.req.query('days');
            const days = daysParam ? parseInt(daysParam, 10) : 30;
            if (days < 7) {
                return sendError(c, new Error('Cannot delete logs newer than 7 days'), 400);
            }
            const result = await this.relayLogService.cleanupOldLogs(days);
            return sendResponse(c, result.data, result.message);
        }
        catch (error) {
            return sendError(c, error, 400);
        }
    }
    async healthCheck(c) {
        try {
            const [latestResult, statsResult] = await Promise.all([
                this.relayLogService.getLatestRelayLog(),
                this.relayLogService.getRelayStats(1),
            ]);
            const hasRecentData = latestResult.success && latestResult.data !== null;
            const lastLogAge = latestResult.data?.createdAt
                ? Date.now() - new Date(latestResult.data.createdAt).getTime()
                : null;
            return sendResponse(c, {
                status: hasRecentData ? 'healthy' : 'warning',
                hasData: hasRecentData,
                lastLogAgeMinutes: lastLogAge
                    ? Math.floor(lastLogAge / (1000 * 60))
                    : null,
                currentRelayStatus: latestResult.data?.relayStatus ?? false,
                recentOperations: statsResult.data?.totalOperations ?? 0,
                message: hasRecentData
                    ? 'Relay log service is operational'
                    : 'No recent relay logs found',
            });
        }
        catch (error) {
            return sendError(c, error, 500);
        }
    }
}
