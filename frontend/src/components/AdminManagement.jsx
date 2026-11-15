'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { IrrigationRuleForm } from '@/components/IrrigationRuleForm';
import {
    createAccount,
    fetchDevices,
    listAccounts,
    registerDevice,
    transitionDeviceLifecycle,
    updateAccount,
} from '@/lib/api';

const ROLES = [
    { value: 'ADMIN', label: 'Quản trị viên' },
    { value: 'OPERATOR', label: 'Vận hành' },
    { value: 'VIEWER', label: 'Chỉ xem' },
];

const LIFECYCLE_TRANSITIONS = {
    REGISTERED: ['PROVISIONED', 'REVOKED'],
    PROVISIONED: ['ACTIVE', 'REVOKED'],
    ACTIVE: ['FAULT', 'MAINTENANCE', 'REVOKED'],
    FAULT: ['ACTIVE', 'MAINTENANCE', 'REVOKED'],
    MAINTENANCE: ['ACTIVE', 'REVOKED'],
    REVOKED: ['DECOMMISSIONED'],
    DECOMMISSIONED: [],
};

const LIFECYCLE_LABELS = {
    REGISTERED: 'Đã đăng ký',
    PROVISIONED: 'Đã cấu hình',
    ACTIVE: 'Đang hoạt động',
    FAULT: 'Đang lỗi',
    MAINTENANCE: 'Đang bảo trì',
    REVOKED: 'Đã thu hồi',
    DECOMMISSIONED: 'Đã ngừng sử dụng',
};

const ROLE_DESCRIPTIONS = {
    ADMIN: 'Quản lý tài khoản, thiết bị, phân quyền và cấu hình.',
    OPERATOR: 'Xem dữ liệu, xử lý cảnh báo và điều khiển relay.',
    VIEWER: 'Chỉ xem dữ liệu và trạng thái thiết bị.',
};

function toggleValue(values, value) {
    return values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
}

function DeviceCheckboxes({ devices, selected, onChange, name }) {
    if (devices.length === 0) {
        return <p className="text-xs text-muted-foreground">Chưa có thiết bị để gán.</p>;
    }

    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {devices.map((device) => (
          <label key={device.deviceId} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={device.deviceId}
              checked={selected.includes(device.deviceId)}
              onChange={() => onChange(toggleValue(selected, device.deviceId))}
            />
            <span>{device.deviceId}</span>
            <span className="text-xs text-muted-foreground">({device.lifecycle})</span>
          </label>
        ))}
      </div>
    );
}

