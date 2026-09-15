const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
require('dotenv').config();

// Kích hoạt stealth plugin — patch toàn diện navigator, CDP, canvas, WebGL
puppeteerExtra.use(StealthPlugin());

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception:', error);
});

// ============================================================
// CẤU HÌNH CHỐNG WAF — TẤT CẢ THAM SỐ ĐIỀU CHỈNH Ở ĐÂY
// ============================================================
const CONFIG = {
    // Delay ngẫu nhiên giữa mỗi request đơn lẻ (ms)
    REQUEST_DELAY_MIN: 1500,
    REQUEST_DELAY_MAX: 4000,

    // Delay giữa mỗi chunk (nhóm request)
    CHUNK_DELAY_MIN: 3000,
    CHUNK_DELAY_MAX: 8000,

    // Xử lý tuần tự trong chunk (không concurrent) để giảm burst
    CHUNK_SIZE: 1,

    // "Micro-pause" — nghỉ dài ngẫu nhiên mô phỏng người dùng đọc trang
    PAUSE_CHANCE: 0.08,          // 8% chance mỗi request
    PAUSE_DURATION_MIN: 10000,   // 10s
    PAUSE_DURATION_MAX: 30000,   // 30s

    // WAF recovery
    WAF_BACKOFF_MIN: 30000,      // 30s chờ khi bị 403/429/503
    WAF_BACKOFF_MAX: 120000,     // 120s
    WAF_MAX_CONSECUTIVE: 3,      // Restart browser sau N lần bị block liên tiếp

    // Retry
    MAX_RETRIES: 8,
    REQUEST_TIMEOUT: 60000,      // 60s timeout cho mỗi API call

    // Warm-up
    BASE_URL: 'https://dichvucong.gov.vn',
    WARMUP_PAGE: 'https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc-hanh-chinh.html',
    WARMUP_WAIT_MIN: 3000,
    WARMUP_WAIT_MAX: 7000,

    // Headers cố định cho mọi fetch request (chống WAF same-origin check)
    API_REFERER: 'https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc-hanh-chinh.html',
    API_ORIGIN: 'https://dichvucong.gov.vn',
};

// ============================================================
// USER-AGENT PROFILES — Chrome 136-138 (cập nhật 2026)
// ============================================================
const USER_AGENT_PROFILES = [
    {
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        platform: "Win32",
        platformVersion: "15.0.0",
        vendor: "Google Inc.",
        secChUa: '"Chromium";v="138", "Google Chrome";v="138", "Not-A.Brand";v="99"',
        secChUaPlatform: '"Windows"',
        secChUaMobile: '?0',
    },
    {
        ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        platform: "MacIntel",
        platformVersion: "14.5.0",
        vendor: "Google Inc.",
        secChUa: '"Chromium";v="138", "Google Chrome";v="138", "Not-A.Brand";v="99"',
        secChUaPlatform: '"macOS"',
        secChUaMobile: '?0',
    },
    {
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        platform: "Win32",
        platformVersion: "10.0.0",
        vendor: "Google Inc.",
        secChUa: '"Chromium";v="137", "Google Chrome";v="137", "Not-A.Brand";v="99"',
        secChUaPlatform: '"Windows"',
        secChUaMobile: '?0',
    },
    {
        ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        platform: "Linux x86_64",
        platformVersion: "6.8.0",
        vendor: "Google Inc.",
        secChUa: '"Chromium";v="138", "Google Chrome";v="138", "Not-A.Brand";v="99"',
        secChUaPlatform: '"Linux"',
        secChUaMobile: '?0',
    },
    {
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
        platform: "Win32",
        platformVersion: "15.0.0",
        vendor: "Google Inc.",
        secChUa: '"Chromium";v="136", "Microsoft Edge";v="136", "Not-A.Brand";v="99"',
        secChUaPlatform: '"Windows"',
        secChUaMobile: '?0',
    },
    {
        ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        platform: "MacIntel",
        platformVersion: "14.0.0",
        vendor: "Google Inc.",
        secChUa: '"Chromium";v="137", "Google Chrome";v="137", "Not-A.Brand";v="99"',
        secChUaPlatform: '"macOS"',
        secChUaMobile: '?0',
    }
];

