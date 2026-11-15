import { prisma } from '../database/connection.js';
export class SensorDataRepository {
    async create(data) {
        const uniqueWhere = data.deviceId && data.messageId
            ? { deviceId_messageId: { deviceId: data.deviceId, messageId: data.messageId } }
            : null;
        if (uniqueWhere) {
            const existing = await prisma.sensorData.findUnique({ where: uniqueWhere });
            if (existing) return { record: existing, duplicate: true };
        }

        try {
            const receivedAt = new Date();
            const record = await prisma.sensorData.create({
                data: {
                    temperature: data.temperature,
                    humidity: data.humidity,
                    soilMoisture: data.soilMoisture,
                    soilTemperature: data.soilTemperature,
                    rainDetected: data.rainDetected,
                    waterLevel: data.waterLevel,
                    schemaVersion: data.schemaVersion,
                    messageId: data.messageId,
                    sequence: data.sequence,
                    measuredAt: data.measuredAt,
                    sensorValidity: data.sensorValidity,
                    createdAt: receivedAt,
                    receivedAt,
                    deviceId: data.deviceId,
                    sourceMode: data.sourceMode,
                },
            });
            return { record, duplicate: false };
        } catch (error) {
            if (!uniqueWhere || error?.code !== 'P2002') throw error;
            const existing = await prisma.sensorData.findUnique({ where: uniqueWhere });
            if (!existing) throw error;
            return { record: existing, duplicate: true };
        }
    }
    async getLatest(deviceIds) {
        if (deviceIds && deviceIds.length === 0) return null;
        return await prisma.sensorData.findFirst({
            where: {
                sourceMode: 'hardware',
                ...(deviceIds ? { deviceId: { in: deviceIds } } : {}),
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }
    async getLatestForDevice(deviceId) {
        return await prisma.sensorData.findFirst({
            where: { deviceId, sourceMode: 'hardware' },
            orderBy: { createdAt: 'desc' },
        });
    }
    async getMany(query) {
        const where = { sourceMode: 'hardware' };
        if (query.deviceId)
            where.deviceId = query.deviceId;
        if (query.deviceIds) {
            if (query.deviceIds.length === 0) return { data: [], total: 0 };
            where.deviceId = { in: query.deviceIds };
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
            prisma.sensorData.findMany({
                where,
                orderBy: {
                    createdAt: 'desc',
                },
                take: query.limit,
                skip: query.offset,
            }),
            prisma.sensorData.count({ where }),
        ]);
        return { data, total };
    }
    async getById(id, deviceIds) {
        return await prisma.sensorData.findUnique({
            where: {
                id,
                ...(deviceIds ? { deviceId: { in: deviceIds } } : {}),
            },
        });
    }
    async getStats(hours = 24, deviceIds) {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        if (deviceIds && deviceIds.length === 0) {
            return {
                _avg: { temperature: null, humidity: null, soilMoisture: null, soilTemperature: null },
                _min: { temperature: null, humidity: null, soilMoisture: null, soilTemperature: null },
                _max: { temperature: null, humidity: null, soilMoisture: null, soilTemperature: null },
                _count: { id: 0 },
                rainDetectionCount: 0,
            };
        }
        const scopedWhere = {
            sourceMode: 'hardware',
            ...(deviceIds ? { deviceId: { in: deviceIds } } : {}),
            createdAt: { gte: since },
        };
        const stats = await prisma.sensorData.aggregate({
            where: scopedWhere,
            _avg: {
                temperature: true,
                humidity: true,
                soilMoisture: true,
                soilTemperature: true,
            },
            _min: {
                temperature: true,
                humidity: true,
                soilMoisture: true,
                soilTemperature: true,
            },
            _max: {
                temperature: true,
                humidity: true,
                soilMoisture: true,
                soilTemperature: true,
            },
            _count: {
                id: true,
            },
        });
        const rainCount = await prisma.sensorData.count({
            where: {
                ...scopedWhere,
                rainDetected: true,
            },
        });
        return {
            ...stats,
            rainDetectionCount: rainCount,
        };
    }
    async deleteOldRecords(daysToKeep = 30) {
        const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
        return await prisma.sensorData.deleteMany({
            where: {
                createdAt: {
                    lt: cutoffDate,
                },
            },
        });
    }
}
