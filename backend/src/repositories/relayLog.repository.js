import { prisma } from '../database/connection.js';
export class RelayLogRepository {
    async create(data) {
        return await prisma.relayLog.create({
            data: {
                relayStatus: data.relayStatus,
                triggerReason: data.triggerReason,
                sensorReadingId: data.sensorReadingId,
            },
            include: {
                sensorData: true,
            },
        });
    }
    async getLatest(deviceIds) {
        if (deviceIds && deviceIds.length === 0) return null;
        return await prisma.relayLog.findFirst({
            where: {
                sensorData: {
                    sourceMode: 'hardware',
                    ...(deviceIds ? { deviceId: { in: deviceIds } } : {}),
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                sensorData: true,
            },
        });
    }
    async getMany(query) {
        const where = {
            sensorData: {
                sourceMode: 'hardware',
                ...(query.deviceIds ? { deviceId: { in: query.deviceIds } } : {}),
            },
        };
        if (query.deviceIds?.length === 0) return { data: [], total: 0 };
        if (query.status !== undefined) {
            where.relayStatus = query.status;
        }
        if (query.from || query.to) {
            where.createdAt = {};
            if (query.from) {
                where.createdAt.gte = new Date(query.from);
            }
            if (query.to) {
                where.createdAt.lte = new Date(query.to);
            }
        }
        const [data, total] = await Promise.all([
            prisma.relayLog.findMany({
                where,
                orderBy: {
                    createdAt: 'desc',
                },
                take: query.limit,
                skip: query.offset,
                include: {
                    sensorData: true,
                },
            }),
            prisma.relayLog.count({ where }),
        ]);
        return { data, total };
    }
    async getById(id, deviceIds) {
        return await prisma.relayLog.findUnique({
            where: {
                id,
                ...(deviceIds ? { sensorData: { deviceId: { in: deviceIds } } } : {}),
            },
            include: {
                sensorData: true,
            },
        });
    }
    async getStats(hours = 24, deviceIds) {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        if (deviceIds && deviceIds.length === 0) {
            return {
                totalOperations: 0,
                onCount: 0,
                offCount: 0,
                avgSoilMoistureWhenOn: null,
                avgTemperatureWhenOn: null,
                avgSoilTemperatureWhenOn: null,
                rainDetectionCount: 0,
            };
        }
        const sensorScope = {
            sourceMode: 'hardware',
            ...(deviceIds ? { deviceId: { in: deviceIds } } : {}),
        };
        const [totalCount, onCount, offCount] = await Promise.all([
            prisma.relayLog.count({
                where: {
                    sensorData: sensorScope,
                    createdAt: {
                        gte: since,
                    },
                },
            }),
            prisma.relayLog.count({
                where: {
                    sensorData: sensorScope,
                    createdAt: {
                        gte: since,
                    },
                    relayStatus: true,
                },
            }),
            prisma.relayLog.count({
                where: {
                    sensorData: sensorScope,
                    createdAt: {
                        gte: since,
                    },
                    relayStatus: false,
                },
            }),
        ]);
        const relayLogsWithSensorData = await prisma.relayLog.findMany({
            where: {
                sensorData: sensorScope,
                createdAt: {
                    gte: since,
                },
                relayStatus: true,
            },
            include: {
                sensorData: true,
            },
        });
        const avgWhenOn = relayLogsWithSensorData.length > 0
            ? {
                soilMoisture: relayLogsWithSensorData.reduce((totalMoisture, log) => totalMoisture + log.sensorData.soilMoisture, 0) / relayLogsWithSensorData.length,
                temperature: relayLogsWithSensorData.reduce((totalTemp, log) => totalTemp + Number(log.sensorData.temperature), 0) / relayLogsWithSensorData.length,
                soilTemperature: (() => {
                    const logsWithSoilTemp = relayLogsWithSensorData.filter((log) => log.sensorData.soilTemperature !== null);
                    if (logsWithSoilTemp.length === 0)
                        return null;
                    return (logsWithSoilTemp.reduce((totalSoilTemp, log) => totalSoilTemp +
                        Number(log.sensorData.soilTemperature), 0) / logsWithSoilTemp.length);
                })(),
            }
            : {
                soilMoisture: null,
                temperature: null,
                soilTemperature: null,
            };
        const rainCount = relayLogsWithSensorData.filter((log) => log.sensorData.rainDetected).length;
        return {
            totalOperations: totalCount,
            onCount: onCount,
            offCount: offCount,
            rainDetectionCount: rainCount,
            avgSoilMoistureWhenOn: avgWhenOn.soilMoisture,
            avgTemperatureWhenOn: avgWhenOn.temperature,
            avgSoilTemperatureWhenOn: avgWhenOn.soilTemperature,
        };
    }
    async getCurrentStatus(deviceIds) {
        const latest = await this.getLatest(deviceIds);
        return latest?.relayStatus ?? false;
    }
    async deleteOldRecords(daysToKeep = 30) {
        const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
        return await prisma.relayLog.deleteMany({
            where: {
                createdAt: {
                    lt: cutoffDate,
                },
            },
        });
    }
}