// ============================================================
// TIỆN ÍCH
// ============================================================
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Delay ngẫu nhiên trong khoảng [min, max] ms */
function randomDelay(min, max) {
    return delay(min + Math.floor(Math.random() * (max - min)));
}

/** Chọn random profile User-Agent */
function getRandomProfile() {
    return USER_AGENT_PROFILES[Math.floor(Math.random() * USER_AGENT_PROFILES.length)];
}

/** Format thời gian chờ dễ đọc */
function formatWait(ms) {
    return ms >= 60000 ? `${(ms / 60000).toFixed(1)} phút` : `${(ms / 1000).toFixed(1)}s`;
}

// ============================================================
// PUPPETEER BROWSER MANAGER
// ============================================================
class BrowserSession {
    constructor() {
        this.browser = null;
        this.page = null;
        this.profile = null;
        this.consecutiveBlocks = 0;
    }

    /** Khởi tạo trình duyệt Chromium headless với stealth settings */
    async launch() {
        this.profile = getRandomProfile();

        console.log(`🌐 Khởi tạo Chromium headless (puppeteer-extra-stealth)...`);
        console.log(`   User-Agent: ${this.profile.ua.substring(0, 70)}...`);

        this.browser = await puppeteerExtra.launch({
            headless: true,          // Puppeteer ≥ 22: true = new headless (không leak như 'new')
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-infobars',
                '--window-size=1920,1080',
                '--lang=vi-VN,vi,en-US,en',
                '--force-color-profile=srgb',
                '--disable-ipc-flooding-protection',
                '--enable-features=NetworkService,NetworkServiceLogging',
                '--ignore-certificate-errors',
            ],
            defaultViewport: {
                width: 1920,
                height: 1080,
                deviceScaleFactor: 1,
                hasTouch: false,
                isLandscape: true,
                isMobile: false,
            },
        });

        this.page = await this.browser.newPage();

        // Override User-Agent
        await this.page.setUserAgent(this.profile.ua);

