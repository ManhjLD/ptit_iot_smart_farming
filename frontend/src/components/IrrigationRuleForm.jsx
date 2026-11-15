'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchIrrigationRule, saveIrrigationRule } from '@/lib/api';

const DEFAULT_RULE = {
    dryStartMoisturePercent: 10,
    wetStopMoisturePercent: 35,
    confirmationSamples: 3,
    restMinutes: 5,
};

export function IrrigationRuleForm({ deviceId }) {
    const queryClient = useQueryClient();
    const [rule, setRule] = useState(DEFAULT_RULE);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const query = useQuery({
        queryKey: ['irrigation-rule', deviceId],
        queryFn: () => fetchIrrigationRule(deviceId),
        enabled: Boolean(deviceId),
        refetchInterval: (currentQuery) => {
            const currentRule = currentQuery.state.data?.rule;
            return currentRule && currentRule.appliedVersion !== currentRule.version ? 5000 : false;
        },
    });

    useEffect(() => {
        if (query.data?.rule) {
            const { dryStartMoisturePercent, wetStopMoisturePercent, confirmationSamples, restMinutes } = query.data.rule;
            setRule({ dryStartMoisturePercent, wetStopMoisturePercent, confirmationSamples, restMinutes });
        }
    }, [query.data]);

    const update = (key) => (event) => {
        setSaved(false);
        setRule((current) => ({ ...current, [key]: event.target.valueAsNumber }));
    };

    const submit = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        setSaved(false);
        try {
            await saveIrrigationRule(deviceId, rule);
            await queryClient.invalidateQueries({ queryKey: ['irrigation-rule', deviceId] });
            setSaved(true);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Không thể lưu quy tắc tưới');
        } finally {
            setSaving(false);
        }
    };

    if (query.isLoading) return <p className="text-xs text-muted-foreground">Đang tải quy tắc tưới...</p>;
    if (query.error) return <p role="alert" className="text-xs text-destructive">{query.error.message}</p>;

    return (
      <form onSubmit={submit} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <strong>Ngưỡng tưới tự động</strong>
          <p className="text-xs text-muted-foreground">
            Backend gửi cấu hình MQTT tới thiết bị đã chọn. Chỉ xem là đã áp dụng khi firmware xử lý cấu hình và xác nhận đúng phiên bản.
          </p>
          {query.data?.rule && (
            <p className="text-xs text-muted-foreground">
              {query.data.rule.appliedVersion === query.data.rule.version
                ? `Thiết bị đã áp dụng phiên bản ${query.data.rule.version}.`
                : `Đang chờ ESP32 xác nhận phiên bản ${query.data.rule.version}.`}
            </p>
          )}
        </div>
        <label className="text-xs">
          Bắt đầu tưới khi độ ẩm đất xuống đến (%)
          <input type="number" min="0" max="40" step="1" required
            value={rule.dryStartMoisturePercent} onChange={update('dryStartMoisturePercent')}
            className="mt-1 block w-full rounded border bg-background px-2 py-1 text-sm" />
        </label>
        <label className="text-xs">
          Dừng tưới khi độ ẩm đất tăng đến (%)
          <input type="number" min="5" max="80" step="1" required
            value={rule.wetStopMoisturePercent} onChange={update('wetStopMoisturePercent')}
            className="mt-1 block w-full rounded border bg-background px-2 py-1 text-sm" />
        </label>
        <label className="text-xs">
          Số mẫu khô liên tiếp để xác nhận
          <input type="number" min="1" max="10" step="1" required
            value={rule.confirmationSamples} onChange={update('confirmationSamples')}
            className="mt-1 block w-full rounded border bg-background px-2 py-1 text-sm" />
        </label>
        <label className="text-xs">
          Thời gian nghỉ bơm (phút)
          <input type="number" min="1" max="60" step="1" required
            value={rule.restMinutes} onChange={update('restMinutes')}
            className="mt-1 block w-full rounded border bg-background px-2 py-1 text-sm" />
        </label>
        {rule.dryStartMoisturePercent >= rule.wetStopMoisturePercent && (
          <p role="alert" className="text-xs text-destructive sm:col-span-2">
            Ngưỡng dừng phải cao hơn ngưỡng bắt đầu để tạo hysteresis.
          </p>
        )}
        {error && <p role="alert" className="text-xs text-destructive sm:col-span-2">{error}</p>}
        {saved && <p role="status" className="text-xs text-green-600 sm:col-span-2">Đã lưu và gửi quy tắc qua MQTT; đang chờ ESP32 xác nhận phiên bản.</p>}
        <button type="submit" disabled={saving || rule.dryStartMoisturePercent >= rule.wetStopMoisturePercent}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50 sm:col-span-2">
          {saving ? 'Đang lưu...' : 'Lưu và gửi quy tắc'}
        </button>
      </form>
    );
}
