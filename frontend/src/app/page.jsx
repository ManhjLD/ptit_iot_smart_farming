'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSensorData } from '@/hooks/useSensorData';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { StatsCard } from '@/components/StatsCard';
import { RelayLogCard } from '@/components/RelayLogCard';
import { RainStatusCard } from '@/components/RainStatusCard';
import { WaterLevelStatusCard } from '@/components/WaterLevelStatusCard';
import { RefreshCw, Database, Droplets, Home, Thermometer, Cpu, Bell, History, Users } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, } from '@/components/ui/card';
import { HealthStrip } from '@/components/HealthStrip';
import { RelayControl } from '@/components/RelayControl';
import { Badge } from '@/components/ui/badge';
import { Droplets as DropletsIcon, Sprout } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AlertList } from '@/components/AlertList';
import { AdminManagement } from '@/components/AdminManagement';
import { clearAuthToken, fetchCurrentUser, getAuthToken, login, logout } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

const LIFECYCLE_LABELS = {
    REGISTERED: 'Đã đăng ký',
    PROVISIONED: 'Đã cấu hình',
    ACTIVE: 'Đang hoạt động',
    FAULT: 'Đang lỗi',
    MAINTENANCE: 'Đang bảo trì',
    REVOKED: 'Đã thu hồi',
    DECOMMISSIONED: 'Đã ngừng sử dụng',
};

export default function Dashboard() {
    const [user, setUser] = useState(null);
    const [checkingSession, setCheckingSession] = useState(true);
    const [authError, setAuthError] = useState('');
    const queryClient = useQueryClient();

    useEffect(() => {
        const token = getAuthToken();
        if (!token) {
            setCheckingSession(false);
            return;
        }
        fetchCurrentUser()
            .then(({ user: currentUser }) => setUser(currentUser))
            .catch(() => clearAuthToken())
            .finally(() => setCheckingSession(false));
    }, []);

    const handleLogin = async (event) => {
        event.preventDefault();
        setAuthError('');
        const formData = new FormData(event.currentTarget);
        try {
            const result = await login(String(formData.get('email')), String(formData.get('password')));
            setUser(result.user);
        } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Đăng nhập thất bại');
        }
    };

    const handleLogout = async () => {
        try {
            await logout();
        } finally {
            await queryClient.clear();
            setUser(null);
        }
    };

    if (checkingSession) {
        return <div className="min-h-screen flex items-center justify-center">Đang kiểm tra phiên đăng nhập...</div>;
    }
    if (!user) {
        return (
          <main className="min-h-screen flex items-center justify-center bg-background px-4">
            <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm">
              <h1 className="text-xl font-semibold">Đăng nhập Smart Farming</h1>
              <label className="block text-sm font-medium">
                Email
                <input name="email" type="email" autoComplete="username" required className="mt-1 block w-full rounded-md border bg-background px-3 py-2" />
              </label>
              <label className="block text-sm font-medium">
                Mật khẩu
                <input name="password" type="password" autoComplete="current-password" required className="mt-1 block w-full rounded-md border bg-background px-3 py-2" />
              </label>
              {authError && <p role="alert" className="text-sm text-destructive">{authError}</p>}
              <button type="submit" className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground">Đăng nhập</button>
            </form>
          </main>
        );
    }
    return <DashboardContent
      user={user}
      onLogout={handleLogout}
      onUserUpdated={setUser}
    />;
}

