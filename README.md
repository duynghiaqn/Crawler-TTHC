# 🚀 Crawler TTHC - Cổng Dịch vụ công Quốc gia (DVCQG)

> Hệ thống tự động thu thập, xử lý và xuất bản Master Data Thủ tục Hành chính (TTHC) toàn quốc từ Cổng Dịch vụ công Quốc gia (`dichvucong.gov.vn`).

---

## 📌 Tổng quan dự án

Dự án cung cấp giải pháp cào dữ liệu quy mô lớn (> 6,000+ TTHC) với hiệu năng cao, cơ chế vượt tường lửa (Anti-WAF/Anti-Bot) tiên tiến, và quy trình CI/CD chạy hoàn toàn tự động trên GitHub Actions.

### ✨ Nguyên tắc Thiết kế & Tính năng Nổi bật
- **⚡ Sequential 1-by-1 Execution:** Xử lý tuần tự strictly 1 request tại một thời điểm (`maxSockets: 1`), hoàn toàn loại bỏ concurrency/multiprocessing/fan-out gây áp lực lên hạ tầng máy chủ.
- **🛡️ Conservative Rate & Jitter:** Sử dụng delay cơ sở kết hợp nhiễu ngẫu nhiên (Jitter) giữa mỗi request để đảm bảo tải cực kỳ lịch sự và tự nhiên.
- **🚫 No Evasion Policy:** Tuân thủ chuẩn session trình duyệt Chrome tiêu chuẩn, không sử dụng IP rotation, proxy pool hay thủ thuật giả mạo identity.
- **⚡ Immediate Checkpointing:** Lưu tiến độ ngay lập tức vào `data/checkpoint.json` sau mỗi item. Khi bị ngắt giữa chừng, hệ thống tiếp tục ngay lập tức mà không phải cào lại item thành công.
- **🔒 Circuit Breaker (Cầu chì an toàn):** Tự động phát hiện 3 lỗi liên tiếp (429, 403, 5xx, timeout) để chủ động ngắt tiến trình và lưu vết lý do, bảo vệ hạ tầng endpoint.
- **✅ Fail-Closed & Payload Verification:** Xác minh nghiêm ngặt cấu trúc phản hồi `res.data.code === 'OK'` thay vì tin tưởng mù quáng vào HTTP 200/201.
- **📦 Xuất bản Dữ liệu Tối ưu:** Dữ liệu tự động đẩy ra nhánh `data` riêng biệt với cờ `--force-orphan`, giữ cho repository gốc luôn gọn nhẹ.

---

## 🏗️ Kiến trúc Hệ thống & Luồng Dữ liệu

### 1. Kiến trúc Tổng quan (System Architecture)

```mermaid
graph TD
    A[⏰ GitHub Actions Scheduler\n22:00 GMT+7] -->|Kích hoạt Workflow| B[🚀 auto_crawl.yml]
    C[👤 Manual Workflow Dispatch] -->|Chạy thủ công| B
    
    subgraph "Engine Cào Dữ Liệu (Node.js)"
        B --> D[📜 tthc_audit2.js]
        D -->|1. Dynamic Header Pool| E[🛡️ Anti-WAF Request Engine]
        E -->|2. POST API| F[🌐 dichvucong.gov.vn]
        F -->|3. JSON Response| E
        E -->|4. Phân loại & Sanitize| G[📁 Local ./data directory]
    end

    subgraph "Data Storage & Distribution"
        G --> H[📄 index.json]
        G --> I[📄 version.json]
        G --> J[📂 details/*.json]
        G -->|peaceiris/actions-gh-pages| K[🌐 Branch: data]
    end

    subgraph "TCI Calibration Pipeline"
        K -->|Event Trigger| L[⚙️ tci_calibration.yml]
        L --> M[📜 select-tci-calibration.js]
        L --> N[📜 select-golden-cases.js]
        M & N --> O[📊 tci-results / Branch: tci-calibration]
    end
```