        // Set Client Hints headers + Accept-Language (cần khớp với UA)
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
            'sec-ch-ua': this.profile.secChUa,
            'sec-ch-ua-mobile': this.profile.secChUaMobile,
            'sec-ch-ua-platform': this.profile.secChUaPlatform,
        });

        // Override navigator properties để ẩn dấu hiệu automation (fallback bên cạnh stealth plugin)
        await this.page.evaluateOnNewDocument((profile) => {
            // Stealth plugin đã xử lý webdriver, nhưng thêm fallback an toàn
            Object.defineProperty(navigator, 'platform', { get: () => profile.platform });
            Object.defineProperty(navigator, 'vendor', { get: () => profile.vendor });
            Object.defineProperty(navigator, 'languages', {
                get: () => ['vi-VN', 'vi', 'en-US', 'en']
            });

            // Mô phỏng hardware concurrency thực tế
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

            // Override chrome runtime (cần thiết cho các web app check)
            if (!window.chrome) {
                window.chrome = {
                    runtime: {},
                    loadTimes: function() {},
                    csi: function() {},
                    app: {}
                };
            }
        }, this.profile);

        // Thiết lập timezone Việt Nam
        await this.page.emulateTimezone('Asia/Ho_Chi_Minh');

        // Chặn tài nguyên không cần thiết để tăng tốc (images, fonts, media)
        await this.page.setRequestInterception(true);
        this.page.on('request', (request) => {
            const resourceType = request.resourceType();
            const url = request.url();

            // Chỉ chặn resource nặng, KHÔNG chặn document/script/xhr/fetch
            if (['image', 'font', 'media'].includes(resourceType)) {
                // Cho phép ảnh từ trang chủ trong quá trình warm-up để tránh bị detect
                if (url.includes(CONFIG.BASE_URL)) {
                    request.continue();
                } else {
                    request.abort();
                }
            } else {
                request.continue();
            }
        });

        console.log(`✅ Chromium headless đã sẵn sàng (stealth mode)`);
    }

    /** Warm-up nâng cao: truy cập trang chủ + giả lập hành vi người dùng */
    async warmup() {
        console.log(`🔄 Warm-up: Truy cập trang chủ để nhận session + cookies...`);
        try {
            await this.page.goto(CONFIG.WARMUP_PAGE, {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // Giả lập scroll để qua behavior analysis
            await this.page.evaluate(async () => {
                await new Promise(resolve => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= Math.min(document.body.scrollHeight, 800)) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 80 + Math.floor(Math.random() * 40)); // ~80-120ms mỗi scroll step
                });
            });

            // Đợi ngẫu nhiên — giả lập người đọc trang
            const waitTime = CONFIG.WARMUP_WAIT_MIN + Math.floor(Math.random() * (CONFIG.WARMUP_WAIT_MAX - CONFIG.WARMUP_WAIT_MIN));
            console.log(`   ⏳ Giả lập đọc trang ${formatWait(waitTime)}...`);
            await delay(waitTime);

            // Lấy cookies để log
            const cookies = await this.page.cookies();
            console.log(`   🍪 Đã nhận ${cookies.length} cookie(s) từ server`);
            console.log(`✅ Warm-up hoàn tất — session hợp lệ`);
        } catch (err) {
            console.warn(`⚠️ Warm-up gặp lỗi (vẫn tiếp tục): ${err.message}`);
        }
    }

    /** Gọi API POST từ bên trong browser context qua page.evaluate
     *  — Gửi đầy đủ headers giống browser thật: Referer, Origin, sec-fetch-*, sec-ch-ua
     */
    async fetchAPI(url, payload) {
        return await this.page.evaluate(async (url, payload, timeout, referer, origin, secChUa, secChUaMobile, secChUaPlatform) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/plain, */*',
                        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Origin': origin,
                        'Referer': referer,
                        'sec-fetch-site': 'same-origin',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-dest': 'empty',
                        'sec-ch-ua': secChUa,
                        'sec-ch-ua-mobile': secChUaMobile,
                        'sec-ch-ua-platform': secChUaPlatform,
                    },
                    body: JSON.stringify(payload),
                    credentials: 'include',     // Tự động gửi cookie session
                    signal: controller.signal,
                });

                clearTimeout(timer);

                if (!response.ok) {
                    return { __error: true, status: response.status, statusText: response.statusText };
                }

                const data = await response.json();
                return data;
            } catch (err) {
                clearTimeout(timer);
                return { __error: true, status: 0, statusText: err.message || 'Network Error' };
            }
        }, url, payload, CONFIG.REQUEST_TIMEOUT,
           CONFIG.API_REFERER, CONFIG.API_ORIGIN,
           this.profile.secChUa, this.profile.secChUaMobile, this.profile.secChUaPlatform
        );
    }

    /** Fetch với retry, WAF detection và human-like delays */
    async fetchWithRetry(url, payload, label = '') {
        for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
            // Human-like delay trước mỗi request (trừ lần đầu tiên)
            if (attempt > 0 || label) {
                await randomDelay(CONFIG.REQUEST_DELAY_MIN, CONFIG.REQUEST_DELAY_MAX);
            }

            // Micro-pause ngẫu nhiên — mô phỏng "nghỉ giải lao"
            if (Math.random() < CONFIG.PAUSE_CHANCE) {
                const pauseTime = CONFIG.PAUSE_DURATION_MIN + Math.floor(Math.random() * (CONFIG.PAUSE_DURATION_MAX - CONFIG.PAUSE_DURATION_MIN));
                console.log(`   ☕ Micro-pause ${formatWait(pauseTime)} (mô phỏng người dùng nghỉ)...`);
                await delay(pauseTime);
            }

            const result = await this.fetchAPI(url, payload);

            // Kiểm tra lỗi WAF
            if (result && result.__error) {
                const status = result.status;

                // WAF block: 403, 429, 503
                if (status === 403 || status === 429 || status === 503) {
                    this.consecutiveBlocks++;
                    const backoffTime = CONFIG.WAF_BACKOFF_MIN + Math.floor(Math.random() * (CONFIG.WAF_BACKOFF_MAX - CONFIG.WAF_BACKOFF_MIN));

                    console.warn(`🛡️ WAF BLOCK (HTTP ${status}) — Lần ${this.consecutiveBlocks}/${CONFIG.WAF_MAX_CONSECUTIVE}`);
                    console.warn(`   ⏳ Chờ ${formatWait(backoffTime)} trước khi thử lại...`);
                    await delay(backoffTime);

                    // Quá nhiều lần bị block → restart browser hoàn toàn
                    if (this.consecutiveBlocks >= CONFIG.WAF_MAX_CONSECUTIVE) {
                        console.warn(`🔄 Quá ${CONFIG.WAF_MAX_CONSECUTIVE} lần bị block — RESTART BROWSER...`);
                        await this.restart();
                    }

                    continue;
                }

                // Lỗi khác (timeout, network error)
                if (attempt < CONFIG.MAX_RETRIES) {
                    const waitTime = Math.min(Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 1000), 20000);
                    console.log(`⚠️ Lỗi (${result.statusText}), thử lại ${attempt + 1}/${CONFIG.MAX_RETRIES} sau ${formatWait(waitTime)}...`);
                    await delay(waitTime);
                    continue;
                }

                throw new Error(`Fetch failed after ${CONFIG.MAX_RETRIES} retries: HTTP ${status} ${result.statusText}`);
            }

            // Thành công — reset counter
            this.consecutiveBlocks = 0;
            return result;
        }
    }

    /** Restart browser hoàn toàn — session mới, profile mới */
    async restart() {
        console.log(`🔄 Đang restart browser...`);
        try {
            if (this.browser) await this.browser.close();
        } catch (e) { /* ignore */ }

        this.consecutiveBlocks = 0;
        await this.launch();
        await this.warmup();
        console.log(`✅ Browser đã restart xong — session mới`);
    }

    /** Đóng browser */
    async close() {
        try {
            if (this.browser) await this.browser.close();
        } catch (e) { /* ignore */ }
    }
}

