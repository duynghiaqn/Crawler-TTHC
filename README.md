# 🚀 Crawler TTHC - Cổng Dịch vụ công Quốc gia (DVCQG)

> Hệ thống tự động thu thập, xử lý và xuất bản Master Data Thủ tục Hành chính (TTHC) toàn quốc từ Cổng Dịch vụ công Quốc gia (`dichvucong.gov.vn`).

---

## 📌 Tổng quan dự án

Dự án cung cấp giải pháp cào dữ liệu quy mô lớn (> 6,000+ TTHC) với hiệu năng cao, cơ chế vượt tường lửa (Anti-WAF/Anti-Bot) tiên tiến, và quy trình CI/CD chạy hoàn toàn tự động trên GitHub Actions.

### ✨ Nguyên tắc Thiết kế & Tính năng Nổi bật
- **⚡ Controlled Concurrency (Tối đa 3 kết nối song song):** Giới hạn tối đa 3 kết nối HTTPS socket đồng thời (`maxSockets: 3`), hoàn toàn loại bỏ nguy cơ nghẽn kết nối hay bị tường lửa tarpit/drop kết nối.
- **🛡️ Conservative Rate & Jitter:** Sử dụng delay cơ sở (300ms) kết hợp nhiễu ngẫu nhiên (Jitter 0-200ms) giữa các đợt request để giữ tải ở mức lịch sự và tự nhiên.
- **⚡ Discovery Caching:** Tự động lưu cache danh mục toàn quốc vào `data/discovery.json`. Các lần chạy tiếp theo (< 6 tiếng) sẽ khởi động tức thì mà không cần quét lại 32 trang API danh mục.
- **⚡ Immediate Checkpointing:** Lưu tiến độ ngay lập tức vào `data/checkpoint.json` sau mỗi item. Khi tiến trình bị gián đoạn, hệ thống tự động tiếp tục tại item chưa tải mà không cần cào lại dữ liệu đã hoàn thành.
- **🔒 Circuit Breaker (Cầu chì an toàn):** Tự động phát hiện 3 lỗi phản hồi/tường lửa liên tiếp (429, 403, 5xx, timeout) để chủ động ngắt tiến trình an toàn và lưu vết lý do.
- **✅ Fail-Closed & Payload Verification:** Xác minh nghiêm ngặt cấu trúc phản hồi `res.data.code === 'OK'` thay vì tin tưởng mù quáng vào HTTP 200/201.
- **🛡️ Atomic JSON Writes & Graceful Teardown:** Sử dụng cơ chế ghi file nguyên tử (`safeWriteJson`) qua file tạm `.tmp` và bắt sự kiện ngắt đột ngột (`SIGINT`, `SIGTERM`) để chống hỏng file JSON khi bị ngắt.
- **📦 Xuất bản Dữ liệu Tối ưu:** Dữ liệu tự động đẩy ra nhánh `data` riêng biệt với cờ `--force-orphan`, giữ cho repository gốc luôn gọn nhẹ.

---

## 🏗️ Kiến trúc Hệ thống & Luồng Dữ liệu

### 1. Kiến trúc Tổng quan (System Architecture)

```mermaid
graph TD
    A[⏰ GitHub Actions Scheduler\n22:00 GMT+7] -->|Kích hoạt Workflow| B[🚀 auto_crawl.yml]
    C[👤 Manual Workflow Dispatch] -->|Chạy thủ công| B
    
    subgraph "Engine Cào Dữ Liệu (Node.js)"
        B --> D[📜 tthc_crawler.js]
        D -->|1. Discovery Engine / Cache| E[📄 data/discovery.json]
        D -->|2. Max 3 Connections| F[🛡️ Anti-WAF Session Engine]
        F -->|3. Verified POST API| G[🌐 dichvucong.gov.vn]
        G -->|4. JSON Response| F
        F -->|5. Immediate Checkpoint| H[📄 data/checkpoint.json]
        F -->|6. Atomic JSON Write| I[📁 Local ./data directory]
    end

    subgraph "Data Storage & Distribution"
        I --> J[📄 index.json]
        I --> K[📄 version.json]
        I --> L[📂 details/*.json]
        I -->|peaceiris/actions-gh-pages| M[🌐 Branch: data]
    end

    subgraph "TCI Calibration Pipeline"
        M -->|Event Trigger| N[⚙️ tci_calibration.yml]
        N --> O[📜 select-tci-calibration.js]
        N --> P[📜 select-golden-cases.js]
        O & P --> Q[📊 tci-results / Branch: tci-calibration]
    end
```