function UserAccessEditor({ account, devices, currentUserId, saving, onSave }) {
    const [role, setRole] = useState(account.role);
    const [active, setActive] = useState(account.active);
    const [deviceIds, setDeviceIds] = useState(account.deviceIds ?? []);

    useEffect(() => {
        setRole(account.role);
        setActive(account.active);
        setDeviceIds(account.deviceIds ?? []);
    }, [account]);

    return (
      <form
        onSubmit={(event) => {
            event.preventDefault();
            void onSave(account.id, { role, active, deviceIds });
        }}
        className="space-y-3 rounded-md border p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{account.email}</p>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[account.role]}</p>
          </div>
          <span className={account.active ? 'text-sm text-green-600' : 'text-sm text-destructive'}>
            {account.active ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Vai trò
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
            >
              {ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={active}
              disabled={account.id === currentUserId && active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Tài khoản được phép đăng nhập
          </label>
        </div>
        {account.id === currentUserId && (
          <p className="text-xs text-muted-foreground">Không thể vô hiệu hóa chính tài khoản đang đăng nhập.</p>
        )}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Thiết bị được gán</legend>
          <DeviceCheckboxes
            devices={devices}
            selected={deviceIds}
            onChange={setDeviceIds}
            name={`devices-${account.id}`}
          />
        </fieldset>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          {saving ? 'Đang lưu...' : 'Lưu quyền và thiết bị'}
        </button>
      </form>
    );
}

function DeviceLifecycleEditor({ device, saving, onTransition }) {
    const transitions = LIFECYCLE_TRANSITIONS[device.lifecycle] ?? [];
    const [nextLifecycle, setNextLifecycle] = useState(transitions[0] ?? '');
    const [reason, setReason] = useState('');

    useEffect(() => {
        setNextLifecycle((LIFECYCLE_TRANSITIONS[device.lifecycle] ?? [])[0] ?? '');
    }, [device.lifecycle]);

    return (
      <div className="space-y-3">
      <form
        onSubmit={(event) => {
            event.preventDefault();
            void onTransition(device.deviceId, nextLifecycle, reason);
        }}
        className="space-y-2 rounded-md border p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{device.deviceId}</p>
            <p className="text-xs text-muted-foreground">
              {device.deviceType}{device.zone ? ` · ${device.zone}` : ''}
            </p>
          </div>
          <span className="rounded border px-2 py-1 text-xs">
            {LIFECYCLE_LABELS[device.lifecycle] ?? device.lifecycle}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {device.online ? 'Đang kết nối' : 'Mất kết nối'}
          {device.lastSeen ? ` · Heartbeat ${new Date(device.lastSeen).toLocaleString()}` : ' · Chưa nhận heartbeat'}
        </p>
        {transitions.length > 0 ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm">
                Trạng thái tiếp theo
                <select
                  value={nextLifecycle}
                  onChange={(event) => setNextLifecycle(event.target.value)}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                >
                  {transitions.map((lifecycle) => (
                    <option key={lifecycle} value={lifecycle}>
                      {LIFECYCLE_LABELS[lifecycle] ?? lifecycle}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Lý do thay đổi
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={3}
                  maxLength={500}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                  placeholder="Nhập lý do để ghi audit"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={saving || !nextLifecycle || reason.trim().length < 3}
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              {saving ? 'Đang cập nhật...' : 'Lưu chuyển trạng thái'}
            </button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Thiết bị đã ngừng sử dụng; không còn chuyển trạng thái.</p>
        )}
      </form>
      </div>
    );
}

export function AdminManagement({ section, currentUserId, onCurrentUserUpdated, selectedDeviceId = '' }) {
    const queryClient = useQueryClient();
    const accountsQuery = useQuery({
        queryKey: ['admin-accounts'],
        queryFn: listAccounts,
    });
    const devicesQuery = useQuery({
        queryKey: ['admin-devices'],
        queryFn: fetchDevices,
        refetchInterval: 10000,
    });
    const [accountForm, setAccountForm] = useState({
        email: '',
        password: '',
        role: 'VIEWER',
        deviceIds: [],
    });
    const [deviceForm, setDeviceForm] = useState({
        deviceId: '',
        deviceType: 'ESP32',
        zone: '',
        assignedUserIds: [],
    });
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const accounts = accountsQuery.data?.users ?? [];
    const devices = devicesQuery.data?.devices ?? [];

    const refreshAdminData = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['admin-accounts'] }),
            queryClient.invalidateQueries({ queryKey: ['admin-devices'] }),
        ]);
    };

    const handleCreateAccount = async (event) => {
        event.preventDefault();
        setBusy('create-account');
        setError('');
        setMessage('');
        try {
            await createAccount(accountForm);
            setAccountForm({ email: '', password: '', role: 'VIEWER', deviceIds: [] });
            await refreshAdminData();
            setMessage('Đã tạo tài khoản. Người dùng có thể đăng nhập bằng email và mật khẩu được cấp.');
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : 'Không thể tạo tài khoản');
        } finally {
            setBusy('');
        }
    };

    const handleSaveAccount = async (id, changes) => {
        setBusy(`account-${id}`);
        setError('');
        setMessage('');
        try {
            const result = await updateAccount(id, changes);
            await refreshAdminData();
            if (id === currentUserId && result.user) {
                onCurrentUserUpdated?.(result.user);
            }
            setMessage('Đã cập nhật vai trò, trạng thái và thiết bị được gán.');
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : 'Không thể cập nhật tài khoản');
        } finally {
            setBusy('');
        }
    };

    const handleRegisterDevice = async (event) => {
        event.preventDefault();
        setBusy('register-device');
        setError('');
        setMessage('');
        try {
            await registerDevice(deviceForm);
            setDeviceForm({ deviceId: '', deviceType: 'ESP32', zone: '', assignedUserIds: [] });
            await refreshAdminData();
            setMessage('Đã đăng ký thiết bị với trạng thái REGISTERED.');
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : 'Không thể đăng ký thiết bị');
        } finally {
            setBusy('');
        }
    };

    const handleLifecycleTransition = async (deviceId, lifecycle, reason) => {
        setBusy(`device-${deviceId}`);
        setError('');
        setMessage('');
        try {
            const result = await transitionDeviceLifecycle(deviceId, lifecycle, reason.trim());
            await refreshAdminData();
            setMessage(result.brokerCredentialRevocationRequired
                ? 'Đã thu hồi thiết bị. Hãy thu hồi broker credentials của thiết bị trên MQTT broker.'
                : `Đã chuyển ${deviceId} sang ${LIFECYCLE_LABELS[lifecycle] ?? lifecycle}.`);
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : 'Không thể cập nhật vòng đời thiết bị');
        } finally {
            setBusy('');
        }
    };

    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>
            {section === 'accounts' ? 'Tài khoản và phân quyền' : 'Quản lý thiết bị và tưới'}
          </CardTitle>
          <CardDescription>
            {section === 'accounts'
                ? 'Tạo tài khoản, quản lý vai trò và giới hạn thiết bị được phép truy cập.'
                : 'Đăng ký thiết bị, quản lý vòng đời và cấu hình tưới cho thiết bị đang chọn.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {(error || accountsQuery.error || devicesQuery.error) && (
            <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
              {error || accountsQuery.error?.message || devicesQuery.error?.message}
            </p>
          )}
          {message && <p role="status" className="rounded-md border p-3 text-sm text-green-700">{message}</p>}

          {section === 'accounts' && (
            <>
          <section className="space-y-3">
            <div>
              <h3 className="font-semibold">Tạo tài khoản</h3>
              <p className="text-sm text-muted-foreground">Mật khẩu phải có ít nhất 12 ký tự. Có thể gán nhiều thiết bị.</p>
            </div>
            <form onSubmit={handleCreateAccount} className="grid gap-3 rounded-md border p-4 lg:grid-cols-2">
              <label className="text-sm">
                Email
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={accountForm.email}
                  onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Mật khẩu khởi tạo
                <input
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={accountForm.password}
                  onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Vai trò
                <select
                  value={accountForm.role}
                  onChange={(event) => setAccountForm({ ...accountForm, role: event.target.value })}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                >
                  {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </select>
              </label>
              <p className="self-end text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[accountForm.role]}</p>
              <fieldset className="space-y-2 lg:col-span-2">
                <legend className="text-sm font-medium">Gán thiết bị ban đầu</legend>
                <DeviceCheckboxes
                  devices={devices}
                  selected={accountForm.deviceIds}
                  onChange={(deviceIds) => setAccountForm({ ...accountForm, deviceIds })}
                  name="new-account-devices"
                />
              </fieldset>
              <button
                type="submit"
                disabled={busy !== ''}
                className="w-fit rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {busy === 'create-account' ? 'Đang tạo...' : 'Tạo tài khoản'}
              </button>
            </form>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="font-semibold">Tài khoản, phân quyền và gán thiết bị</h3>
              <p className="text-sm text-muted-foreground">Vô hiệu hóa tài khoản sẽ thu hồi các phiên đăng nhập hiện tại.</p>
            </div>
            {accountsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Đang tải tài khoản...</p>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có tài khoản.</p>
            ) : (
              <div className="space-y-3">
                {accounts.map((account) => (
                  <UserAccessEditor
                    key={account.id}
                    account={account}
                    devices={devices}
                    currentUserId={currentUserId}
                    saving={busy !== ''}
                    onSave={handleSaveAccount}
                  />
                ))}
              </div>
            )}
          </section>

            </>
          )}

          {section === 'devices' && (
            <>
          <section className="space-y-3">
            <div>
              <h3 className="font-semibold">2. Đăng ký thiết bị</h3>
              <p className="text-sm text-muted-foreground">
                Khai báo ESP32 vào danh mục. Thiết bị mới bắt đầu ở trạng thái “Đã đăng ký”; đăng ký chưa tự cấu hình MQTT.
              </p>
            </div>
            <form onSubmit={handleRegisterDevice} className="grid gap-3 rounded-md border p-4 sm:grid-cols-2">
              <label className="text-sm">
                Device ID
                <input
                  required
                  maxLength={100}
                  pattern="[A-Za-z0-9._-]+"
                  value={deviceForm.deviceId}
                  onChange={(event) => setDeviceForm({ ...deviceForm, deviceId: event.target.value })}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                  placeholder="esp32-02"
                />
              </label>
              <label className="text-sm">
                Loại thiết bị
                <input
                  required
                  maxLength={100}
                  value={deviceForm.deviceType}
                  onChange={(event) => setDeviceForm({ ...deviceForm, deviceType: event.target.value })}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Khu vực (không bắt buộc)
                <input
                  maxLength={100}
                  value={deviceForm.zone}
                  onChange={(event) => setDeviceForm({ ...deviceForm, zone: event.target.value })}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Gán người dùng</legend>
                {accounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Tạo tài khoản trước khi gán người dùng.</p>
                ) : (
                  <div className="grid gap-2">
                    {accounts.filter((account) => account.active).map((account) => (
                      <label key={account.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={deviceForm.assignedUserIds.includes(account.id)}
                          onChange={() => setDeviceForm({
                              ...deviceForm,
                              assignedUserIds: toggleValue(deviceForm.assignedUserIds, account.id),
                          })}
                        />
                        {account.email}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <button
                type="submit"
                disabled={busy !== ''}
                className="w-fit rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 sm:col-span-2"
              >
                {busy === 'register-device' ? 'Đang đăng ký...' : 'Đăng ký thiết bị'}
              </button>
            </form>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="font-semibold">3. Quản lý vòng đời</h3>
              <p className="text-sm text-muted-foreground">
                Cấu hình thiết bị và MQTT trước khi chuyển sang “Đã cấu hình”, sau đó mới kích hoạt.
                Mỗi lần chuyển cần lý do để ghi lịch sử; thu hồi vẫn cần thu hồi MQTT credentials riêng.
              </p>
            </div>
            {devicesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Đang tải thiết bị...</p>
            ) : devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa đăng ký thiết bị.</p>
            ) : (
              <div className="space-y-3">
                {devices.map((device) => (
                  <DeviceLifecycleEditor
                    key={device.deviceId}
                    device={device}
                    saving={busy !== ''}
                    onTransition={handleLifecycleTransition}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="font-semibold">4. Quy tắc tưới tự động</h3>
              <p className="text-sm text-muted-foreground">
                Cấu hình chỉ dành cho thiết bị đang chọn ở đầu trang; lưu xong cần chờ ESP32 xác nhận phiên bản.
              </p>
            </div>
            {!selectedDeviceId ? (
              <p className="rounded-md border p-4 text-sm text-muted-foreground">
                Chọn một thiết bị đã đăng ký ở mục “Chọn thiết bị và xem trạng thái” để cấu hình tưới.
              </p>
            ) : devicesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Đang tải thiết bị được chọn...</p>
            ) : (() => {
                const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId);
                if (!selectedDevice) {
                    return (
                      <p className="rounded-md border p-4 text-sm text-muted-foreground">
                        Thiết bị {selectedDeviceId} chưa có trong danh mục quản trị.
                      </p>
                    );
                }
                if (['REVOKED', 'DECOMMISSIONED'].includes(selectedDevice.lifecycle)) {
                    return (
                      <p className="rounded-md border p-4 text-sm text-muted-foreground">
                        Thiết bị {selectedDeviceId} đã ngừng hoạt động; không thể cấu hình tưới.
                      </p>
                    );
                }
                return (
                  <div className="space-y-3">
                    <p className="rounded-md border bg-muted/40 p-3 text-sm">
                      Đang cấu hình cho <strong>{selectedDevice.deviceId}</strong>
                      {selectedDevice.zone ? ` · ${selectedDevice.zone}` : ''}.
                    </p>
                    <IrrigationRuleForm deviceId={selectedDevice.deviceId} />
                  </div>
                );
            })()}
          </section>
            </>
          )}
        </CardContent>
      </Card>
    );
}
