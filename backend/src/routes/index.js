import { Hono } from 'hono';
import { sensorDataRouter } from './sensorData.routes.js';
import { relayLogRouter } from './relayLog.routes.js';
import { prisma } from '../database/connection.js';
import { mqttRouter } from './mqtt.routes.js';
import { deviceRouter } from './device.routes.js';
import { authRouter } from './auth.routes.js';
import { commandRouter } from './command.routes.js';
import { alertRouter } from './alert.routes.js';
const apiRouter = new Hono();
apiRouter.get('/health', async (c) => {
    try {
        await prisma.$queryRaw `SELECT 1 as test`;
        return c.json({
            success: true,
            message: 'API is healthy',
            timestamp: new Date().toISOString(),
            services: {
                database: 'connected',
                api: 'operational',
            },
        });
    }
    catch (error) {
        return c.json({
            success: false,
            message: 'API health check failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
            services: {
                database: 'disconnected',
                api: 'operational',
            },
        }, 500);
    }
});
apiRouter.get('/db-test', async (c) => {
    try {
        const result = (await prisma.$queryRaw `SELECT NOW() as current_time`);
        return c.json({
            success: true,
            message: 'Database connection successful',
            timestamp: result[0].current_time,
        });
    }
    catch (error) {
        return c.json({
            success: false,
            message: 'Database connection failed',
            error: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
    }
});
apiRouter.get('/info', (c) => {
    return c.json({
        name: 'Smart Farming IoT Backend API',
        version: '1.0.0',
        description: 'Backend API for Smart Farming IoT system with sensor data and relay control',
        endpoints: {
            'GET /api/health': 'API health check',
            'GET /api/db-test': 'Database connection test',
            'GET /api/info': 'API information',
            'POST /api/auth/login': 'Log in with email and password',
            'GET /api/auth/me': 'Current account and device assignments',
            'POST /api/auth/logout': 'Revoke the current session',
            'GET /api/auth/users': 'List accounts (Admin)',
            'POST /api/auth/users': 'Create account (Admin)',
            'PATCH /api/auth/users/:id': 'Update account role, status and assignments (Admin)',
            'POST /api/sensor-data': 'Create new sensor data',
            'GET /api/sensor-data': 'Get sensor data with pagination',
            'GET /api/sensor-data/latest': 'Get latest sensor data',
            'GET /api/sensor-data/stats': 'Get sensor data statistics',
            'GET /api/sensor-data/health': 'Sensor data service health',
            'GET /api/sensor-data/:id': 'Get sensor data by ID',
            'DELETE /api/sensor-data/cleanup': 'Cleanup old sensor data',
            'POST /api/relay-log': 'Create new relay log',
            'GET /api/relay-log': 'Get relay logs with pagination',
            'GET /api/relay-log/latest': 'Get latest relay log',
            'GET /api/relay-log/status': 'Get current relay status',
            'GET /api/relay-log/stats': 'Get relay statistics',
            'GET /api/relay-log/duration': 'Get relay operation duration',
            'GET /api/relay-log/health': 'Relay log service health',
            'POST /api/relay-log/state-change': 'Log relay state change',
            'GET /api/relay-log/:id': 'Get relay log by ID',
            'DELETE /api/relay-log/cleanup': 'Cleanup old relay logs',
            'GET /api/mqtt/health': 'MQTT connection status',
            'POST /api/mqtt/publish': 'Publish a message to a topic',
            'GET /api/alerts': 'List alerts within the authenticated device scope',
            'POST /api/alerts/:id/ack': 'Acknowledge an alert (Admin or Operator)',
            'POST /api/alerts/:id/resolve': 'Resolve a recovered alert or record a manual resolution note',
            'GET /api/device/status': 'Configured physical device',
            'GET /api/device/devices': 'Physical device registry and heartbeat state',
            'GET /api/device/devices/:deviceId/irrigation-rule': 'Get an irrigation rule (Admin)',
            'PUT /api/device/devices/:deviceId/irrigation-rule': 'Save and synchronize an irrigation rule (Admin)',
        },
        timestamp: new Date().toISOString(),
    });
});
apiRouter.route('/auth', authRouter);
apiRouter.route('/commands', commandRouter);
apiRouter.route('/alerts', alertRouter);
apiRouter.route('/sensor-data', sensorDataRouter);
apiRouter.route('/relay-log', relayLogRouter);
apiRouter.route('/mqtt', mqttRouter);
apiRouter.route('/device', deviceRouter);
export { apiRouter };
