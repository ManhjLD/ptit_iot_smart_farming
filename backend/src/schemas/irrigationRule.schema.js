import { z } from 'zod';

export const IrrigationRuleSchema = z.object({
    dryStartMoisturePercent: z.number().int().min(0).max(40),
    wetStopMoisturePercent: z.number().int().min(5).max(80),
    confirmationSamples: z.number().int().min(1).max(10),
    restMinutes: z.number().int().min(1).max(60),
}).refine(
    (rule) => rule.dryStartMoisturePercent < rule.wetStopMoisturePercent,
    { message: 'Wet-stop threshold must be greater than dry-start threshold' },
);
