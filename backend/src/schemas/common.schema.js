import { z } from 'zod';
export const apiResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.any().optional(),
    error: z.string().optional(),
});
export const paginationMetaSchema = z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
});
export const paginatedResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.array(z.any()),
    meta: paginationMetaSchema,
});