---

### 2. Luồng Xử lý Chi tiết (Data Crawling Sequence)

```mermaid
sequenceDiagram
    autonumber
    participant App as tthc_crawler.js
    participant Cache as Discovery & Checkpoint
    participant API as DVCQG API Server
    participant FS as Local Filesystem

    App->>FS: Kiểm tra & tạo thư mục ./data và ./data/details
    App->>Cache: Nạp Checkpoint (completedIds, failedIds, status)
    
    rect rgb(235, 245, 255)
        note over App, API: Giai đoạn 1: Đồng bộ Danh mục TTHC Toàn quốc (Discovery)
        alt Discovery Cache còn hạn (< 6 tiếng)
            Cache-->>App: Nạp 6,297 mã TTHC từ data/discovery.json (0.0s)
        else Cache quá hạn hoặc chưa có
            loop Phân trang 200 items/trang
                App->>API: POST /api/v1/submitting/formality/list-all-public-formality-by-citizen
                API-->>App: Trả về danh sách TTHC + lastId
            end
            App->>Cache: Ghi file data/discovery.json
        end
    end

    rect rgb(240, 255, 240)
        note over App, API: Giai đoạn 2: Tải Chi tiết TTHC (Batch Size = 3, Max Concurrency = 3)
        loop Theo từng Batch 3 items chưa hoàn thành
            par Song song tối đa 3 HTTPS Sockets
                App->>API: POST /api/v1/configuring/formality/get-formality-by-citizen
                API-->>App: Trả về chi tiết TTHC
            end
            App->>App: Phân tích chỉ mục & Sanitize Base64
            App->>FS: Atomic Write file ./data/details/{id}.json
            App->>Cache: Lưu Checkpoint ngay lập tức vào data/checkpoint.json
            alt Phát hiện 3 lỗi liên tiếp (429, 403, 5xx, timeout)
                App->>Cache: Trigger Circuit Breaker & Lưu vết lý do
                App-->>App: Tự động dừng chạy an toàn (Exit 1)
            end
        end
    end

    rect rgb(255, 245, 235)
        note over App, FS: Giai đoạn 3: Đóng gói & Xuất bản Master Data
        App->>FS: Ghi file ./data/index.json (Atomic)
        App->>FS: Ghi file ./data/version.json (Atomic)
        App-->>App: Cập nhật Checkpoint = COMPLETED
    end
```

---

## 📁 Cấu trúc Thư mục Dự án

```text
Crawler-TTHC/
├── .github/
│   └── workflows/
│       ├── auto_crawl.yml          # Workflow chạy cào dữ liệu tự động 22:00 hàng ngày
│       └── tci_calibration.yml     # Workflow phân tích mẫu hiệu chỉnh TCI
├── data/                           # Thư mục chứa dữ liệu đầu ra (Deploy sang nhánh 'data')
│   ├── index.json                  # File chỉ mục toàn bộ TTHC
│   ├── version.json                # Thông tin phiên bản & thời gian cập nhật
│   ├── discovery.json              # File cache danh mục TTHC toàn quốc (< 6h)
│   ├── checkpoint.json             # File lưu vết tiến độ & trạng thái Circuit Breaker
│   └── details/                    # Thư mục chứa chi tiết từng TTHC dạng JSON
│       ├── 01a0a85c-80c6-768f...json
│       └── ...
├── tci/
│   ├── select-tci-calibration.js   # Script phân tích chọn 50 mẫu calibration
│   └── select-golden-cases.js      # Script trích xuất 15 mẫu Golden Cases
├── package.json                    # Khai báo dependency (axios, dotenv)
├── tthc_crawler.js                 # Engine cào dữ liệu chính (Enterprise Standard)
└── README.md                       # Tài liệu hướng dẫn hệ thống
```

