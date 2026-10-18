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
    SNAPSHOT_FILE: path.join(process.cwd(), 'data', 'snapshot.json'),
    COMPARE_REPORT_FILE: path.join(process.cwd(), 'data', 'compare_report.json'),
    
    // Request concurrency settings (Tối đa 5 kết nối song song với Jitter)
    MAX_CONCURRENCY: parseInt(process.env.MAX_CONCURRENCY, 10) || 5,
    BASE_DELAY_MS: 300,
    JITTER_MS: 200,
    
    // Circuit Breaker settings
    MAX_CONSECUTIVE_FAILURES: 5,
    MAX_RETRIES: 3,
    TIMEOUT_MS: 20000,
    DISCOVERY_TIMEOUT_MS: 35000,
    DISCOVERY_LIMIT: 50,

    
    // Pool đa dạng các Browser Profile (Chrome, Edge, Firefox, Safari, Opera trên Windows, macOS, Linux, Android)
    HEADER_PROFILES: [
        {
            "name": "Chrome 126 - Windows 11",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
            "sec-ch-ua-platform": '"Windows"',
            "sec-ch-ua-mobile": "?0",
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5"
        },
        {
            "name": "Chrome 125 - macOS Sonoma",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "sec-ch-ua": '"Google Chrome";v="125", "Chromium";v="125", "Not?A_Brand";v="24"',
            "sec-ch-ua-platform": '"macOS"',
            "sec-ch-ua-mobile": "?0",
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
        },
        {
            "name": "Microsoft Edge 125 - Windows 11",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
            "sec-ch-ua": '"Microsoft Edge";v="125", "Chromium";v="125", "Not=A?Brand";v="24"',
            "sec-ch-ua-platform": '"Windows"',
            "sec-ch-ua-mobile": "?0",
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi;q=0.9,en;q=0.8"
        },
        {
            "name": "Firefox 126 - Windows 11",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi;q=0.8,en-US;q=0.5,en;q=0.3"
        },
        {
            "name": "Safari 17.4 - macOS Sonoma",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi-VN;q=0.9,en-US;q=0.8,en;q=0.7"
        },
        {
            "name": "Opera 109 - Windows 11",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0",
            "sec-ch-ua": '"Opera";v="109", "Chromium";v="123", "Not:A-Brand";v="8"',
            "sec-ch-ua-platform": '"Windows"',
            "sec-ch-ua-mobile": "?0",
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
        },
        {
            "name": "Chrome 125 - Linux x86_64",
            "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "sec-ch-ua": '"Google Chrome";v="125", "Chromium";v="125", "Not?A_Brand";v="24"',
            "sec-ch-ua-platform": '"Linux"',
            "sec-ch-ua-mobile": "?0",
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
        },
        {
            "name": "Firefox 125 - macOS",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
        },
        {
            "name": "Microsoft Edge 124 - macOS",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
            "sec-ch-ua": '"Microsoft Edge";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
            "sec-ch-ua-platform": '"macOS"',
            "sec-ch-ua-mobile": "?0",
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
        },
        {
            "name": "Chrome 124 - Android Mobile",
            "user-agent": "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.179 Mobile Safari/537.36",
            "sec-ch-ua": '"Android WebView";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
            "sec-ch-ua-platform": '"Android"',
            "sec-ch-ua-mobile": "?1",
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
        }
    ]
};

let globalHeaderIndex = 0;

function getHeadersForAttempt(attemptIndex = 0) {
    const profileIndex = (globalHeaderIndex++ + attemptIndex) % CONFIG.HEADER_PROFILES.length;
    const profile = CONFIG.HEADER_PROFILES[profileIndex];

    const headers = {
        "accept": profile.accept || "application/json, text/plain, */*",
        "accept-language": profile["accept-language"] || "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "accept-encoding": "gzip, deflate, br, zstd",
        "content-type": "application/json",
        "origin": "https://dichvucong.gov.vn",
        "referer": "https://dichvucong.gov.vn/p/home/dvc-thu-tuc-hanh-chinh.html",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": profile["user-agent"]
    };

    if (profile["sec-ch-ua"]) {
        headers["sec-ch-ua"] = profile["sec-ch-ua"];
        headers["sec-ch-ua-mobile"] = profile["sec-ch-ua-mobile"] || "?0";
        headers["sec-ch-ua-platform"] = profile["sec-ch-ua-platform"];
    }

    return headers;
}

