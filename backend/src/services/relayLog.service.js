import { RelayLogRepository } from '../repositories/relayLog.repository.js';
export class RelayLogService {
    relayLogRepository;
    constructor() {
        this.relayLogRepository = new RelayLogRepository();
    }
    async createRelayLog(data) {
        try {
            const result = await this.relayLogRepository.create(data);
            return {
                success: true,
                message: 'Relay log created successfully',
                data: result,
            };
        }
        catch (error) {
            throw new Error(`Failed to create relay log: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getLatestRelayLog(deviceIds) {
        try {
            const data = await this.relayLogRepository.getLatest(deviceIds);
            if (!data) {
                return {
                    success: false,
                    message: 'No relay log found',
                    data: null,
                };
            }
            return {
                success: true,
                message: 'Latest relay log retrieved successfully',
                data,
            };
        }
        catch (error) {
            throw new Error(`Failed to get latest relay log: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getRelayLogs(query) {
        try {
            const { data, total } = await this.relayLogRepository.getMany(query);
            const hasNext = query.offset + query.limit < total;
            const hasPrev = query.offset > 0;
            return {
                success: true,
                message: 'Relay logs retrieved successfully',
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
            throw new Error(`Failed to get relay logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getRelayLogById(id, deviceIds) {
        try {
            const data = await this.relayLogRepository.getById(id, deviceIds);
            if (!data) {
                return {
                    success: false,
                    message: 'Relay log not found',
                    data: null,
                };
            }
            return {
                success: true,
                message: 'Relay log retrieved successfully',
                data,
            };
        }
        catch (error) {
            throw new Error(`Failed to get relay log: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getRelayStats(hours = 24, deviceIds) {
        try {
            const stats = await this.relayLogRepository.getStats(hours, deviceIds);
            return {
                success: true,
                message: 'Relay statistics retrieved successfully',
                data: {
                    periodHours: hours,
                    totalOperations: stats.totalOperations,
                    onCount: stats.onCount,
                    offCount: stats.offCount,
                    onPercentage: stats.totalOperations > 0
                        ? (stats.onCount / stats.totalOperations) * 100
                        : 0,
                    avgSoilMoistureWhenOn: stats.avgSoilMoistureWhenOn,
                    avgTemperatureWhenOn: stats.avgTemperatureWhenOn,
                    avgSoilTemperatureWhenOn: stats.avgSoilTemperatureWhenOn,
                    rainDetectionCount: stats.rainDetectionCount,
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to get relay statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getCurrentRelayStatus(deviceIds) {
        try {
            const status = await this.relayLogRepository.getCurrentStatus(deviceIds);
            return {
                success: true,
                message: 'Current relay status retrieved successfully',
                data: {
                    relayStatus: status,
                    timestamp: new Date().toISOString(),
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to get current relay status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async logRelayStateChange(relayStatus, triggerReason, sensorReadingId) {
        try {
            const currentStatus = await this.relayLogRepository.getCurrentStatus();
            if (currentStatus === relayStatus) {
                return {
                    success: false,
                    message: `Relay is already ${relayStatus ? 'ON' : 'OFF'}`,
                    data: null,
                };
            }
            const logData = {
                relayStatus,
                triggerReason,
                sensorReadingId,
            };
            const result = await this.createRelayLog(logData);
            return {
                ...result,
                message: `Relay ${relayStatus ? 'activated' : 'deactivated'} successfully`,
            };
        }
        catch (error) {
            throw new Error(`Failed to log relay state change: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async getOperationDuration(hours = 24, deviceIds) {
        try {
            const logs = await this.relayLogRepository.getMany({
                limit: 1000,
                offset: 0,
                from: new Date(Date.now() - hours * 60 * 60 * 1000).toISOString(),
                deviceIds,
            });
            if (logs.data.length === 0) {
                return {
                    success: true,
                    message: 'No relay operations found in the specified period',
                    data: {
                        totalOnDurationMinutes: 0,
                        averageOnDurationMinutes: 0,
                        operationCount: 0,
                    },
                };
            }
            let totalOnDuration = 0;
            let operationCount = 0;
            let lastOnTime = null;
            const sortedLogs = logs.data.sort((a, b) => new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime());
            for (const log of sortedLogs) {
                if (log.relayStatus && !lastOnTime) {
                    lastOnTime = log.createdAt;
                }
                else if (!log.relayStatus && lastOnTime) {
                    const duration = new Date(log.createdAt).getTime() - lastOnTime.getTime();
                    totalOnDuration += duration;
                    operationCount++;
                    lastOnTime = null;
                }
            }
            const totalMinutes = totalOnDuration / (1000 * 60);
            const averageMinutes = operationCount > 0 ? totalMinutes / operationCount : 0;
            return {
                success: true,
                message: 'Relay operation duration analysis completed',
                data: {
                    periodHours: hours,
                    totalOnDurationMinutes: Math.round(totalMinutes),
                    averageOnDurationMinutes: Math.round(averageMinutes),
                    operationCount,
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to analyze operation duration: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async cleanupOldLogs(daysToKeep = 30) {
        try {
            const result = await this.relayLogRepository.deleteOldRecords(daysToKeep);
            return {
                success: true,
                message: `Cleanup completed: ${result.count} old relay logs deleted`,
                data: {
                    deletedCount: result.count,
                    daysKept: daysToKeep,
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to cleanup old logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
