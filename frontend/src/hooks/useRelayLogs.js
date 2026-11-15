'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRelayLogs } from '@/lib/api';
function mapRelay(be) {
    return {
        id: Number(be.id),
        relayStatus: be.relayStatus,
        triggerReason: be.triggerReason,
        soilMoisture: be.sensorData?.soilMoisture ?? null,
        temperature: be.sensorData?.temperature ?? null,
        rainDetected: be.sensorData?.rainDetected ?? null,
        createdAt: be.createdAt,
    };
}
export function useRelayLogs(limit = 10) {
    const query = useQuery({
        queryKey: ['relay-logs', { limit }],
        queryFn: () => fetchRelayLogs(limit, 0),
    });
    const mapped = useMemo(() => {
        if (!query.data)
            return [];
        return query.data.data.map(mapRelay);
    }, [query.data]);
    return {
        relayLogs: mapped,
        loading: query.isLoading,
        error: query.error ? query.error.message : null,
        refetch: query.refetch,
    };
}
