'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { acknowledgeAlert, fetchAlerts, resolveAlert } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AlertList({ canAcknowledge }) {
    const queryClient = useQueryClient();
    const [error, setError] = useState('');
    const query = useQuery({
        queryKey: ['alerts'],
        queryFn: () => fetchAlerts(),
        refetchInterval: 10000,
    });
    const alerts = query.data?.alerts?.filter((alert) => alert.status !== 'RESOLVED') ?? [];

    const handleAction = async (alert, action) => {
        setError('');
        try {
            if (action === 'ack') {
                await acknowledgeAlert(alert.id, 'Acknowledged from dashboard');
            } else {
                await resolveAlert(alert.id, 'Resolved from dashboard');
            }
            await queryClient.invalidateQueries({ queryKey: ['alerts'] });
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : 'Alert update failed');
        }
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
          <CardDescription>Cảnh báo đang hoạt động và trạng thái xử lý.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {query.isLoading && <p className="text-sm text-muted-foreground">Đang tải cảnh báo...</p>}
          {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {!query.isLoading && !query.error && alerts.length === 0 && (
            <p className="text-sm text-muted-foreground">Không có cảnh báo đang hoạt động.</p>
          )}
          {alerts.map((alert) => (
            <div key={alert.id} className="rounded-md border p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{alert.ruleCode} · {alert.severity}</strong>
                <span className="text-xs text-muted-foreground">{alert.deviceId} · {alert.status}</span>
              </div>
              <p className="mt-1 text-sm">{alert.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Số lần: {alert.occurrenceCount} · Lần cuối: {new Date(alert.lastSeen).toLocaleString()}
              </p>
              {canAcknowledge && (
                <div className="mt-2 flex gap-2">
                  {alert.status === 'OPEN' && (
                    <button type="button" onClick={() => handleAction(alert, 'ack')} className="rounded border px-2 py-1 text-xs">
                      Xác nhận
                    </button>
                  )}
                  <button type="button" onClick={() => handleAction(alert, 'resolve')} className="rounded border px-2 py-1 text-xs">
                    Đóng khi đã khắc phục
                  </button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    );
}
