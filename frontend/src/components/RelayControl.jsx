'use client';

import { useState } from 'react';
import { Loader2, Power, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { publishRelayCommand, fetchCommand } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function RelayControl({ canControl, deviceId }) {
    const queryClient = useQueryClient();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [desiredState, setDesiredState] = useState(false);

    const sendCommand = async () => {
        setError('');
        setMessage('');
        setSubmitting(true);
        try {
            if (typeof deviceId !== 'string' || !deviceId) {
                throw new Error('Chưa chọn thiết bị để điều khiển');
            }
            const result = await publishRelayCommand({
                relayStatus: desiredState,
                deviceId,
                reason: 'Operator requested relay state from dashboard',
            });
            let command = result.command;
            const deadline = Date.now() + 18_000;
            while (command && ['PENDING', 'SENT', 'ACKNOWLEDGED'].includes(command.status) && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const current = await fetchCommand(command.id);
                command = current.command;
            }
            if (command?.status === 'SUCCEEDED') {
                setMessage(`Thiết bị ${deviceId} đã xác nhận ${desiredState ? 'bật' : 'tắt'} bơm.`);
            } else if (command?.status === 'REJECTED') {
                setError(command.resultReason || 'Thiết bị từ chối lệnh');
            } else if (command?.status === 'TIMED_OUT') {
                setError('Hết thời gian chờ xác nhận; trạng thái bơm chưa được xác nhận.');
            } else {
                setMessage('Đã gửi lệnh nhưng chưa nhận xác nhận; trạng thái bơm hiện chưa xác định.');
            }
            await queryClient.invalidateQueries({ queryKey: ['relay-logs'] });
        } catch (commandError) {
            setError(commandError instanceof Error ? commandError.message : 'Không thể gửi lệnh relay');
        } finally {
            setSubmitting(false);
            setConfirmOpen(false);
        }
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className="h-5 w-5 text-blue-500" />
            Điều khiển bơm
          </CardTitle>
          <CardDescription>
            Chọn rõ thao tác cần thực hiện. Lệnh chỉ được xác nhận thành công khi ESP32 gửi ACK.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={submitting || !canControl}
              onClick={() => {
                  setDesiredState(true);
                  setConfirmOpen(true);
              }}
            >
              {submitting && desiredState ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Bật bơm
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting || !canControl}
              onClick={() => {
                  setDesiredState(false);
                  setConfirmOpen(true);
              }}
            >
              {submitting && !desiredState ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Tắt bơm
            </Button>
          </div>
          {!canControl && (
            <p className="text-sm text-muted-foreground">
              Chưa thể điều khiển: cần chọn thiết bị và tài khoản có quyền vận hành.
            </p>
          )}
          {error && (
            <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" />
              {error}
            </div>
          )}
          {message && <p role="status" className="text-sm text-green-600">{message}</p>}
        </CardContent>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Xác nhận {desiredState ? 'bật' : 'tắt'} bơm của {deviceId || 'thiết bị chưa chọn'}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Hệ thống sẽ gửi lệnh đến đúng thiết bị đã chọn và chờ ESP32 xác nhận.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Hủy</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                    event.preventDefault();
                    void sendCommand();
                }}
                disabled={submitting}
              >
                {submitting ? 'Đang gửi...' : 'Xác nhận'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    );
}
