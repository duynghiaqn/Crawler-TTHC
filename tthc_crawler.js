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
    DISCOVERY_FILE: path.join(process.cwd(), 'data', 'discovery.json'),
    
    // Low request rate settings (Conservative concurrency = 3 with Jitter)
    MAX_CONCURRENCY: 3,
    BASE_DELAY_MS: 300,
    JITTER_MS: 200,
    
    // Circuit Breaker settings
    MAX_CONSECUTIVE_FAILURES: 5,
    MAX_RETRIES: 3,
    TIMEOUT_MS: 15000,
    DISCOVERY_TIMEOUT_MS: 25000,
    DISCOVERY_LIMIT: 50,
    
    // Pool of standard Chrome/Edge/Safari/Firefox Headers
    HEADER_PROFILES: [
        {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            "sec-ch-ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
            "sec-ch-ua-platform": '"Windows"'
        },
        {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            "sec-ch-ua-platform": '"Windows"'
        },
        {
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            "sec-ch-ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
            "sec-ch-ua-platform": '"macOS"'
        },
        {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
            "sec-ch-ua": '"Microsoft Edge";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
            "sec-ch-ua-platform": '"Windows"'
        },
        {
            "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            "sec-ch-ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
            "sec-ch-ua-platform": '"Linux"'
        }
    ]
};

function getHeadersForAttempt(attemptIndex = 0) {
    const profile = CONFIG.HEADER_PROFILES[attemptIndex % CONFIG.HEADER_PROFILES.length];
    return {
        "accept": "application/json, text/plain, */*",
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "content-type": "application/json",
        "origin": "https://dichvucong.gov.vn",
        "referer": "https://dichvucong.gov.vn/p/home/dvc-thu-tuc-hanh-chinh.html",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": profile["user-agent"],
        "sec-ch-ua": profile["sec-ch-ua"],
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": profile["sec-ch-ua-platform"]
    };
}

// Standard HTTPS Agent with maximum 3 connection sockets
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: CONFIG.MAX_CONCURRENCY,
    maxFreeSockets: CONFIG.MAX_CONCURRENCY,
    rejectUnauthorized: false
});

