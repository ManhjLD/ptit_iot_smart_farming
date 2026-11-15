import { z } from 'zod';
export const createSensorDataSchema = z.object({
    temperature: z
        .number()
        .min(-50)
        .max(100)
        .describe('Temperature in Celsius'),
    humidity: z
        .number()
        .min(0)
        .max(100)
        .describe('Humidity percentage'),
    soilMoisture: z
        .number()
        .int()
        .min(0)
        .max(100)
        .describe('Soil moisture percentage'),
    soilTemperature: z
        .number()
        .min(-50)
        .max(100)
        .optional()
        .describe('Soil temperature in Celsius (optional)'),
    rainDetected: z.boolean().describe('Whether rain is detected'),
    waterLevel: z.string().describe('Water level status'),
    schemaVersion: z.number().int().min(1).max(1).optional(),
    messageId: z.string().trim().min(1).max(200).optional(),
    sequence: z.number().int().min(0).max(2147483647).optional(),
    sensorValid: z.boolean().optional(),
    measuredAt: z.union([
        z.string().datetime().transform((value) => new Date(value)),
        z.date(),
    ]).nullable().optional(),
    sensorValidity: z.object({
        air_temperature: z.boolean(),
        humidity: z.boolean(),
        soil_moisture: z.boolean(),
        soil_temperature: z.boolean(),
        rain: z.boolean(),
        water_level: z.boolean(),
    }).optional(),
    deviceId: z.string().trim().min(1).optional(),
    sourceMode: z.literal('hardware').optional().default('hardware'),
}).superRefine((data, context) => {
    if (data.schemaVersion !== undefined &&
        (!data.messageId || data.sequence === undefined ||
         data.measuredAt === undefined || !data.sensorValidity || data.sensorValid !== true ||
         Object.values(data.sensorValidity).some((valid) => !valid))) {
        context.addIssue({
            code: 'custom',
            message: 'Versioned telemetry requires message ID, sequence, measured time, and sensor validity',
        });
    }
});
export const sensorDataResponseSchema = z.object({
    id: z.bigint(),
    temperature: z.number(),
    humidity: z.number(),
    soilMoisture: z.number(),
    soilTemperature: z.number().nullable(),
    rainDetected: z.boolean(),
    waterLevel: z.string(),
    createdAt: z.date().nullable(),
    schemaVersion: z.number().nullable().optional(),
    messageId: z.string().nullable().optional(),
    sequence: z.number().nullable().optional(),
    measuredAt: z.date().nullable().optional(),
    receivedAt: z.date().nullable().optional(),
    sensorValidity: z.record(z.string(), z.boolean()).nullable().optional(),
});
export const sensorDataQuerySchema = z.object({
    limit: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional()
        .default(10),
    offset: z
        .string()
        .transform(Number)
        .pipe(z.number().int().min(0))
        .optional()
        .default(0),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    deviceId: z.string().min(1).optional(),
    sourceMode: z.literal('hardware').optional(),
});
