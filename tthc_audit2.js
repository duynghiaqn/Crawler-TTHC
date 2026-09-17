const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

// ============================================================
// CONFIGURATION & CONSTANTS
// ============================================================
const CONFIG = {
    DATA_DIR: path.join(process.cwd(), 'data'),
    DETAILS_DIR: path.join(process.cwd(), 'data', 'details'),
    CHECKPOINT_FILE: path.join(process.cwd(), 'data', 'checkpoint.json'),
    INDEX_FILE: path.join(process.cwd(), 'data', 'index.json'),
    VERSION_FILE: path.join(process.cwd(), 'data', 'version.json'),
    
    // Low request rate settings (Sequential with Jitter)
    BASE_DELAY_MS: 300,
    JITTER_MS: 200,
    
    // Circuit Breaker settings
    MAX_CONSECUTIVE_FAILURES: 3,
    MAX_RETRIES: 3,
    TIMEOUT_MS: 20000,
    
    // Standard Consistent Client Session (No evasion/spoofing)
    HEADERS: {
        "accept": "application/json, text/plain, */*",
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "content-type": "application/json",
        "origin": "https://dichvucong.gov.vn",
        "referer": "https://dichvucong.gov.vn/p/home/dvc-thu-tuc-hanh-chinh.html",
        "sec-ch-ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    }
};

// Standard HTTPS Agent with maximum 3 connection sockets
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 3,
    maxFreeSockets: 3,
    rejectUnauthorized: false
});

// Helper for polite delay with random jitter
const politeDelay = async () => {
    const jitter = Math.floor(Math.random() * CONFIG.JITTER_MS);
    const totalMs = CONFIG.BASE_DELAY_MS + jitter;
    await new Promise(resolve => setTimeout(resolve, totalMs));
};

// ============================================================
// CHECKPOINT & STATE MANAGEMENT
// ============================================================
function loadCheckpoint() {
    if (fs.existsSync(CONFIG.CHECKPOINT_FILE)) {
        try {
            const raw = fs.readFileSync(CONFIG.CHECKPOINT_FILE, 'utf8');
            return JSON.parse(raw);
        } catch (e) {
            console.warn(`⚠️ Lỗi khi đọc checkpoint cũ, khởi tạo mới: ${e.message}`);
        }
    }
    return {
        completedIds: {},
        failedIds: {},
        consecutiveFailures: 0,
        lastUpdated: new Date().toISOString(),
        status: 'INITIALIZED',
        circuitBreakerReason: null
    };
}

function saveCheckpoint(checkpoint) {
    checkpoint.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CONFIG.CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

// ============================================================
// DATA SANITIZATION & PARSING UTILS
// ============================================================
function sanitizeBase64(obj) {
    let str = JSON.stringify(obj);
    str = str.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/g, '[Hình ảnh đính kèm trên DVCQG]');
    return JSON.parse(str);
}

function parseFormalityType(type) {
    if (type === 'ASSIGNED_REGULATION') return 'TTHC được luật giao quy định chi tiết';
    if (type === 'SPECIFIC') return 'TTHC Đặc thù';
    if (type === 'STANDARD') return 'TTHC Tiêu chuẩn';
    if (type === 'INTERCONNECTED') return 'TTHC liên thông';
    if (type === 'STANDARD_INTERNAL') return 'TTHC nội bộ';
    if (type === 'INTERCONNECTED_INTERNAL') return 'TTHC nội bộ liên thông';
    return type || 'Không xác định';
}

function parseFormalityCaseLevel(detail) {
    let arr = [];
    if (detail.isWard) arr.push('Cấp xã');
    if (detail.isProvince) arr.push('Cấp tỉnh');
    if (detail.isMinistry) arr.push('Cấp Bộ');
    if (detail.isOtherAgency) arr.push('Cơ quan khác');
    return arr.length > 0 ? arr.join(', ') : 'Chưa xác định';
}

