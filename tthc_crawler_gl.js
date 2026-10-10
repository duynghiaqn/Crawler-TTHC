const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

const {
    isEligibleGiaLai,
    checkExclusionReason,
    getLevelLabel,
    parseFormalityType,
    parseFormalityCaseLevel
} = require('./scripts/filter_gia_lai');

// ============================================================
// CONFIGURATION & CONSTANTS FOR GIA LAI CRAWLER
// ============================================================
const CONFIG = {
    // Thư mục dữ liệu chuyên biệt cho Tỉnh Gia Lai
    DATA_DIR: path.join(process.cwd(), 'data-gl'),
    DETAILS_DIR: path.join(process.cwd(), 'data-gl', 'details'),
    CHECKPOINT_FILE: path.join(process.cwd(), 'data-gl', 'checkpoint.json'),
    INDEX_FILE: path.join(process.cwd(), 'data-gl', 'index.json'),
    VERSION_FILE: path.join(process.cwd(), 'data-gl', 'version.json'),
    DISCOVERY_FILE: path.join(process.cwd(), 'data-gl', 'discovery.json'),
    SNAPSHOT_FILE: path.join(process.cwd(), 'data-gl', 'snapshot.json'),

    // Nguồn dữ liệu tổng (nếu có để hỗ trợ Fast Sync thông minh)
    MASTER_DATA_DIR: path.join(process.cwd(), 'data'),
    MASTER_DETAILS_DIR: path.join(process.cwd(), 'data', 'details'),
    MASTER_DISCOVERY_FILE: path.join(process.cwd(), 'data', 'discovery.json'),

    // Low request rate settings (Conservative concurrency = 3 with Jitter)
    MAX_CONCURRENCY: 3,
    BASE_DELAY_MS: 300,
    JITTER_MS: 200,

    // Circuit Breaker settings
    MAX_CONSECUTIVE_FAILURES: 5,
    MAX_RETRIES: 3,
    TIMEOUT_MS: 20000,
    DISCOVERY_TIMEOUT_MS: 35000,
    DISCOVERY_LIMIT: 50,

    // Pool đa dạng các Browser Profile
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

// Standard HTTPS Agent với IPv4 Forcing (family: 4) & Keep-Alive ngắn
const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: CONFIG.MAX_CONCURRENCY,
    maxFreeSockets: CONFIG.MAX_CONCURRENCY,
    rejectUnauthorized: false,
    family: 4
});