---

## 🛠️ Hướng dẫn Sử dụng

### 1. Yêu cầu Môi trường
- **Node.js**: phiên bản `>= 18.0.0`
- **npm**: phiên bản `>= 9.0.0`

### 2. Cài đặt Dependency
```bash
npm install
```

### 3. Chạy cào dữ liệu thủ công tại máy cục bộ (Local Run)
```bash
node tthc_crawler.js
```
*Dữ liệu cào được và checkpoint sẽ tự động cập nhật tại thư mục `./data`.*

### 4. Chạy phân tích TCI Calibration
```bash
node tci/select-tci-calibration.js
node tci/select-golden-cases.js
```

---

## 📊 Cấu trúc Dữ liệu Đầu ra (Output Specification)

### 1. `data/index.json`
Chứa bảng chỉ mục rút gọn của toàn bộ TTHC:
```json
[
  {
    "id": "01a0a85c-80c6-768f-b7b9-e04942933ace",
    "ma_tthc": "5.003882",
    "ten_tthc": "Xây dựng kế hoạch xử lý, cải tạo và phục hồi ô nhiễm môi trường...",
    "cap_thuc_hien": "Cấp tỉnh",
    "loai_tthc": "TTHC Tiêu chuẩn",
    "linh_vuc": "Môi trường",
    "co_quan_thuc_hien": "Cơ quan chuyên môn về nông nghiệp và môi trường thuộc UBND cấp tỉnh"
  }
]
```

### 2. `data/version.json`
Chứa thông tin metadata của đợt quét:
```json
{
  "last_updated": "2026-09-17T15:30:00.000Z",
  "total_records": 6297,
  "completed_records": 6297,
  "failed_records": 0,
  "circuit_breaker_status": "COMPLETED"
}
```

### 3. `data/checkpoint.json`
Chứa bảng lưu vết trạng thái chi tiết từng item và cầu chì an toàn:
```json
{
  "completedIds": {
    "01a0a85c-80c6-768f-b7b9-e04942933ace": {
      "code": "5.003882",
      "timestamp": "2026-09-17T20:20:00.000Z",
      "verified": true
    }
  },
  "failedIds": {},
  "consecutiveFailures": 0,
  "lastUpdated": "2026-09-17T20:20:00.000Z",
  "status": "COMPLETED",
  "circuitBreakerReason": null
}
```

### 4. `data/details/{id}.json`
Chứa toàn bộ cây dữ liệu chi tiết của 1 thủ tục (đã được dọn dẹp các chuỗi mã hóa Base64 của hình ảnh đính kèm để tối ưu dung lượng).

---

## ⚙️ Cấu hình GitHub Actions

| Workflow | Trigger | Lịch / Điều kiện | Nhiệm vụ |
| :--- | :--- | :--- | :--- |
| **`auto_crawl.yml`** | `schedule` / `workflow_dispatch` | `0 15 * * *` (22:00 VN) | Chạy `tthc_crawler.js` và đẩy dữ liệu `./data` ra nhánh `data`. |
| **`tci_calibration.yml`** | `push` / `workflow_dispatch` | Khi có thay đổi code TCI / detail | Phân tích 50 mẫu calibration & 15 Golden Cases, push lên nhánh `tci-calibration`. |

---

## 🛡️ Giấy phép & Bản quyền
Dự án được duy trì bởi **Duy Nghĩa** cho mục đích nghiên cứu và thu thập dữ liệu phục vụ Dịch vụ công. Dữ liệu thuộc bản quyền công khai của Cổng Dịch vụ công Quốc gia Việt Nam.
