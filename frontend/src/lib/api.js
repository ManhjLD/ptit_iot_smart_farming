export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
export const MQTT_SERVICE_BASE_URL = process.env.NEXT_PUBLIC_MQTT_SERVICE_BASE_URL || '';
export const MQTT_COMMAND_TOPIC = process.env.NEXT_PUBLIC_MQTT_COMMAND_TOPIC || 'sf/devices/relay/command';
const AUTH_TOKEN_KEY = 'smart-farming-session';

export function setAuthToken(token) {
    if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    }
}

export function clearAuthToken() {
    if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
    }
}

export function getAuthToken() {
    return typeof window === 'undefined'
        ? null
        : window.sessionStorage.getItem(AUTH_TOKEN_KEY);
}

function createIdempotencyKey() {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
        return cryptoApi.randomUUID();
    }
    if (typeof cryptoApi?.getRandomValues !== 'function') {
        throw new Error('Trình duyệt không hỗ trợ tạo khóa ngẫu nhiên an toàn');
    }

    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function http(path, init, isMqtt = false) {
    const BASE_URL = isMqtt ? MQTT_SERVICE_BASE_URL : API_BASE_URL;
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    const token = getAuthToken();
    const res = await fetch(url, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(init?.headers || {}),
        },
        cache: 'no-store',
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
    }
    return (await res.json());
}

export async function login(email, password) {
    const result = await http('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    setAuthToken(result.token);
    return result;
}

export async function fetchCurrentUser() {
    return http('/auth/me');
}

export async function logout() {
    try {
        if (getAuthToken()) {
            await http('/auth/logout', { method: 'POST' });
        }
    } finally {
        clearAuthToken();
    }
}

export async function registerDevice(device) {
    return http('/device/devices', {
        method: 'POST',
        body: JSON.stringify(device),
    });
}

export async function fetchDevices() {
    return http('/device/devices');
}

export async function transitionDeviceLifecycle(deviceId, lifecycle, reason) {
    return http(`/device/devices/${encodeURIComponent(deviceId)}/lifecycle`, {
        method: 'PATCH',
        body: JSON.stringify({ lifecycle, reason }),
    });
}

export async function fetchIrrigationRule(deviceId) {
    return http(`/device/devices/${encodeURIComponent(deviceId)}/irrigation-rule`);
}

export async function saveIrrigationRule(deviceId, rule) {
    return http(`/device/devices/${encodeURIComponent(deviceId)}/irrigation-rule`, {
        method: 'PUT',
        body: JSON.stringify(rule),
    });
}

export async function createAccount(account) {
    return http('/auth/users', { method: 'POST', body: JSON.stringify(account) });
}

export async function listAccounts() {
    return http('/auth/users');
}

export async function updateAccount(id, changes) {
    return http(`/auth/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
    });
}
export async function fetchSensorDataPage(limit = 10, offset = 0, filters) {
    const search = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
    });
    if (filters?.deviceId)
        search.set('deviceId', filters.deviceId);
    const json = await http('/sensor-data?' + search.toString());
    return json.data;
}
export async function fetchLatestSensorData() {
    const json = await http('/sensor-data/latest');
    return json.data;
}
export async function fetchSensorDataRange(params) {
    const search = new URLSearchParams();
    if (params.limit != null)
        search.set('limit', String(params.limit));
    if (params.offset != null)
        search.set('offset', String(params.offset));
    if (params.from)
        search.set('from', params.from);
    if (params.to)
        search.set('to', params.to);
    if (params.deviceId)
        search.set('deviceId', params.deviceId);
    const json = await http('/sensor-data?' + search.toString());
    return json.data;
}
export async function fetchRelayLogs(limit = 10, offset = 0) {
    const search = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
    });
    const json = await http('/relay-log?' + search.toString());
    return json.data;
}
export async function fetchLatestRelayLog() {
    const json = await http('/relay-log/latest');
    return json.data;
}
export async function fetchRelayDuration(params) {
    const search = new URLSearchParams();
    if (params?.from)
        search.set('from', params.from);
    if (params?.to)
        search.set('to', params.to);
    const json = await http('/relay-log/duration' + (search.size ? `?${search}` : ''));
    return json.data;
}
export async function fetchApiHealth() {
    return http('/health');
}
export async function fetchDbHealth() {
    return http('/db-test');
}
export async function fetchMqttHealth() {
    return http('/mqtt/health', undefined, true);
}
export async function publishRelayCommand(payload) {
    if (typeof payload.deviceId !== 'string' || !payload.deviceId.trim()) {
        throw new Error('ESP32 device ID is required to send a relay command');
    }
    const body = {
        state: payload.relayStatus ? 'on' : 'off',
        reason: payload.reason || 'Operator requested relay state change',
    };
    return http(`/commands/devices/${encodeURIComponent(payload.deviceId)}/commands`, {
        method: 'POST',
        headers: { 'Idempotency-Key': createIdempotencyKey() },
        body: JSON.stringify(body),
    });
}

export async function fetchAlerts(status) {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return http(`/alerts${query}`);
}

export async function acknowledgeAlert(id, note) {
    return http(`/alerts/${encodeURIComponent(id)}/ack`, {
        method: 'POST',
        body: JSON.stringify({ note }),
    });
}

export async function resolveAlert(id, note) {
    return http(`/alerts/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ note }),
    });
}

export async function fetchCommand(commandId) {
    return http(`/commands/${encodeURIComponent(commandId)}`);
}