// Atomic write utility to prevent partial/corrupted JSON writes on unexpected termination
function safeWriteJson(filePath, data) {
    const tmpPath = `${filePath}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        if (fs.existsSync(tmpPath)) {
            try { fs.unlinkSync(tmpPath); } catch (e) {}
        }
        // Fallback to direct write if rename fails
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
}

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
    safeWriteJson(CONFIG.CHECKPOINT_FILE, checkpoint);
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
// RESILIENT FETCH ENGINE WITH VERIFICATION & CIRCUIT BREAKER
// ============================================================
async function fetchVerifiedRequest(url, payload, checkpoint, customTimeout = CONFIG.TIMEOUT_MS) {
    for (let retry = 0; retry <= CONFIG.MAX_RETRIES; retry++) {
        try {
            const reqHeaders = getHeadersForAttempt(retry);
            const res = await axios.post(url, payload, {
                headers: reqHeaders,
                httpsAgent,
                timeout: customTimeout,
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
    console.log('\n=== CÔNG CỤ CÀO TTHC DVCQG (CHUẨN TẦM DOANH NGHIỆP - STABLE & SAFE) ===\n');

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

    // Đăng ký Handler ngắt đột ngột (SIGINT, SIGTERM) để lưu trạng thái an toàn
    const handleShutdown = () => {
        console.warn('\n⚠️ Nhận tín hiệu dừng tiến trình. Đang lưu Checkpoint & Index an toàn...');
        try {
            safeWriteJson(CONFIG.INDEX_FILE, indexData);
            saveCheckpoint(checkpoint);
            console.log('✅ Đã lưu tiến độ thành công trước khi thoát.');
        } catch (e) {}
        process.exit(0);
    };
    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);

    // 4. Thu thập danh mục TTHC Toàn quốc (Discovery Caching & Execution)
    let rawList = [];

    if (fs.existsSync(CONFIG.DISCOVERY_FILE)) {
        try {
            const cacheData = JSON.parse(fs.readFileSync(CONFIG.DISCOVERY_FILE, 'utf8'));
            const cacheAgeHours = (Date.now() - new Date(cacheData.savedAt).getTime()) / (1000 * 3600);
            const isCI = process.env.GITHUB_ACTIONS === 'true';
            
            if (Array.isArray(cacheData.items) && cacheData.items.length > 0 && (cacheAgeHours < 24 || isCI)) {
                rawList = cacheData.items;
                console.log(`⚡ Đã nạp ${rawList.length} TTHC từ Discovery Cache (Tuổi cache: ${cacheAgeHours.toFixed(1)}h | CI Mode: ${isCI}).`);
            }
        } catch (e) {
            console.warn(`⚠️ Bỏ qua Discovery cache hỏng: ${e.message}`);
        }
    }

    if (rawList.length === 0) {
        let lastId = "";
        let currentLimit = CONFIG.DISCOVERY_LIMIT;
        console.log(`🚀 Đang đồng bộ danh mục TTHC toàn quốc từ máy chủ (Discovery Engine - Limit: ${currentLimit})...`);

        try {
            while (true) {
                const payload = { limit: currentLimit, lastId: lastId, q: "", categoryId: "", departmentCode: "" };
                let res;
                try {
                    res = await fetchVerifiedRequest(
                        'https://dichvucong.gov.vn/api/v1/submitting/formality/list-all-public-formality-by-citizen',
                        payload,
                        checkpoint,
                        CONFIG.DISCOVERY_TIMEOUT_MS
                    );
                } catch (pageErr) {
                    if (currentLimit > 25) {
                        currentLimit = 25;
                        console.warn(`⚠️ Discovery gặp lỗi với limit=${payload.limit}. Tự động giảm limit xuống ${currentLimit} và thử lại...`);
                        continue;
                    }
                    throw pageErr;
                }

                if (!res || !res.data || !res.data.items || res.data.items.length === 0) break;
                res.data.items.forEach(item => rawList.push(item));

                if (!res.data.lastId || res.data.lastId === lastId) break;
                lastId = res.data.lastId;
                console.log(`   Đã tìm thấy: ${rawList.length} mã TTHC`);
                await politeDelay();
            }

            if (rawList.length > 0) {
                // Ghi Discovery Cache an toàn
                safeWriteJson(CONFIG.DISCOVERY_FILE, {
                    savedAt: new Date().toISOString(),
                    totalItems: rawList.length,
                    items: rawList
                });
            }

        } catch (err) {
            if (checkpoint.status === 'CIRCUIT_BREAKER_TRIPPED') {
                console.error(`\n🛑 CIRCUIT BREAKER TRIGGERED TRONG DISCOVERY: ${err.message}`);
            } else {
                console.error(`⚠️ Lỗi khi lấy danh mục từ máy chủ: ${err.message}`);
            }
        }

        // Multitier Fallback: Nếu không lấy được danh mục mới từ mạng, nạp từ Discovery Cache cũ hoặc Index hiện có
        if (rawList.length === 0) {
            console.warn(`🔄 Đang kích hoạt Fallback phục hồi danh mục từ Cache / Index dữ liệu...`);
            if (fs.existsSync(CONFIG.DISCOVERY_FILE)) {
                try {
                    const cacheData = JSON.parse(fs.readFileSync(CONFIG.DISCOVERY_FILE, 'utf8'));
                    if (Array.isArray(cacheData.items) && cacheData.items.length > 0) {
                        rawList = cacheData.items;
                        console.log(`⚡ Fallback 1 thành công: Nạp ${rawList.length} TTHC từ Discovery Cache lưu trước đó.`);
                    }
                } catch (e) {}
            }
            if (rawList.length === 0 && indexData.length > 0) {
                rawList = indexData.map(item => ({
                    id: item.id,
                    code: item.ma_tthc,
                    name: item.ten_tthc
                }));
                console.log(`⚡ Fallback 2 thành công: Nạp ${rawList.length} TTHC từ Index hiện tại trên đĩa.`);
            }
        }
    }

    console.log(`✅ Tổng số TTHC phát hiện: ${rawList.length}`);

    // 5. Tải chi tiết từng TTHC — TỐI ĐA 3 KẾT NỐI SONG SONG (MAX CONCURRENCY = 3)
    if (rawList.length > 0) {
        console.log(`⚡ Tiến hành tải chi tiết cho: ${rawList.length} thủ tục (Tối đa 3 kết nối song song + Checkpoint liên tục)...\n`);
        
        let successCount = Object.keys(checkpoint.completedIds).length;
        let skippedCount = 0;
        const chunkSize = CONFIG.MAX_CONCURRENCY;
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
                const results = await Promise.all(pending.map(async (item) => {
                    const detailFilePath = path.join(CONFIG.DETAILS_DIR, `${item.id}.json`);
                    try {
                        const res = await fetchVerifiedRequest(
                            'https://dichvucong.gov.vn/api/v1/configuring/formality/get-formality-by-citizen',
                            { id: item.id },
                            checkpoint
                        );

                        if (res && res.data) {
                            let detail = res.data.data || res.data;

                            const formalityItem = {
                                id: item.id,
                                ma_tthc: item.code,
                                ten_tthc: item.name,
                                cap_thuc_hien: parseFormalityCaseLevel(detail),
                                loai_tthc: parseFormalityType(item.type || detail.formalityType),
                                linh_vuc: (item.categories && item.categories.length > 0) ? item.categories.join(', ') : '',
                                co_quan_thuc_hien: detail.executingAgencies || (item.departments ? item.departments.join(', ') : '')
                            };

                            const cleanDetail = sanitizeBase64(detail);
                            safeWriteJson(detailFilePath, cleanDetail);

                            return { success: true, item, formalityItem };
                        }
                    } catch (err) {
                        return { success: false, item, error: err.message };
                    }
                    return { success: false, item, error: 'Unknown Error' };
                }));

                // Cập nhật State & Checkpoint an toàn theo từng đợt Batch (Thread-Safe)
                for (const res of results) {
                    if (res.success) {
                        const existingIdx = indexData.findIndex(x => x.id === res.item.id);
                        if (existingIdx >= 0) {
                            indexData[existingIdx] = res.formalityItem;
                        } else {
                            indexData.push(res.formalityItem);
                        }

                        checkpoint.completedIds[res.item.id] = {
                            code: res.item.code,
                            timestamp: new Date().toISOString(),
                            verified: true
                        };
                        delete checkpoint.failedIds[res.item.id];
                        successCount++;
                    } else {
                        checkpoint.failedIds[res.item.id] = {
                            code: res.item.code,
                            timestamp: new Date().toISOString(),
                            error: res.error
                        };
                    }
                }
                saveCheckpoint(checkpoint);
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

            await politeDelay();
        }

        // 6. Ghi xuất bản Index & Version
        safeWriteJson(CONFIG.INDEX_FILE, indexData);
        const versionInfo = {
            last_updated: new Date().toISOString(),
            total_records: indexData.length,
            completed_records: Object.keys(checkpoint.completedIds).length,
            failed_records: Object.keys(checkpoint.failedIds).length,
            circuit_breaker_status: checkpoint.status
        };
        safeWriteJson(CONFIG.VERSION_FILE, versionInfo);

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