// Standard HTTPS Agent với IPv4 Forcing (family: 4) & Keep-Alive ngắn để ngăn socket treo ETIMEDOUT
const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: CONFIG.MAX_CONCURRENCY,
    maxFreeSockets: CONFIG.MAX_CONCURRENCY,
    rejectUnauthorized: false,
    family: 4 // Ép dùng IPv4 14.238.3.76 tránh ETIMEDOUT trên IPv6 / DNS dual-stack
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
    const maxRetries = 4;
    for (let retry = 0; retry <= maxRetries; retry++) {
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
            const isNetworkTimeout = err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || (err.message && (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')));
            
            if (retry < maxRetries && (!isRejectionSignal || isNetworkTimeout)) {
                const baseWait = Math.pow(2, retry) * 1000;
                const jitter = Math.floor(Math.random() * 500);
                const waitTime = baseWait + jitter;
                console.warn(`   ⚠️ Lỗi kết nối (${err.message}) - Thử lại lần ${retry + 1}/${maxRetries} sau ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                // Chỉ tăng đếm Circuit Breaker khi gặp lỗi từ chối chủ động từ phía Server (429, 403, 5xx)
                if (!isNetworkTimeout) {
                    checkpoint.consecutiveFailures += 1;
                }
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

    // Hỗ trợ cờ --compare / --compare-only: Xuất báo cáo thống kê biến động & Excel ngay lập tức
    if (process.argv.includes('--compare') || process.argv.includes('--compare-only')) {
        console.log('⚡ Chế độ: Xuất báo cáo thống kê biến động toàn bộ TTHC (--compare)...');
        generateCompareReport(indexData);
        try {
            const { exportNationalExcel } = require('./scripts/export_excel');
            exportNationalExcel();
        } catch (excelErr) {
            console.warn('⚠️ Lỗi xuất Excel DVCQG:', excelErr.message);
        }
        return;
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

    // 4. Thu thập danh mục TTHC Toàn quốc (Discovery Engine - Always Live Discovery First)
    let rawList = [];
    let lastId = "";
    let currentLimit = CONFIG.DISCOVERY_LIMIT;
    
    console.log(`🚀 Đang đồng bộ danh mục TTHC mới nhất từ máy chủ DVCQG (Discovery Engine - Limit: ${currentLimit})...`);

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
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                } else if (currentLimit > 10) {
                    currentLimit = 10;
                    console.warn(`⚠️ Discovery vẫn gặp lỗi với limit=25. Tiếp tục giảm limit xuống ${currentLimit} và thử lại...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                }
                throw pageErr;
            }

            if (!res || !res.data || !res.data.items || res.data.items.length === 0) break;
            res.data.items.forEach(item => rawList.push(item));

            if (!res.data.lastId || res.data.lastId === lastId) break;
            lastId = res.data.lastId;
            console.log(`   Đã tìm thấy: ${rawList.length} mã TTHC từ máy chủ`);
            await politeDelay();
        }

        if (rawList.length > 0) {
            // Ghi nhận và cập nhật Discovery Cache mới nhất
            safeWriteJson(CONFIG.DISCOVERY_FILE, {
                savedAt: new Date().toISOString(),
                totalItems: rawList.length,
                items: rawList
            });
            console.log(`✅ Đồng bộ trực tiếp thành công ${rawList.length} TTHC từ máy chủ DVCQG.`);
        }

    } catch (err) {
        if (checkpoint.status === 'CIRCUIT_BREAKER_TRIPPED') {
            console.error(`\n🛑 CIRCUIT BREAKER TRIGGERED TRONG DISCOVERY: ${err.message}`);
        } else {
            console.error(`⚠️ Không thể kết nối lấy danh mục mới từ máy chủ (${err.message}). Kích hoạt Fallback...`);
        }
    }

    // Multitier Fallback: Nếu không lấy được danh mục mới từ mạng (do mạng lỗi/chặn IP), nạp từ Discovery Cache cũ hoặc Index hiện có
    if (rawList.length === 0) {
        console.warn(`🔄 Đang kích hoạt Fallback phục hồi danh mục từ Cache / Index dữ liệu cũ...`);
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

    console.log(`✅ Tổng số TTHC phát hiện: ${rawList.length}`);

    // 5. Tải chi tiết từng TTHC — TỐI ĐA KẾT NỐI SONG SONG (CONFIG.MAX_CONCURRENCY)
    if (rawList.length > 0) {
        console.log(`⚡ Tiến hành tải chi tiết cho: ${rawList.length} thủ tục (Tối đa ${CONFIG.MAX_CONCURRENCY} kết nối song song + Checkpoint liên tục)...\n`);
        
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
                                co_quan_thuc_hien: detail.executingAgencies || (item.departments ? item.departments.join(', ') : ''),
                                url: `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${item.id}`
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

        // 6. Ghi xuất bản Index & Thống kê biến động toàn bộ TTHC
        safeWriteJson(CONFIG.INDEX_FILE, indexData);

        // Kích hoạt engine so sánh và xuất dữ liệu thống kê biến động toàn bộ TTHC
        const compareReport = generateCompareReport(indexData);

        const versionInfo = {
            last_updated: new Date().toISOString(),
            total_records: indexData.length,
            completed_records: Object.keys(checkpoint.completedIds).length,
            failed_records: Object.keys(checkpoint.failedIds).length,
            circuit_breaker_status: checkpoint.status,
            compare_summary: compareReport ? compareReport.summary : null
        };
        safeWriteJson(CONFIG.VERSION_FILE, versionInfo);

        // Tự động xuất file Excel Báo cáo Master Data & Biến động DVCQG tại thư mục data
        try {
            const { exportNationalExcel } = require('./scripts/export_excel');
            exportNationalExcel();
        } catch (excelErr) {
            console.warn('⚠️ Lỗi tự động xuất Excel DVCQG:', excelErr.message);
        }

        if (checkpoint.status === 'CIRCUIT_BREAKER_TRIPPED') {
            process.exit(1);
        } else {
            checkpoint.status = 'COMPLETED';
            saveCheckpoint(checkpoint);
            console.log(`\n🎉 HOÀN TẤT AN TOÀN! Tổng số TTHC thành công: ${Object.keys(checkpoint.completedIds).length}/${rawList.length}`);
        }
    }
}

// ============================================================
// COMPARE ENGINE: THỐNG KÊ BIẾN ĐỘNG TOÀN BỘ TTHC
// ============================================================
function generateCompareReport(currentItems) {
    console.log('\n========================================================================');
    console.log('📊 BÁO CÁO THEO DÕI BIẾN ĐỘNG TOÀN BỘ TTHC (COMPARE ENGINE)');
    console.log('========================================================================\n');

    if (!Array.isArray(currentItems) || currentItems.length === 0) {
        console.warn('⚠️ Không có dữ liệu TTHC để thực hiện so sánh biến động.');
        return null;
    }

    const currentMap = new Map();
    currentItems.forEach(item => {
        const key = item.id || item.ma_tthc || item.code;
        if (key) {
            currentMap.set(key, {
                id: item.id || '',
                code: item.ma_tthc || item.code || '',
                name: item.ten_tthc || item.name || '',
                cap_thuc_hien: item.cap_thuc_hien || '',
                loai_tthc: item.loai_tthc || '',
                category: item.linh_vuc || (Array.isArray(item.categories) ? item.categories.join(', ') : ''),
                agency: item.co_quan_thuc_hien || (Array.isArray(item.departments) ? item.departments.join(', ') : ''),
                url: item.url || (item.id ? `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${item.id}` : '')
            });
        }
    });

    let previousMap = new Map();
    let hasSnapshot = false;

    if (fs.existsSync(CONFIG.SNAPSHOT_FILE)) {
        try {
            const prevRaw = JSON.parse(fs.readFileSync(CONFIG.SNAPSHOT_FILE, 'utf8'));
            if (Array.isArray(prevRaw) && prevRaw.length > 0) {
                prevRaw.forEach(item => {
                    const key = item.id || item.code || item.ma_tthc;
                    if (key) {
                        previousMap.set(key, {
                            id: item.id || '',
                            code: item.code || item.ma_tthc || '',
                            name: item.name || item.ten_tthc || '',
                            cap_thuc_hien: item.cap_thuc_hien || '',
                            loai_tthc: item.loai_tthc || '',
                            category: item.category || item.linh_vuc || '',
                            agency: item.agency || item.co_quan_thuc_hien || '',
                            url: item.url || (item.id ? `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${item.id}` : '')
                        });
                    }
                });
                hasSnapshot = true;
            }
        } catch (e) {
            console.warn(`⚠️ Tệp snapshot cũ hỏng hoặc không hợp lệ: ${e.message}`);
        }
    }

    const added = [];
    const removed = [];
    const modified = [];

    if (!hasSnapshot) {
        console.log(`📸 Chưa có Snapshot dữ liệu trước đó.`);
        console.log(`⚡ Tạo mới Snapshot khởi tạo ban đầu với: ${currentMap.size} TTHC.`);
        const snapshotItems = Array.from(currentMap.values());
        safeWriteJson(CONFIG.SNAPSHOT_FILE, snapshotItems);

        const initialReport = {
            compared_at: new Date().toISOString(),
            status: 'INITIAL_SNAPSHOT_CREATED',
            summary: {
                previous_total: 0,
                current_total: currentMap.size,
                net_change: currentMap.size,
                added_count: currentMap.size,
                removed_count: 0,
                modified_count: 0
            },
            added: snapshotItems,
            removed: [],
            modified: []
        };
        safeWriteJson(CONFIG.COMPARE_REPORT_FILE, initialReport);
        console.log(`✅ Đã xuất báo cáo khởi tạo vào: ${CONFIG.COMPARE_REPORT_FILE}\n`);
        return initialReport;
    }

    // So sánh: tìm thủ tục thêm mới & sửa đổi
    currentMap.forEach((currItem, key) => {
        if (!previousMap.has(key)) {
            added.push(currItem);
        } else {
            const prevItem = previousMap.get(key);
            const changes = [];
            if (prevItem.name !== currItem.name) changes.push({ field: 'Tên TTHC', old: prevItem.name, new: currItem.name });
            if (prevItem.code && currItem.code && prevItem.code !== currItem.code) changes.push({ field: 'Mã TTHC', old: prevItem.code, new: currItem.code });
            if (prevItem.cap_thuc_hien && currItem.cap_thuc_hien && prevItem.cap_thuc_hien !== currItem.cap_thuc_hien) changes.push({ field: 'Cấp thực hiện', old: prevItem.cap_thuc_hien, new: currItem.cap_thuc_hien });
            if (prevItem.agency && currItem.agency && prevItem.agency !== currItem.agency) changes.push({ field: 'Cơ quan thực hiện', old: prevItem.agency, new: currItem.agency });

            if (changes.length > 0) {
                modified.push({
                    id: currItem.id,
                    code: currItem.code,
                    name: currItem.name,
                    changes,
                    url: currItem.url
                });
            }
        }
    });

    // So sánh: tìm thủ tục bãi bỏ
    previousMap.forEach((prevItem, key) => {
        if (!currentMap.has(key)) {
            removed.push(prevItem);
        }
    });

    const netChange = currentMap.size - previousMap.size;
    const netSign = netChange >= 0 ? `+${netChange}` : `${netChange}`;

    console.log(`📈 THỐNG KÊ TỔNG QUAN BIẾN ĐỘNG TOÀN BỘ TTHC:`);
    console.log(`   • Số lượng TTHC kỳ trước: ${previousMap.size}`);
    console.log(`   • Số lượng TTHC hiện tại: ${currentMap.size}`);
    console.log(`   • Biến động ròng (Net):   ${netSign} TTHC`);
    console.log(`   • 🆕 Thêm mới:           ${added.length} TTHC`);
    console.log(`   • 🗑️ Bãi bỏ / Xóa:        ${removed.length} TTHC`);
    console.log(`   • ✏️ Thay đổi nội dung:   ${modified.length} TTHC\n`);

    if (added.length > 0) {
        console.log(`✨ DANH SÁCH TTHC MỚI BỔ SUNG (${added.length}):`);
        added.slice(0, 10).forEach((item, idx) => {
            console.log(`   ${idx + 1}. [${item.code || 'N/A'}] ${item.name} (${item.category || item.agency || 'N/A'})`);
        });
        if (added.length > 10) console.log(`   ... và ${added.length - 10} TTHC mới khác.`);
        console.log('');
    }

    if (removed.length > 0) {
        console.log(`❌ DANH SÁCH TTHC ĐÃ BÃI BỎ (${removed.length}):`);
        removed.slice(0, 10).forEach((item, idx) => {
            console.log(`   ${idx + 1}. [${item.code || 'N/A'}] ${item.name}`);
        });
        if (removed.length > 10) console.log(`   ... và ${removed.length - 10} TTHC bãi bỏ khác.`);
        console.log('');
    }

    if (modified.length > 0) {
        console.log(`✏️ DANH SÁCH TTHC CÓ THAY ĐỔI (${modified.length}):`);
        modified.slice(0, 10).forEach((item, idx) => {
            const desc = item.changes.map(c => `${c.field}: "${c.old}" ➔ "${c.new}"`).join(' | ');
            console.log(`   ${idx + 1}. [${item.code || 'N/A'}] ${item.name} -> ${desc}`);
        });
        if (modified.length > 10) console.log(`   ... và ${modified.length - 10} TTHC thay đổi khác.`);
        console.log('');
    }

    const report = {
        compared_at: new Date().toISOString(),
        summary: {
            previous_total: previousMap.size,
            current_total: currentMap.size,
            net_change: netChange,
            added_count: added.length,
            removed_count: removed.length,
            modified_count: modified.length
        },
        added,
        removed,
        modified
    };

    safeWriteJson(CONFIG.COMPARE_REPORT_FILE, report);
    console.log(`💾 Chi tiết báo cáo biến động đã lưu vào: ${CONFIG.COMPARE_REPORT_FILE}`);

    // Cập nhật Snapshot cho kỳ tiếp theo
    const snapshotItems = Array.from(currentMap.values());
    safeWriteJson(CONFIG.SNAPSHOT_FILE, snapshotItems);
    console.log(`📸 Đã cập nhật Snapshot mới nhất cho lần so sánh tiếp theo.`);
    console.log('========================================================================\n');

    return report;
}

main().catch(err => {
    console.error('❌ Lỗi hệ thống ngoài dự kiến:', err.message);
    process.exit(1);
});