// Atomic write utility to prevent partial/corrupted JSON writes
function safeWriteJson(filePath, data) {
    const tmpPath = `${filePath}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        if (fs.existsSync(tmpPath)) {
            try { fs.unlinkSync(tmpPath); } catch (e) {}
        }
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
            console.warn(`⚠️ Lỗi khi đọc checkpoint cũ data-gl, khởi tạo mới: ${e.message}`);
        }
    }
    return {
        completedIds: {},
        excludedIds: {},
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

function sanitizeBase64(obj) {
    let str = JSON.stringify(obj);
    str = str.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/g, '[Hình ảnh đính kèm trên DVCQG]');
    return JSON.parse(str);
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

            if (res.status === 429 || res.status === 403 || res.status >= 500) {
                const signalError = new Error(`Server rejection signal HTTP ${res.status}`);
                signalError.statusCode = res.status;
                throw signalError;
            }

            if (!res.data || (res.data.code !== 'OK' && res.data.code !== 200 && !res.data.data && !res.data.items)) {
                throw new Error(`Payload verification failed (Response code: ${res.data ? res.data.code : 'INVALID'})`);
            }

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
                if (!isNetworkTimeout) {
                    checkpoint.consecutiveFailures += 1;
                }
                console.error(`   ❌ Request thất bại [Lỗi liên tiếp: ${checkpoint.consecutiveFailures}/${CONFIG.MAX_CONSECUTIVE_FAILURES}]: ${err.message}`);
                
                if (checkpoint.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
                    checkpoint.status = 'CIRCUIT_BREAKER_TRIPPED';
                    checkpoint.circuitBreakerReason = `Đã dừng chạy an toàn: Phát hiện ${checkpoint.consecutiveFailures} lỗi phản hồi liên tiếp (${err.message}).`;
                    saveCheckpoint(checkpoint);
                    throw new Error(checkpoint.circuitBreakerReason);
                }
                throw err;
            }
        }
    }
}

// ============================================================
// MAIN PIPELINE FOR GIA LAI CRAWLER
// ============================================================
async function main() {
    console.log('\n========================================================================');
    console.log('🏛️  CÔNG CỤ CÀO VÀ ĐỒNG BỘ TTHC TỈNH GIA LAI (TTHC_CRAWLER_GL)');
    console.log('    • Cấp thực hiện: Cấp tỉnh, Cấp xã (hoặc Cả 2 cấp)');
    console.log('    • Phạm vi: Áp dụng tại tỉnh Gia Lai (Chuẩn Quốc Gia + Mã địa phương H21)');
    console.log('    • Loại trừ ngành: Thuế, Ngân hàng, Tòa án, Hải quan, Công an');
    console.log('    • Thư mục đích: ./data-gl (details, index, checkpoint, snapshot, v.v.)');
    console.log('========================================================================\n');

    // 1. Khởi tạo thư mục data-gl
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

    // Đăng ký Handler ngắt đột ngột (SIGINT, SIGTERM)
    const handleShutdown = () => {
        console.warn('\n⚠️ Nhận tín hiệu dừng tiến trình. Đang lưu Checkpoint & Index an toàn vào data-gl...');
        try {
            safeWriteJson(CONFIG.INDEX_FILE, indexData);
            saveCheckpoint(checkpoint);
            console.log('✅ Đã lưu tiến độ data-gl thành công trước khi thoát.');
        } catch (e) {}
        process.exit(0);
    };
    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);

    // 4. Thu thập / Đồng bộ Discovery List
    let rawList = [];
    let lastId = "";
    let currentLimit = CONFIG.DISCOVERY_LIMIT;

    const forceFetch = process.argv.includes('--force-fetch');

    // Kiểm tra Discovery Cache cũ trong data-gl hoặc data trước
    if (!forceFetch) {
        if (fs.existsSync(CONFIG.DISCOVERY_FILE)) {
            try {
                const c = JSON.parse(fs.readFileSync(CONFIG.DISCOVERY_FILE, 'utf8'));
                if (Array.isArray(c.items) && c.items.length > 0) {
                    rawList = c.items;
                    console.log(`⚡ Nạp nhanh ${rawList.length} TTHC từ cache: data-gl/discovery.json`);
                }
            } catch (e) {}
        }

        if (rawList.length === 0 && fs.existsSync(CONFIG.MASTER_DISCOVERY_FILE)) {
            try {
                const c = JSON.parse(fs.readFileSync(CONFIG.MASTER_DISCOVERY_FILE, 'utf8'));
                if (Array.isArray(c.items) && c.items.length > 0) {
                    rawList = c.items;
                    console.log(`⚡ Kế thừa ${rawList.length} TTHC từ Discovery Cache tổng: data/discovery.json`);
                }
            } catch (e) {}
        }
    }

    // Nếu chưa có cache hoặc bị yêu cầu live-fetch, gọi Discovery Engine trực tiếp từ DVCQG
    if (rawList.length === 0) {
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
                safeWriteJson(CONFIG.DISCOVERY_FILE, {
                    savedAt: new Date().toISOString(),
                    totalItems: rawList.length,
                    items: rawList
                });
                console.log(`✅ Đồng bộ trực tiếp thành công ${rawList.length} TTHC từ máy chủ DVCQG.`);
            }
        } catch (err) {
            console.error(`⚠️ Không thể kết nối lấy danh mục mới từ máy chủ (${err.message}). Kích hoạt Fallback...`);
        }
    }

    // Multitier fallback nếu vẫn chưa có rawList
    if (rawList.length === 0) {
        if (fs.existsSync(CONFIG.MASTER_DETAILS_DIR)) {
            const files = fs.readdirSync(CONFIG.MASTER_DETAILS_DIR).filter(f => f.endsWith('.json'));
            if (files.length > 0) {
                rawList = files.map(f => {
                    const id = f.replace('.json', '');
                    return { id, code: id, name: id };
                });
                console.log(`⚡ Fallback từ ${rawList.length} file chi tiết trong data/details/`);
            }
        }
    }

    console.log(`✅ Tổng số TTHC đưa vào thẩm định bộ lọc Gia Lai: ${rawList.length}`);

    // 5. Thống kê & Phân loại bộ lọc
    const stats = {
        totalEvaluated: 0,
        eligibleGiaLai: 0,
        provinceOnly: 0,
        wardOnly: 0,
        bothProvinceAndWard: 0,
        excludedCounts: {
            'CÔNG AN': 0,
            'HẢI QUAN': 0,
            'THUẾ': 0,
            'NGÂN HÀNG': 0,
            'TÒA ÁN': 0,
            'CỤC_VỤ': 0,
            'TỈNH_KHÁC': 0,
            'CẤP_KHÁC': 0
        }
    };

    // Đọc các file đã xử lý trong checkpoint
    if (!checkpoint.completedIds) checkpoint.completedIds = {};
    if (!checkpoint.excludedIds) checkpoint.excludedIds = {};
    if (!checkpoint.failedIds) checkpoint.failedIds = {};

    console.log(`\n⚡ Bắt đầu tiến trình lọc & tải chi tiết cho TTHC Gia Lai...`);

    const chunkSize = CONFIG.MAX_CONCURRENCY;
    const startTime = Date.now();
    let indexMap = new Map();
    indexData.forEach(item => indexMap.set(item.id, item));

    for (let i = 0; i < rawList.length; i += chunkSize) {
        const chunk = rawList.slice(i, i + chunkSize);
        
        // Với từng item trong chunk:
        // 1. Kiểm tra xem đã có sẵn chi tiết trong data-gl/details chưa (tái thẩm định)
        // 2. Nếu chưa, kiểm tra trong data/details xem có thể Fast-Sync không
        // 3. Nếu chưa có ở cả 2, fetch live qua mạng từ DVCQG
        const pendingFetch = [];

        for (const item of chunk) {
            stats.totalEvaluated++;
            const glDetailPath = path.join(CONFIG.DETAILS_DIR, `${item.id}.json`);
            const masterDetailPath = path.join(CONFIG.MASTER_DETAILS_DIR, `${item.id}.json`);

            // Trường hợp A: Đã có file trong data-gl -> Kiểm tra lại theo bộ lọc mới nhất (loại bỏ Cục, Vụ)
            if (fs.existsSync(glDetailPath)) {
                try {
                    const detail = JSON.parse(fs.readFileSync(glDetailPath, 'utf8'));
                    const exReason = checkExclusionReason(detail);
                    if (exReason) {
                        try { fs.unlinkSync(glDetailPath); } catch (e) {}
                        delete checkpoint.completedIds[item.id];
                        indexMap.delete(item.id);
                        checkpoint.excludedIds[item.id] = {
                            code: item.code || detail.code,
                            reason: exReason,
                            timestamp: new Date().toISOString()
                        };
                        if (stats.excludedCounts[exReason] !== undefined) stats.excludedCounts[exReason]++;
                        continue;
                    } else if (checkpoint.completedIds[item.id]) {
                        stats.eligibleGiaLai++;
                        continue;
                    }
                } catch (e) {}
            }

            // Trường hợp B: Đã được đánh dấu loại trừ trong checkpoint
            if (checkpoint.excludedIds[item.id]) {
                const r = checkpoint.excludedIds[item.id].reason || 'LOẠI_TRỪ';
                if (stats.excludedCounts[r] !== undefined) stats.excludedCounts[r]++;
                continue;
            }

            // Trường hợp C: Đã có sẵn file trong data/details/ -> Đọc local Fast-Sync
            if (fs.existsSync(masterDetailPath)) {
                try {
                    const detail = JSON.parse(fs.readFileSync(masterDetailPath, 'utf8'));
                    const exReason = checkExclusionReason(detail);

                    if (exReason) {
                        checkpoint.excludedIds[item.id] = {
                            code: item.code || detail.code,
                            reason: exReason,
                            timestamp: new Date().toISOString()
                        };
                        if (stats.excludedCounts[exReason] !== undefined) {
                            stats.excludedCounts[exReason]++;
                        }
                    } else {
                        // Thỏa mãn chuẩn TTHC Gia Lai!
                        const cleanDetail = sanitizeBase64(detail);
                        safeWriteJson(glDetailPath, cleanDetail);

                        const isProvince = Boolean(detail.isProvince || detail.type === 'PROVINCE');
                        const isWard = Boolean(detail.isWard || detail.type === 'WARD');

                        const formalityItem = {
                            id: item.id,
                            ma_tthc: detail.code || detail.codeNotation || item.code || '',
                            ten_tthc: detail.name || item.name || '',
                            cap_thuc_hien: parseFormalityCaseLevel(detail),
                            isProvince,
                            isWard,
                            level_label: getLevelLabel(detail),
                            loai_tthc: parseFormalityType(item.type || detail.formalityType),
                            linh_vuc: (item.categories && item.categories.length > 0) ? item.categories.join(', ') : (detail.category ? (detail.category.name || detail.category) : ''),
                            co_quan_ban_hanh: detail.departmentPromulgateName || detail.departmentPromulgate || '',
                            co_quan_thuc_hien: detail.executingAgencies || (item.departments ? item.departments.join(', ') : '') || '',
                            url: (item.id || detail.id)
                                ? `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${item.id || detail.id}`
                                : `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${detail.code || detail.codeNotation || item.code}`
                        };

                        indexMap.set(item.id, formalityItem);
                        checkpoint.completedIds[item.id] = {
                            code: formalityItem.ma_tthc,
                            timestamp: new Date().toISOString(),
                            verified: true
                        };
                        stats.eligibleGiaLai++;
                    }
                    continue;
                } catch (readErr) {
                    // Nếu lỗi đọc file, đẩy sang fetch live
                }
            }

            // Trường hợp D: Cần fetch trực tiếp từ DVCQG qua mạng
            pendingFetch.push(item);
        }

        // Thực hiện fetch live cho pendingFetch
        if (pendingFetch.length > 0) {
            const results = await Promise.all(pendingFetch.map(async (item) => {
                const glDetailPath = path.join(CONFIG.DETAILS_DIR, `${item.id}.json`);
                try {
                    const res = await fetchVerifiedRequest(
                        'https://dichvucong.gov.vn/api/v1/configuring/formality/get-formality-by-citizen',
                        { id: item.id },
                        checkpoint
                    );

                    if (res && res.data) {
                        let detail = res.data.data || res.data;
                        const exReason = checkExclusionReason(detail);

                        if (exReason) {
                            return { success: true, item, excluded: true, reason: exReason };
                        }

                        const cleanDetail = sanitizeBase64(detail);
                        safeWriteJson(glDetailPath, cleanDetail);

                        const isProvince = Boolean(detail.isProvince || detail.type === 'PROVINCE');
                        const isWard = Boolean(detail.isWard || detail.type === 'WARD');

                        const formalityItem = {
                            id: item.id,
                            ma_tthc: detail.code || detail.codeNotation || item.code || '',
                            ten_tthc: detail.name || item.name || '',
                            cap_thuc_hien: parseFormalityCaseLevel(detail),
                            isProvince,
                            isWard,
                            level_label: getLevelLabel(detail),
                            loai_tthc: parseFormalityType(item.type || detail.formalityType),
                            linh_vuc: (item.categories && item.categories.length > 0) ? item.categories.join(', ') : (detail.category ? (detail.category.name || detail.category) : ''),
                            co_quan_ban_hanh: detail.departmentPromulgateName || detail.departmentPromulgate || '',
                            co_quan_thuc_hien: detail.executingAgencies || (item.departments ? item.departments.join(', ') : '') || '',
                            url: (item.id || detail.id)
                                ? `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${item.id || detail.id}`
                                : `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${detail.code || detail.codeNotation || item.code}`
                        };

                        return { success: true, item, excluded: false, formalityItem };
                    }
                } catch (err) {
                    return { success: false, item, error: err.message };
                }
                return { success: false, item, error: 'Unknown Error' };
            }));

            for (const res of results) {
                if (res.success) {
                    if (res.excluded) {
                        checkpoint.excludedIds[res.item.id] = {
                            code: res.item.code,
                            reason: res.reason,
                            timestamp: new Date().toISOString()
                        };
                        if (stats.excludedCounts[res.reason] !== undefined) {
                            stats.excludedCounts[res.reason]++;
                        }
                    } else {
                        indexMap.set(res.item.id, res.formalityItem);
                        checkpoint.completedIds[res.item.id] = {
                            code: res.item.code,
                            timestamp: new Date().toISOString(),
                            verified: true
                        };
                        delete checkpoint.failedIds[res.item.id];
                        stats.eligibleGiaLai++;
                    }
                } else {
                    checkpoint.failedIds[res.item.id] = {
                        code: res.item.code,
                        timestamp: new Date().toISOString(),
                        error: res.error
                    };
                }
            }

            await politeDelay();
        }

        // Lưu Checkpoint định kỳ mỗi 150 items
        if ((i + chunkSize) % 150 < chunkSize || i + chunkSize >= rawList.length) {
            indexData = Array.from(indexMap.values());
            safeWriteJson(CONFIG.INDEX_FILE, indexData);
            saveCheckpoint(checkpoint);

            const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
            const pct = (((i + chunkSize) / rawList.length) * 100).toFixed(1);
            console.log(`   [${pct}% | ${Math.min(i + chunkSize, rawList.length)}/${rawList.length}] 🏛️ Gia Lai: ${indexMap.size} TTHC | 🚫 Loại trừ: ${Object.keys(checkpoint.excludedIds).length} | ⏱️ ${elapsedMin}m`);
        }

        if (checkpoint.status === 'CIRCUIT_BREAKER_TRIPPED') {
            console.error(`\n🛑 CIRCUIT BREAKER TRIGGERED! Dừng lại an toàn.\n`);
            break;
        }
    }

    // 6. Tổng hợp dữ liệu cuối cùng và phân cấp
    indexData = Array.from(indexMap.values());
    safeWriteJson(CONFIG.INDEX_FILE, indexData);

    const provinceOnlyItems = indexData.filter(x => x.isProvince && !x.isWard);
    const wardOnlyItems = indexData.filter(x => !x.isProvince && x.isWard);
    const bothItems = indexData.filter(x => x.isProvince && x.isWard);

    // Lưu snapshot phục vụ so sánh biến động cho Gia Lai
    safeWriteJson(CONFIG.SNAPSHOT_FILE, indexData);

    checkpoint.status = 'COMPLETED';
    saveCheckpoint(checkpoint);

    // Lưu version info
    const versionInfo = {
        last_updated: new Date().toISOString(),
        province_name: "Tỉnh Gia Lai",
        province_code: "H21",
        total_eligible_records: indexData.length,
        province_records: provinceOnlyItems.length + bothItems.length,
        ward_records: wardOnlyItems.length + bothItems.length,
        breakdown: {
            province_only: provinceOnlyItems.length,
            ward_only: wardOnlyItems.length,
            both_province_and_ward: bothItems.length
        },
        excluded_summary: {
            police: Object.values(checkpoint.excludedIds).filter(x => x.reason === 'CÔNG AN').length,
            customs: Object.values(checkpoint.excludedIds).filter(x => x.reason === 'HẢI QUAN').length,
            tax: Object.values(checkpoint.excludedIds).filter(x => x.reason === 'THUẾ').length,
            bank: Object.values(checkpoint.excludedIds).filter(x => x.reason === 'NGÂN HÀNG').length,
            court: Object.values(checkpoint.excludedIds).filter(x => x.reason === 'TÒA ÁN').length,
            cuc_vu: Object.values(checkpoint.excludedIds).filter(x => x.reason === 'CỤC_VỤ').length,
            other_provinces: Object.values(checkpoint.excludedIds).filter(x => x.reason === 'TỈNH_KHÁC').length,
            other_levels: Object.values(checkpoint.excludedIds).filter(x => x.reason === 'CẤP_KHÁC').length
        },
        circuit_breaker_status: checkpoint.status
    };
    safeWriteJson(CONFIG.VERSION_FILE, versionInfo);

    // 7. In Báo cáo Tổng kết ra màn hình
    console.log('\n========================================================================');
    console.log('🎉 THU THẬP & ĐỒNG BỘ DỮ LIỆU TTHC GIA LAI HOÀN TẤT THÀNH CÔNG!');
    console.log('========================================================================');
    console.log(`📁 Thư mục lưu trữ: ${CONFIG.DATA_DIR}`);
    console.log(`🏛️ Tổng số TTHC áp dụng tại Tỉnh Gia Lai: ${indexData.length} thủ tục`);
    console.log(`   • Thẩm quyền Cấp Tỉnh: ${provinceOnlyItems.length + bothItems.length} TTHC (${provinceOnlyItems.length} chỉ tỉnh + ${bothItems.length} cả 2 cấp)`);
    console.log(`   • Thẩm quyền Cấp Xã:   ${wardOnlyItems.length + bothItems.length} TTHC (${wardOnlyItems.length} chỉ xã + ${bothItems.length} cả 2 cấp)`);
    console.log(`\n🚫 Thống kê các TTHC đã được loại trừ tự động:`);
    console.log(`   • Ngành Công an:             ${versionInfo.excluded_summary.police} TTHC`);
    console.log(`   • Cơ quan Cục, Vụ (T.Ư):     ${versionInfo.excluded_summary.cuc_vu} TTHC`);
    console.log(`   • Ngành Hải quan:            ${versionInfo.excluded_summary.customs} TTHC`);
    console.log(`   • Ngành Thuế:                ${versionInfo.excluded_summary.tax} TTHC`);
    console.log(`   • Ngành Ngân hàng:           ${versionInfo.excluded_summary.bank} TTHC`);
    console.log(`   • Ngành Tòa án:              ${versionInfo.excluded_summary.court} TTHC`);
    console.log(`   • Đặc thù tỉnh/thành khác:   ${versionInfo.excluded_summary.other_provinces} TTHC`);
    console.log(`   • Thẩm quyền cấp khác:       ${versionInfo.excluded_summary.other_levels} TTHC`);
    console.log('========================================================================\n');

    // Tự động kích hoạt compare hoặc export excel nếu có yêu cầu
    if (process.argv.includes('--export-excel')) {
        try {
            const { exportTTHCExcel } = require('./scripts/export_excel');
            exportTTHCExcel();
        } catch (e) {
            console.warn('⚠️ Lỗi tự động xuất Excel:', e.message);
        }
    }
}

main().catch(err => {
    console.error('❌ Lỗi hệ thống ngoài dự kiến:', err.message);
    process.exit(1);
});