// ============================================================
// LOGIC NGHIỆP VỤ (GIỮ NGUYÊN TỪ BẢN GỐC)
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
// MAIN — CRAWLER PIPELINE
// ============================================================
async function main() {
    console.log('\n=== CÔNG CỤ XÂY DỰNG DATA JSON (PUPPETEER STEALTH ANTI-WAF) ===\n');

    const session = new BrowserSession();

    try {
        // 1. Khởi tạo trình duyệt & warm-up session
        await session.launch();
        await session.warmup();

        // 2. Chuẩn bị thư mục output
        const DATA_DIR = './data';
        const DETAILS_DIR = `${DATA_DIR}/details`;

        if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.mkdirSync(DETAILS_DIR, { recursive: true });

        // 3. Thu thập danh mục TTHC
        let rawList = [];
        let lastId = "";
        console.log(`\n🚀 Đang lấy danh mục TTHC toàn quốc...`);

        while (true) {
            try {
                const payload = { limit: 200, lastId: lastId, q: "", categoryId: "", departmentCode: "" };
                const res = await session.fetchWithRetry(
                    `${CONFIG.BASE_URL}/api/v1/submitting/formality/list-all-public-formality-by-citizen`,
                    payload
                );

                if (!res || !res.data || !res.data.items || res.data.items.length === 0) break;
                res.data.items.forEach(item => rawList.push(item));
                if (!res.data.lastId || res.data.lastId === lastId) break;
                lastId = res.data.lastId;
                console.log(`   Đã tìm thấy: ${rawList.length} mã TTHC`);

                // Delay giữa các trang danh mục
                await randomDelay(CONFIG.CHUNK_DELAY_MIN, CONFIG.CHUNK_DELAY_MAX);
            } catch (err) {
                console.error(`⚠️ Lỗi khi lấy trang danh mục tiếp theo: ${err.message}`);
                if (rawList.length > 0) {
                    console.log(`⏩ Tạm dừng lấy danh mục, tiếp tục xử lý ${rawList.length} TTHC đã thu thập được...`);
                    break;
                } else {
                    throw err;
                }
            }
        }
        console.log(`✅ Tổng số TTHC gốc đã thu thập: ${rawList.length}`);

        // 4. Tải chi tiết từng TTHC — TUẦN TỰ, mỗi request có delay ngẫu nhiên
        if (rawList.length > 0) {
            console.log(`\n⚡ Tiến hành tải chi tiết cho: ${rawList.length} thủ tục (tuần tự, chống WAF)...\n`);

            let indexData = [];
            let successCount = 0;
            let failCount = 0;
            const startTime = Date.now();

            for (let i = 0; i < rawList.length; i++) {
                const item = rawList[i];

                try {
                    const res = await session.fetchWithRetry(
                        `${CONFIG.BASE_URL}/api/v1/configuring/formality/get-formality-by-citizen`,
                        { id: item.id },
                        item.code
                    );

                    if (res && res.data) {
                        let detail = res.data.data || res.data;

                        // Tạo dữ liệu Index
                        const formalityItem = {
                            id: item.id,
                            ma_tthc: item.code,
                            ten_tthc: item.name,
                            cap_thuc_hien: parseFormalityCaseLevel(detail),
                            loai_tthc: parseFormalityType(item.type || detail.formalityType),
                            linh_vuc: (item.categories && item.categories.length > 0) ? item.categories.join(', ') : '',
                            co_quan_thuc_hien: detail.executingAgencies || (item.departments ? item.departments.join(', ') : '')
                        };

                        // Xuất file chi tiết
                        const cleanDetail = sanitizeBase64(detail);
                        fs.writeFileSync(`${DETAILS_DIR}/${item.id}.json`, JSON.stringify(cleanDetail));

                        indexData.push(formalityItem);
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (err) {
                    console.error(`   ❌ Lỗi TTHC ${item.code || item.id}: ${err.message}`);
                    failCount++;
                }

                // Progress log mỗi 50 TTHC
                if ((i + 1) % 50 === 0 || i === rawList.length - 1) {
                    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
                    const percent = (((i + 1) / rawList.length) * 100).toFixed(1);
                    const avgTimePerItem = (Date.now() - startTime) / (i + 1);
                    const remaining = ((rawList.length - i - 1) * avgTimePerItem / 60000).toFixed(0);

                    console.log(`   [${percent}%] ${i + 1}/${rawList.length} | ✅ ${successCount} ❌ ${failCount} | ⏱️ ${elapsed} phút | ETA ~${remaining} phút`);
                }

                // Human-like delay giữa mỗi request
                await randomDelay(CONFIG.REQUEST_DELAY_MIN, CONFIG.REQUEST_DELAY_MAX);
            }

            // 5. Xuất file Index & Version
            fs.writeFileSync(`${DATA_DIR}/index.json`, JSON.stringify(indexData));
            const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);
            const versionInfo = {
                last_updated: new Date().toISOString(),
                total_records: indexData.length,
                success_rate: `${((successCount / rawList.length) * 100).toFixed(1)}%`,
                crawl_duration_minutes: parseFloat(totalTime),
                engine: 'puppeteer-extra-stealth-anti-waf'
            };
            fs.writeFileSync(`${DATA_DIR}/version.json`, JSON.stringify(versionInfo));

            // 6. TCI Calibration Selection
            console.log(`\n⚡ Tiến hành chạy TCI Calibration Selection...`);
            try {
                require('./tci/select-tci-calibration.js');
            } catch (err) {
                console.error(`⚠️ Lỗi khi chạy TCI Selection: ${err.message}`);
            }

            console.log(`\n🎉 HOÀN TẤT! (${successCount}/${rawList.length} TTHC trong ${totalTime} phút)`);
            console.log(`   Tỷ lệ thành công: ${versionInfo.success_rate}`);
            console.log(`   Dữ liệu đã sẵn sàng để đẩy ra nhánh data.\n`);
        }
    } catch (err) {
        console.error('❌ Lỗi không thể bỏ qua trong main():', err.message);
        process.exit(1);
    } finally {
        await session.close();
    }
}

main().catch(err => {
    console.error('❌ Lỗi hệ thống:', err.message);
    process.exit(1);
});
