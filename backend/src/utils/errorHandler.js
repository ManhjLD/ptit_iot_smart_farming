import { ZodError } from 'zod';
export const sendError = (c, error, status = 400) => {
    if (error instanceof ZodError) {
        return c.json({ error: error.issues[0].message }, status);
    }
    if (error instanceof Error) {
        return c.json({ error: error.message }, status);
    }
    return c.json({ error: 'Internal server error' }, 500);
};
