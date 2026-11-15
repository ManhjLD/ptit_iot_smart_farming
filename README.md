# Smart Farming IoT

Hệ thống tưới thông minh dùng ESP32 để đọc cảm biến, điều khiển máy bơm qua relay và gửi dữ liệu MQTT tới backend. Dashboard web hỗ trợ theo dõi chỉ số, trạng thái thiết bị, cảnh báo, nhật ký và điều khiển bơm theo quyền.

## Kiến trúc

```text
ESP32 ── MQTT/TLS ── MQTT broker ── Backend Node.js ── PostgreSQL
  ▲                         │              ▲               │
  └──── lệnh và ACK ────────┘              └── REST API ───┘
                                                  │
                                           Next.js dashboard
```

- `devices/`: firmware PlatformIO cho ESP32, cảm biến, relay và MQTT.
- `backend/`: API Hono, MQTT listener, xử lý lệnh/cảnh báo và Prisma.
- `frontend/`: dashboard Next.js.
- `assets/`: sơ đồ kiến trúc và sơ đồ kết nối phần cứng.
- `backend/prisma/`: mô hình dữ liệu và migration PostgreSQL.
- `BAO_CAO_DO_AN_IOT.docx`: báo cáo phân tích, thiết kế, xây dựng và kiểm thử.

## Chức năng chính

- Thu thập nhiệt độ, độ ẩm không khí, độ ẩm và nhiệt độ đất, mưa, mực nước.
- Tưới tự động theo độ ẩm đất; có thể bật/tắt relay từ dashboard.
- Theo dõi lịch sử cảm biến, nhật ký relay, trạng thái online và cảnh báo.
- Quản lý thiết bị, vòng đời thiết bị, cấu hình tưới và phân công thiết bị.
- Đăng nhập, phiên có thời hạn, phân quyền `ADMIN`, `OPERATOR`, `VIEWER`.

## Yêu cầu

- Node.js 18 trở lên và npm.
- PostgreSQL; MQTT broker hỗ trợ TLS.
- PlatformIO Core để biên dịch và nạp firmware.
- ESP32 cùng các cảm biến/relay theo sơ đồ trong `assets/devices.png`.

## Chạy backend

```powershell
cd backend
Copy-Item .env.example .env
npm ci
npx prisma migrate deploy
```

Điền thông tin PostgreSQL và broker MQTT vào `backend/.env`. Đặt `ENABLE_MQTT=1` để backend khởi động MQTT listener; giữ `0` khi chỉ chạy API. Tạo tài khoản quản trị ban đầu bằng cách thiết lập `BOOTSTRAP_ADMIN_EMAIL` và `BOOTSTRAP_ADMIN_PASSWORD` trong `.env`, sau đó chạy:

```powershell
npm run auth:bootstrap-admin
npm run dev
```

API mặc định chạy tại `http://localhost:3001`; kiểm tra `/api/health`.

## Chạy dashboard

```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Dashboard mặc định chạy tại `http://localhost:3000`. Cấu hình `NEXT_PUBLIC_API_BASE_URL` trỏ tới URL API kết thúc bằng `/api`; đặt các biến `NEXT_PUBLIC_*` trước khi khởi động Next.js.

## Nạp firmware ESP32

Từ thư mục `devices/`, sao chép `include/config.example.h` thành `include/config.h`, rồi điền thông tin Wi-Fi và MQTT tại máy phát triển. Đặt chứng thư CA của broker tại `data/emqxsl-ca.crt`.

```powershell
cd devices
pio run
pio run --target upload
pio run --target uploadfs
pio device monitor
```

Firmware đọc cảm biến mỗi 2 giây và gửi telemetry theo cấu hình hiện tại mỗi 120 giây. Relay tự bật khi độ ẩm đất không vượt quá 10%; thiết bị kiểm tra mưa, mực nước và tính hợp lệ của dữ liệu trước khi thực hiện lệnh bật từ xa.

## MQTT

| Topic | Hướng | Mục đích |
|---|---|---|
| `sf/{deviceId}/sensor` | ESP32 → backend | Telemetry cảm biến |
| `sf/{deviceId}/relay` | ESP32 → backend | Trạng thái relay và nguyên nhân |
| `sf/{deviceId}/status` | ESP32 → backend | Trạng thái thiết bị |
| `sf/devices/relay/command` | Backend → ESP32 | Lệnh bật/tắt có thời hạn |
| `sf/{deviceId}/ack` | ESP32 → backend | Kết quả thực hiện lệnh |

## Kiểm thử

```powershell
cd backend
npm test
npm run check
```

```powershell
cd frontend
npm run lint
```

Các bài kiểm thử tự động tập trung vào chính sách cảnh báo, điều kiện bật bơm, xác thực và phân quyền. Kiểm thử thiết bị thật cần kết nối ESP32, cảm biến, relay, broker và cơ sở dữ liệu.

## Lưu ý cấu hình

Không đưa mật khẩu, token hoặc khóa thật vào mã nguồn hay tài liệu. `backend/.env`, `frontend/.env.local` và `devices/include/config.h` chỉ dùng cho môi trường cục bộ; thay thông tin mẫu trong các tệp `.env.example` trước khi triển khai.
