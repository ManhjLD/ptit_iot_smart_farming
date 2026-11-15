'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSensorDataPage } from '@/lib/api';
const toNum = (v) => typeof v === 'string' ? Number(v) : v;
function mapSensor(be) {
    return {
        id: Number(be.id),
        temperature: toNum(be.temperature),
        humidity: toNum(be.humidity),
        soilMoisture: toNum(be.soilMoisture),
        soilTemperature: be.soilTemperature !== null ? toNum(be.soilTemperature) : null,
        rainDetected: Boolean(be.rainDetected),
        waterLevel: be.waterLevel,
        createdAt: be.createdAt,
    };
}
export function useSensorData(limit = 10, filters, enabled = true) {
    const query = useQuery({
        queryKey: ['sensor-data', { limit, ...filters }],
        queryFn: () => fetchSensorDataPage(limit, 0, filters),
        enabled,
    });
    const mapped = useMemo(() => {
        if (!query.data)
            return [];
        return query.data.data.map(mapSensor);
    }, [query.data]);
    return {
        data: mapped,
        loading: query.isLoading,
        error: query.error ? query.error.message : null,
        refetch: query.refetch,
    };
}