function DashboardContent({ user, onLogout, onUserUpdated }) {
    const PAGE_SIZE = 100;
    const [activeSection, setActiveSection] = useState('overview');
    const [selectedDeviceId, setSelectedDeviceId] = useState('');
    const [controlDeviceId, setControlDeviceId] = useState('');
    const { data, loading, error, refetch } = useSensorData(
        PAGE_SIZE,
        { deviceId: selectedDeviceId || undefined },
        ['overview', 'sensors'].includes(activeSection),
    );
    const [deviceStatus, setDeviceStatus] = useState(null);
    const [registeredDevices, setRegisteredDevices] = useState([]);
    const [deviceStatusError, setDeviceStatusError] = useState('');
    const controlDevice = registeredDevices.find((device) => device.deviceId === controlDeviceId)
        ?? registeredDevices.find((device) => device.deviceId === deviceStatus?.deviceId)
        ?? registeredDevices.find((device) => device.online)
        ?? registeredDevices[0]
        ?? null;
    const sections = [
        { id: 'overview', label: 'Tổng quan', icon: Home },
        { id: 'sensors', label: 'Dữ liệu cảm biến', icon: Thermometer },
        { id: 'devices', label: 'Thiết bị & tưới', icon: Cpu },
        { id: 'alerts', label: 'Cảnh báo', icon: Bell },
        { id: 'history', label: 'Nhật ký relay', icon: History },
        ...(user.role === 'ADMIN'
            ? [{ id: 'accounts', label: 'Tài khoản & quyền', icon: Users }]
            : []),
    ];
    const sectionInfo = {
        overview: ['Tổng quan vận hành', 'Tình trạng hệ thống và các chỉ số mới nhất.'],
        sensors: ['Dữ liệu cảm biến', 'Theo dõi chỉ số, xu hướng và chất lượng dữ liệu theo thiết bị.'],
        devices: ['Thiết bị & tưới', 'Chọn một thiết bị, xem trạng thái, điều khiển bơm và quản lý cấu hình tưới.'],
        alerts: ['Cảnh báo', 'Theo dõi, xác nhận và xử lý các cảnh báo đang hoạt động.'],
        history: ['Nhật ký relay', 'Lịch sử bật/tắt bơm và thời lượng vận hành.'],
        accounts: ['Tài khoản & quyền', 'Tạo tài khoản, phân quyền và gán phạm vi thiết bị.'],
    };
    const getApiRoot = () => {
        const configured = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
        const normalized = configured.replace(/\/+$/, '').replace(/\/api$/, '');
        return normalized || 'http://localhost:3001';
    };
    const fetchDeviceControlData = useCallback(async () => {
        try {
            const root = getApiRoot();
            const token = getAuthToken();
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const [statusResponse, devicesResponse] = await Promise.all([
                fetch(`${root}/api/device/status`, { cache: 'no-store', headers }),
                fetch(`${root}/api/device/devices`, { cache: 'no-store', headers }),
            ]);
            if (!statusResponse.ok) {
                throw new Error(`Không tải được trạng thái thiết bị (${statusResponse.status})`);
            }
            if (!devicesResponse.ok) {
                throw new Error(`Không tải được danh mục thiết bị (${devicesResponse.status})`);
            }
            const status = await statusResponse.json();
            setDeviceStatus({
                deviceId: status.deviceId,
            });
            setDeviceStatusError('');
            const devices = await devicesResponse.json();
            setRegisteredDevices(devices.devices ?? []);
        }
        catch (error) {
            setDeviceStatusError(error instanceof Error ? error.message : 'Không thể tải trạng thái thiết bị');
        }
    }, []);
    useEffect(() => {
        if (!['overview', 'devices'].includes(activeSection)) return undefined;
        void fetchDeviceControlData();
        const timer = setInterval(() => void fetchDeviceControlData(), 5000);
        return () => clearInterval(timer);
    }, [activeSection, fetchDeviceControlData]);
    useEffect(() => {
        if (user.role !== 'ADMIN' && activeSection === 'accounts') {
            setActiveSection('overview');
        }
    }, [activeSection, user.role]);
    const isStale = data.length > 0 &&
        Date.now() - new Date(data[0].createdAt).getTime() >
            10 * 60 * 1000;
    const [sectionTitle, sectionDescription] = sectionInfo[activeSection] ?? sectionInfo.overview;
    return (<div className="min-h-screen bg-background">
      
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-primary p-2 text-primary-foreground"><Droplets className="h-6 w-6" /></span>
            <div>
              <h1 className="text-lg font-semibold">Smart Farming</h1>
              <p className="text-xs text-muted-foreground">Vận hành và giám sát nông trại</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{user.email}</p>
              <p className="text-xs text-muted-foreground">{user.role}</p>
            </div>
            <ThemeToggle />
            <button type="button" onClick={onLogout} className="rounded-md border px-3 py-2 text-sm">
              Đăng xuất
            </button>
          </div>
        </div>
      </header>

      
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <nav aria-label="Điều hướng nghiệp vụ" className="flex gap-2 overflow-x-auto rounded-xl border bg-card p-2 lg:flex-col">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={activeSection === id ? 'page' : undefined}
                onClick={() => setActiveSection(id)}
                className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    activeSection === id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-4 hidden rounded-xl border bg-card p-4 lg:block">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Thiết bị</p>
            <p className="mt-2 text-2xl font-semibold">{registeredDevices.filter((device) => device.online).length}</p>
            <p className="text-xs text-muted-foreground">đang trực tuyến / {registeredDevices.length} đã đăng ký</p>
          </div>
        </aside>

        <main className="min-w-0 space-y-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary">Quản lý nông trại</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{sectionTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{sectionDescription}</p>
          </div>
        
        {activeSection === 'overview' && (
          <HealthStrip />
        )}
        {activeSection === 'alerts' && (
          <AlertList canAcknowledge={user.role === 'ADMIN' || user.role === 'OPERATOR'} />
        )}

        {activeSection === 'devices' && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>1. Chọn thiết bị và xem trạng thái</CardTitle>
            <CardDescription>
              Mọi thao tác điều khiển bên dưới sẽ áp dụng cho thiết bị đang chọn; không có lựa chọn “tất cả thiết bị”.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {deviceStatusError && <p role="alert" className="mb-3 text-sm text-destructive">{deviceStatusError}</p>}
            {!deviceStatus && !deviceStatusError && registeredDevices.length === 0 && (
              <p role="status" className="mb-3 text-sm text-muted-foreground">Đang tải trạng thái thiết bị...</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Thiết bị đang vận hành
                <select
                  value={controlDevice?.deviceId ?? ''}
                  onChange={(event) => setControlDeviceId(event.target.value)}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
                >
                  <option value="">Chưa có thiết bị đã đăng ký</option>
                  {registeredDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.deviceId} — {device.online ? 'Đang kết nối' : 'Mất kết nối'}
                    </option>
                  ))}
                </select>
              </label>
              {controlDevice ? (
                <div className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Vòng đời</p>
                    <p className="font-medium">
                      {LIFECYCLE_LABELS[controlDevice.lifecycle] ?? controlDevice.lifecycle}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Kết nối</p>
                    <p className={controlDevice.online ? 'font-medium text-green-600' : 'font-medium text-destructive'}>
                      {controlDevice.online ? 'Đang kết nối' : 'Mất kết nối'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Relay gần nhất</p>
                    <p className="font-medium">{controlDevice.relayState || 'Chưa xác nhận'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Heartbeat</p>
                    <p className="font-medium">
                      {controlDevice.lastSeen
                        ? format(new Date(controlDevice.lastSeen), 'dd/MM/yyyy HH:mm:ss')
                        : 'Chưa nhận'}
                    </p>
                  </div>
                  {controlDevice.lastError && (
                    <p className="col-span-2 text-destructive">{controlDevice.lastError}</p>
                  )}
                </div>
              ) : (
                <p className="rounded-md border p-3 text-sm text-muted-foreground">
                  Chưa có thiết bị trong danh mục. Quản trị viên cần đăng ký ESP32 ở phần quản lý bên dưới.
                </p>
              )}
            </div>
            {registeredDevices.length > 1 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Có {registeredDevices.length} thiết bị trong danh mục; hãy kiểm tra Device ID trước khi gửi lệnh.
              </p>
            )}
          </CardContent>
        </Card>
        )}

        {user.role === 'ADMIN' && activeSection === 'accounts' && (
          <AdminManagement
            section="accounts"
            currentUserId={user.id}
            onCurrentUserUpdated={onUserUpdated}
          />
        )}
        {user.role === 'ADMIN' && activeSection === 'devices' && (
          <AdminManagement
            section="devices"
            selectedDeviceId={controlDevice?.deviceId ?? ''}
            currentUserId={user.id}
            onCurrentUserUpdated={onUserUpdated}
          />
        )}

        {activeSection === 'overview' && (
          <section className="space-y-6">
            {loading && <p role="status" className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Đang tải dữ liệu cảm biến...</p>}
            {error && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive bg-card p-4">
                <p className="text-sm text-destructive">Không tải được dữ liệu cảm biến: {error}</p>
                <button type="button" onClick={() => refetch()} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Thử lại</button>
              </div>
            )}
            {!loading && !error && <StatsCard data={data} />}
            <Card>
              <CardHeader>
                <CardTitle>Tình trạng vận hành</CardTitle>
                <CardDescription>Tóm tắt thiết bị và thời điểm nhận dữ liệu gần nhất.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Thiết bị online</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {registeredDevices.filter((device) => device.online).length}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">/ {registeredDevices.length}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Bản ghi đang tải</p>
                  <p className="mt-1 text-2xl font-semibold">{data.length}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Cập nhật cảm biến</p>
                  <p className="mt-1 text-sm font-medium">
                    {data[0]?.createdAt ? format(new Date(data[0].createdAt), 'MMM dd, HH:mm:ss') : 'Chưa có dữ liệu'}
                  </p>
                  {isStale && <Badge className="mt-2" variant="destructive">Dữ liệu cũ hơn 10 phút</Badge>}
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {activeSection === 'sensors' && (
          <>
        {loading && (
          <div role="status" className="mb-6 flex items-center gap-3 rounded-md border p-4 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            Đang tải dữ liệu cảm biến...
          </div>
        )}
        {error && (
          <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive p-4">
            <p className="flex items-center gap-2 text-sm text-destructive">
              <Database className="h-5 w-5" />
              Không tải được dữ liệu cảm biến: {error}
            </p>
            <button type="button" onClick={() => refetch()} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
              Thử lại
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
        <Card>
          <CardHeader>
            <CardTitle>Phạm vi dữ liệu</CardTitle>
            <CardDescription>Chọn thiết bị để lọc các chỉ số và xu hướng cảm biến.</CardDescription>
          </CardHeader>
          <CardContent>
            <label className="block max-w-sm text-sm font-medium">
              Thiết bị
              <select value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)} className="mt-1 block w-full rounded-md border bg-background px-3 py-2">
                <option value="">Tất cả thiết bị</option>
                {registeredDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.deviceId}</option>
                ))}
              </select>
            </label>
          </CardContent>
        </Card>
        <StatsCard data={data}/>

        <div className="grid gap-6 sm:grid-cols-2">
          <RainStatusCard data={data}/>
          <WaterLevelStatusCard data={data}/>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Xu hướng cảm biến</CardTitle>
            <CardDescription>
              Diễn biến nhiệt độ, độ ẩm không khí, độ ẩm đất và nhiệt độ đất.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-96">
            <TimeSeriesChart data={data}/>
          </CardContent>
        </Card>

        
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Tóm tắt dữ liệu</CardTitle>
              {isStale && <Badge variant="destructive">Dữ liệu cũ hơn 10 phút</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <span className="block text-muted-foreground text-sm font-medium">
                  Số bản ghi
                </span>
                <span className="block font-bold text-lg text-foreground">
                  {data.length}
                </span>
              </div>
              <div className="text-center">
                <span className="block text-muted-foreground text-sm font-medium">
                  Khoảng thời gian
                </span>
                <span className="block font-semibold text-sm text-foreground">
                  {data.length > 0
            ? `${format(new Date(data[data.length - 1].createdAt), 'MMM dd')} - ${format(new Date(data[0].createdAt), 'MMM dd')}`
            : 'Chưa có dữ liệu'}
                </span>
              </div>
              {data.length > 0 && (<>
                  
                  <div className="text-center">
                    <span className="text-muted-foreground text-sm font-medium flex items-center justify-center gap-1">
                      <Thermometer className="h-4 w-4 text-red-500"/>{' '}
                      Nhiệt độ không khí
                    </span>
                    <span className="block font-semibold text-sm text-foreground">
                      Thấp nhất{' '}
                      {Math.min(...data.map((d) => d.temperature)).toFixed(1)}
                      °C · cao nhất{' '}
                      {Math.max(...data.map((d) => d.temperature)).toFixed(1)}
                      °C
                    </span>
                  </div>
                  
                  <div className="text-center">
                    <span className="text-muted-foreground text-sm font-medium flex items-center justify-center gap-1">
                      <DropletsIcon className="h-4 w-4 text-blue-500"/>{' '}
                      Độ ẩm không khí
                    </span>
                    <span className="block font-semibold text-sm text-foreground">
                      Thấp nhất{' '}
                      {Math.min(...data.map((d) => d.humidity)).toFixed(1)}
                      % · cao nhất{' '}
                      {Math.max(...data.map((d) => d.humidity)).toFixed(1)}
                      %
                    </span>
                  </div>
                  
                  <div className="text-center">
                    <span className="text-muted-foreground text-sm font-medium flex items-center justify-center gap-1">
                      <Sprout className="h-4 w-4 text-green-600"/>{' '}
                      Độ ẩm đất
                    </span>
                    <span className="block font-semibold text-sm text-foreground">
                      Thấp nhất{' '}
                      {Math.min(...data.map((d) => d.soilMoisture))}%
                      · cao nhất{' '}
                      {Math.max(...data.map((d) => d.soilMoisture))}%
                    </span>
                  </div>
                  
                  <div className="text-center">
                    <span className="text-muted-foreground text-sm font-medium flex items-center justify-center gap-1">
                      <Thermometer className="h-4 w-4 text-amber-500"/>{' '}
                      Nhiệt độ đất
                    </span>
                    <span className="block font-semibold text-sm text-foreground">
                      {(() => {
                const soilTempData = data.filter((d) => d.soilTemperature !== null);
                return soilTempData.length > 0
                    ? `Thấp nhất ${Math.min(...soilTempData.map((d) => d.soilTemperature || 0)).toFixed(1)}°C · 
                           cao nhất ${Math.max(...soilTempData.map((d) => d.soilTemperature || 0)).toFixed(1)}°C`
                    : 'N/A';
            })()}
                    </span>
                  </div>
                  <div className="text-center">
                    <span className="block text-muted-foreground text-sm font-medium">
                      Mức nước phổ biến
                    </span>
                    <span className="block font-semibold text-sm text-foreground">
                      {(() => {
                const waterLevelCounts = data.reduce((acc, item) => {
                    acc[item.waterLevel] =
                        (acc[item.waterLevel] || 0) + 1;
                    return acc;
                }, {});
                const mostCommon = Object.entries(waterLevelCounts).reduce((a, b) => waterLevelCounts[a[0]] >
                    waterLevelCounts[b[0]]
                    ? a
                    : b);
                const percentage = Math.round((mostCommon[1] / data.length) * 100);
                return `${mostCommon[0]} (${percentage}%)`;
            })()}
                    </span>
                  </div>
                </>)}
            </div>
          </CardContent>
        </Card>
          </>
        )}
          </>
        )}

        {activeSection === 'devices' && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 font-semibold">
                {user.role === 'ADMIN' ? '5. Điều khiển bơm' : '2. Điều khiển bơm'}
              </h3>
              <p className="mb-3 text-sm text-muted-foreground">
                Thiết bị nhận lệnh: <strong>{controlDevice?.deviceId ?? 'Chưa chọn'}</strong>
              </p>
              <RelayControl
                canControl={(user.role === 'ADMIN' || user.role === 'OPERATOR') && Boolean(controlDevice)}
                deviceId={controlDevice?.deviceId}
              />
              {user.role === 'VIEWER' && (
                <p className="mt-2 text-xs text-muted-foreground">Tài khoản chỉ xem không được phép điều khiển bơm.</p>
              )}
            </div>
          </div>
        )}

        {activeSection === 'history' && <RelayLogCard />}
      </main>
      </div>
    </div>);
}