// ============================================================
// RESILIENT SEQUENTIAL FETCH ENGINE WITH VERIFICATION & CIRCUIT BREAKER
// ============================================================
async function fetchVerifiedRequest(url, payload, checkpoint) {
    for (let retry = 0; retry <= CONFIG.MAX_RETRIES; retry++) {
        try {
            const res = await axios.post(url, payload, {
                headers: CONFIG.HEADERS,
                httpsAgent,
                timeout: CONFIG.TIMEOUT_MS,
                validateStatus: status => status >= 200 && status < 600
            });

            // 1. Kiểm tra HTTP Status Code
            if (res.status === 429 || res.status === 403 || res.status >= 500) {
                const signalError = new Error(`Server rejection signal HTTP ${res.status}`);
                signalError.statusCode = res.status;
                throw signalError;
            }

            // 2. Data Verification Rule: Không bao giờ tin tưởng mù quáng vào HTTP 200
            if (!res.data || (res.data.code !== 'OK' && res.data.code !== 200 && !res.data.data && !res.data.items)) {
                throw new Error(`Payload verification failed (Response code: ${res.data ? res.data.code : 'INVALID'})`);
            }

            // Ghi nhận request thành công -> Reset đếm lỗi liên tiếp
            checkpoint.consecutiveFailures = 0;
            return res.data;

        } catch (err) {
            const isRejectionSignal = err.statusCode === 429 || err.statusCode === 403 || (err.statusCode >= 500);
            
            if (retry < CONFIG.MAX_RETRIES && !isRejectionSignal) {
                const waitTime = Math.pow(2, retry) * 1000;
                console.warn(`   ⚠️ Lỗi mạng (${err.message}) - thử lại lần ${retry + 1}/${CONFIG.MAX_RETRIES} sau ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                // Tăng biến đếm Circuit Breaker
                checkpoint.consecutiveFailures += 1;
                console.error(`   ❌ Request thất bại [Lỗi liên tiếp: ${checkpoint.consecutiveFailures}/${CONFIG.MAX_CONSECUTIVE_FAILURES}]: ${err.message}`);
                
                if (checkpoint.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
                    checkpoint.status = 'CIRCUIT_BREAKER_TRIPPED';
                    checkpoint.circuitBreakerReason = `Đã dừng chạy an toàn: Phát hiện ${checkpoint.consecutiveFailures} lỗi phản hồi/tường lửa liên tiếp (${err.message}).`;
                    saveCheckpoint(checkpoint);
                    throw new Error(checkpoint.circuitBreakerReason);
                }
                throw err;
            }
        }
    }
}

// ============================================================
// MAIN PIPELINE
// ============================================================
async function main() {
    console.log('\n=== CÔNG CỤ CÀO TTHC DVCQG (CHUẨN TẦM DOANH NGHIỆP - SEQUENTIAL & CHECKPOINT) ===\n');

    // 1. Khởi tạo thư mục
    if (!fs.existsSync(CONFIG.DATA_DIR)) fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG.DETAILS_DIR)) fs.mkdirSync(CONFIG.DETAILS_DIR, { recursive: true });

    // 2. Đọc Checkpoint
    const checkpoint = loadCheckpoint();
    if (checkpoint.status === 'CIRCUIT_BREAKER_TRIPPED') {
        console.warn(`⚠️ CẢNH BÁO: Lần chạy trước bị ngắt bởi Circuit Breaker!`);
        console.warn(` Lý do: ${checkpoint.circuitBreakerReason}`);
        console.warn(` Resetting Circuit Breaker counter để tiếp tục quy trình an toàn...\n`);
        checkpoint.consecutiveFailures = 0;
        checkpoint.status = 'IN_PROGRESS';
    } else {
        checkpoint.status = 'IN_PROGRESS';
    }

    // 3. Khôi phục IndexData từ ổ đĩa nếu đã có
    let indexData = [];
    if (fs.existsSync(CONFIG.INDEX_FILE)) {
        try {
            indexData = JSON.parse(fs.readFileSync(CONFIG.INDEX_FILE, 'utf8'));
        } catch (e) {
            indexData = [];
        }
    }

    // 4. Thu thập danh mục TTHC Toàn quốc (Discovery Caching & Discovery Execution)
    const DISCOVERY_FILE = path.join(CONFIG.DATA_DIR, 'discovery.json');
    let rawList = [];

    // Kiểm tra cache Discovery nếu còn mới (< 6 tiếng)
    if (fs.existsSync(DISCOVERY_FILE)) {
        try {
            const cacheData = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
            const cacheAgeHours = (Date.now() - new Date(cacheData.savedAt).getTime()) / (1000 * 3600);
            if (Array.isArray(cacheData.items) && cacheData.items.length > 0 && cacheAgeHours < 6) {
                rawList = cacheData.items;
                console.log(`⚡ Đã nạp ${rawList.length} TTHC từ Discovery Cache (Tuổi cache: ${cacheAgeHours.toFixed(1)}h).`);
            }
        } catch (e) {
            console.warn(`⚠️ Bỏ qua Discovery cache hỏng: ${e.message}`);
        }
    }

    if (rawList.length === 0) {
        let lastId = "";
        console.log(`🚀 Đang đồng bộ danh mục TTHC toàn quốc từ máy chủ (Discovery Engine)...`);

        try {
            while (true) {
                const payload = { limit: 200, lastId: lastId, q: "", categoryId: "", departmentCode: "" };
                const res = await fetchVerifiedRequest(
                    'https://dichvucong.gov.vn/api/v1/submitting/formality/list-all-public-formality-by-citizen',
                    payload,
                    checkpoint
                );

                if (!res || !res.data || !res.data.items || res.data.items.length === 0) break;
                res.data.items.forEach(item => rawList.push(item));

                if (!res.data.lastId || res.data.lastId === lastId) break;
                lastId = res.data.lastId;
                console.log(`   Đã tìm thấy: ${rawList.length} mã TTHC`);
                await politeDelay();
            }

            // Ghi Discovery Cache
            fs.writeFileSync(DISCOVERY_FILE, JSON.stringify({
                savedAt: new Date().toISOString(),
                totalItems: rawList.length,
                items: rawList
            }, null, 2));

        } catch (err) {
            if (checkpoint.status === 'CIRCUIT_BREAKER_TRIPPED') {
                console.error(`\n🛑 CIRCUIT BREAKER TRIGGERED: ${err.message}`);
                process.exit(1);
            } else {
                console.error(`⚠️ Lỗi khi lấy danh mục: ${err.message}`);
            }
        }
    }

    console.log(`✅ Tổng số TTHC phát hiện: ${rawList.length}`);

    // 5. Tải chi tiết từng TTHC — TỐI ĐA 3 KẾT NỐI SONG SONG (MAX CONCURRENCY = 3)
    if (rawList.length > 0) {
        console.log(`⚡ Tiến hành tải chi tiết cho: ${rawList.length} thủ tục (Tối đa 3 kết nối song song + Checkpoint liên tục)...\n`);
        
        let successCount = Object.keys(checkpoint.completedIds).length;
        let skippedCount = 0;
        const chunkSize = 3;
        const startTime = Date.now();

        for (let i = 0; i < rawList.length; i += chunkSize) {
            const chunk = rawList.slice(i, i + chunkSize);
            const pending = chunk.filter(item => {
                const detailFilePath = path.join(CONFIG.DETAILS_DIR, `${item.id}.json`);
                if (checkpoint.completedIds[item.id] && fs.existsSync(detailFilePath)) {
                    skippedCount++;
                    return false;
                }
                return true;
            });

            if (pending.length > 0) {
                await Promise.all(pending.map(async (item) => {
                    const detailFilePath = path.join(CONFIG.DETAILS_DIR, `${item.id}.json`);
                    try {
                        const res = await fetchVerifiedRequest(
                            'https://dichvucong.gov.vn/api/v1/configuring/formality/get-formality-by-citizen',
                            { id: item.id },
                            checkpoint
                        );

                        if (res && res.data) {
                            let detail = res.data.data || res.data;

                            // A. Tạo thông tin Index
                            const formalityItem = {
                                id: item.id,
                                ma_tthc: item.code,
                                ten_tthc: item.name,
                                cap_thuc_hien: parseFormalityCaseLevel(detail),
                                loai_tthc: parseFormalityType(item.type || detail.formalityType),
                                linh_vuc: (item.categories && item.categories.length > 0) ? item.categories.join(', ') : '',
                                co_quan_thuc_hien: detail.executingAgencies || (item.departments ? item.departments.join(', ') : '')
                            };

                            // Cập nhật indexData (tránh trùng lặp)
                            const existingIdx = indexData.findIndex(x => x.id === item.id);
                            if (existingIdx >= 0) {
                                indexData[existingIdx] = formalityItem;
                            } else {
                                indexData.push(formalityItem);
                            }

                            // B. Lưu RAW JSON Chi tiết (Dọn dẹp base64)
                            const cleanDetail = sanitizeBase64(detail);
                            fs.writeFileSync(detailFilePath, JSON.stringify(cleanDetail, null, 2));

                            // C. CHECKPOINT NGAY LẬP TỨC
                            checkpoint.completedIds[item.id] = {
                                code: item.code,
                                timestamp: new Date().toISOString(),
                                verified: true
                            };
                            delete checkpoint.failedIds[item.id];
                            successCount++;
                            saveCheckpoint(checkpoint);
                        }

                    } catch (err) {
                        checkpoint.failedIds[item.id] = {
                            code: item.code,
                            timestamp: new Date().toISOString(),
                            error: err.message
                        };
                        saveCheckpoint(checkpoint);
                    }
                }));
            }

            if (checkpoint.status === 'CIRCUIT_BREAKER_TRIPPED') {
                console.error(`\n🛑 CIRCUIT BREAKER TRIGGERED! Tiến trình dừng lại an toàn.\n`);
                break;
            }

            // Log tiến độ mỗi 60 TTHC
            if ((i + chunkSize) % 60 < chunkSize || i + chunkSize >= rawList.length) {
                const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
                const pct = (((i + chunkSize) / rawList.length) * 100).toFixed(1);
                console.log(`   [${pct}% | ${Math.min(i + chunkSize, rawList.length)}/${rawList.length}] ✅ Hoàn tất: ${successCount} | ⏩ Bỏ qua: ${skippedCount} | ❌ Lỗi: ${Object.keys(checkpoint.failedIds).length} | ⏱️ ${elapsedMin}m`);
            }

            // Tốc độ thấp có jitter chống nghẽn server
            await politeDelay();
        }

        // 6. Ghi xuất bản Index & Version
        fs.writeFileSync(CONFIG.INDEX_FILE, JSON.stringify(indexData, null, 2));
        const versionInfo = {
            last_updated: new Date().toISOString(),
            total_records: indexData.length,
            completed_records: Object.keys(checkpoint.completedIds).length,
            failed_records: Object.keys(checkpoint.failedIds).length,
            circuit_breaker_status: checkpoint.status
        };
        fs.writeFileSync(CONFIG.VERSION_FILE, JSON.stringify(versionInfo, null, 2));

        if (checkpoint.status === 'CIRCUIT_BREAKER_TRIPPED') {
            process.exit(1);
        } else {
            checkpoint.status = 'COMPLETED';
            saveCheckpoint(checkpoint);
            console.log(`\n🎉 HOÀN TẤT AN TOÀN! Tổng số TTHC thành công: ${Object.keys(checkpoint.completedIds).length}/${rawList.length}`);
        }
    }
}

main().catch(err => {
    console.error('❌ Lỗi hệ thống ngoài dự kiến:', err.message);
    process.exit(1);
});