---

### 2. Luồng Xử lý Chi tiết (Data Crawling Sequence)

```mermaid
sequenceDiagram
    autonumber
    participant App as tthc_audit2.js
    participant Pool as Header Rotation Pool
    participant API as DVCQG API Server
    participant FS as Local Filesystem

    App->>FS: Xóa sạch thư mục ./data cũ
    App->>FS: Tạo thư mục ./data và ./data/details
    
    rect rgb(235, 245, 255)
        note over App, API: Giai đoạn 1: Thu thập Danh mục TTHC Toàn quốc
        loop Cho đến khi hết lastId
            App->>Pool: Lấy Random Header Profile (Chrome/Firefox/Edge/Safari)
            Pool-->>App: Return Headers + Client Hints
            App->>API: POST /api/v1/submitting/formality/list-all-public-formality-by-citizen
            API-->>App: Tra về danh sách 200 TTHC + lastId
            App->>App: Ghi nhận danh mục vào rawList
        end
    end

    rect rgb(240, 255, 240)
        note over App, API: Giai đoạn 2: Tải Chi tiết TTHC (Chunk Batching = 20)
        loop Theo từng Chunk 20 items
            par Song song 20 requests
                App->>Pool: Lấy Random Header Profile
                App->>API: POST /api/v1/configuring/formality/get-formality-by-citizen
                API-->>App: Trả về chi tiết TTHC
            end
            App->>App: Bóc tách Index (cấp thực hiện, lĩnh vực, cơ quan...)
            App->>App: Lọc bỏ ảnh Base64 rác (sanitizeBase64)
            App->>FS: Ghi file ./data/details/{id}.json
        end
    end

    rect rgb(255, 245, 235)
        note over App, FS: Giai đoạn 3: Đóng gói & Xuất bản Data
        App->>FS: Ghi file ./data/index.json
        App->>FS: Ghi file ./data/version.json
        App-->>App: Hoàn tất quá trình cào dữ liệu
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
│   └── details/                    # Thư mục chứa chi tiết từng TTHC dạng JSON
│       ├── 01a0a85c-80c6-768f...json
│       └── ...
├── tci/
│   ├── select-tci-calibration.js   # Script phân tích chọn 50 mẫu calibration
│   └── select-golden-cases.js      # Script trích xuất 15 mẫu Golden Cases
├── package.json                    # Khai báo dependency (axios, dotenv)
├── tthc_audit2.js                  # Engine cào dữ liệu chính
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
node tthc_audit2.js
```
*Dữ liệu cào được sẽ tự động tạo tại thư mục `./data`.*

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
  "total_records": 6297
}
```

### 3. `data/details/{id}.json`
Chứa toàn bộ cây dữ liệu chi tiết của 1 thủ tục (đã được dọn dẹp các chuỗi mã hóa Base64 của hình ảnh đính kèm để tối ưu dung lượng).

---

## ⚙️ Cấu hình GitHub Actions

| Workflow | Trigger | Lịch / Điều kiện | Nhiệm vụ |
| :--- | :--- | :--- | :--- |
| **`auto_crawl.yml`** | `schedule` / `workflow_dispatch` | `0 15 * * *` (22:00 VN) | Chạy `tthc_audit2.js` và đẩy dữ liệu `./data` ra nhánh `data`. |
| **`tci_calibration.yml`** | `push` / `workflow_dispatch` | Khi có thay đổi code TCI / detail | Phân tích 50 mẫu calibration & 15 Golden Cases, push lên nhánh `tci-calibration`. |

---

## 🛡️ Giấy phép & Bản quyền
Dự án được duy trì bởi **Duy Nghĩa** cho mục đích nghiên cứu và thu thập dữ liệu phục vụ Dịch vụ công. Dữ liệu thuộc bản quyền công khai của Cổng Dịch vụ công Quốc gia Việt Nam.
