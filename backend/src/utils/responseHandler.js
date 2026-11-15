const serializeBigInt = (value) => {
    if (value === null || value === undefined)
        return value;
    const t = typeof value;
    if (t === 'bigint')
        return value.toString();
    if (t === 'number' || t === 'string' || t === 'boolean')
        return value;
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value)) {
        return value.map(serializeBigInt);
    }
    if (t === 'object') {
        if (typeof value.toJSON === 'function') {
            try {
                const jsonVal = value.toJSON();
                return serializeBigInt(jsonVal);
            }
            catch {
            }
        }
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = serializeBigInt(v);
        }
        return out;
    }
    return value;
};
export const sendResponse = (c, data, message = 'Success', status = 200) => {
    const serializedData = serializeBigInt(data);
    return c.json({
        data: serializedData,
        message,
    }, status);
};
