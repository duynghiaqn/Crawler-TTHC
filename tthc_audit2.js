const axios = require('axios');
const fs = require('fs');
const https = require('https');
const http = require('http');
require('dotenv').config();

// Global error handlers để ghi log đầy đủ nhưng không làm ngắt đột ngột nếu không cần thiết
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception:', error);
});

// HTTPS/HTTP Connection Pool với Keep-Alive để tái sử dụng socket, giảm độ trễ & ngắt kết nối
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 10,
    keepAliveMsecs: 30000,
    rejectUnauthorized: false
});

const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 10,
    keepAliveMsecs: 30000
});

const USER_AGENT_PROFILES = [
    {
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        chUa: '"Chromium";v="128", "Not=A?Brand";v="24", "Google Chrome";v="128"',
        platform: '"Windows"'
    },
    {
        ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        chUa: '"Chromium";v="128", "Not=A?Brand";v="24", "Google Chrome";v="128"',
        platform: '"macOS"'
    },
    {
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0",
        chUa: '"Chromium";v="127", "Not=A?Brand";v="24", "Microsoft Edge";v="127"',
        platform: '"Windows"'
    },
    {
        ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        chUa: '"Chromium";v="128", "Not=A?Brand";v="24", "Google Chrome";v="128"',
        platform: '"Linux"'
    }
];

// Sinh ngẫu nhiên địa chỉ IP thuộc dải IP các nhà mạng tại Việt Nam (Viettel, VNPT, FPT)
function getRandomVietnamIP() {
    const vnPrefixes = [
        [14, 160], [14, 161], [14, 162], [14, 177],
        [27, 64], [27, 72], [27, 74], [27, 76],
        [113, 160], [113, 161], [113, 170], [113, 172],
        [116, 96], [116, 100], [116, 105],
        [171, 224], [171, 232], [171, 240],
        [222, 252], [222, 253], [222, 254]
    ];
    const prefix = vnPrefixes[Math.floor(Math.random() * vnPrefixes.length)];
    const c = Math.floor(Math.random() * 254) + 1;
    const d = Math.floor(Math.random() * 254) + 1;
    return `${prefix[0]}.${prefix[1]}.${c}.${d}`;
}

function getDynamicHeaders() {
    const profile = USER_AGENT_PROFILES[Math.floor(Math.random() * USER_AGENT_PROFILES.length)];
    const fakeIP = getRandomVietnamIP();
    
    return {
        "accept": "application/json, text/plain, */*",
        "accept-language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
        "content-type": "application/json",
        "user-agent": profile.ua,
        "sec-ch-ua": profile.chUa,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": profile.platform,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "origin": "https://dichvucong.gov.vn",
        "referer": "https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc-hanh-chinh.html",
        // Header giả lập địa chỉ IP Việt Nam qua Proxy/WAF
        "X-Forwarded-For": fakeIP,
        "X-Real-IP": fakeIP,
        "Client-IP": fakeIP,
        "X-Client-IP": fakeIP,
        "Via": `1.1 Chrome-CDN-${Math.floor(Math.random() * 1000)}`
    };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetry = async (url, payload, customHeaders = null, maxRetries = 10) => {
    for (let i = 0; i <= maxRetries; i++) {
        const activeHeaders = customHeaders || getDynamicHeaders();
        try {
            const res = await axios.post(url, payload, { 
                headers: activeHeaders, 
                timeout: 45000,
                httpsAgent,
                httpAgent,
                validateStatus: status => status >= 200 && status < 500
            }); 

            if (res.status === 200 && res.data) {
                return res.data;
            } else {
                throw new Error(`HTTP Status ${res.status}`);
            }
        } catch (err) {
            const errorMessage = err.response?.status ? `HTTP ${err.response.status}` : err.message;
            if (i < maxRetries) {
                // Exponential backoff với ngẫu nhiên jitter để chống nghẽn mạng
                const waitTime = Math.min(Math.pow(2, i) * 1000 + Math.floor(Math.random() * 500), 15000);
                console.log(`⚠️ Mạng chậm/Timeout (${errorMessage}), đổi User-Agent & thử lại lần ${i + 1}/${maxRetries} sau ${(waitTime/1000).toFixed(1)}s...`);
                await delay(waitTime);
            } else {
                console.error(`❌ Đã vượt quá ${maxRetries} lần thử lại: ${errorMessage}`);
                throw new Error(`Fetch failed: ${errorMessage}`);
            }
        }
    }
};

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

async function main() {
    console.log('\n=== CÔNG CỤ XÂY DỰNG DATA JSON (BẢN CLOUD - GITHUB ACTIONS - OPTIMIZED) ===\n');

    try {
        const DATA_DIR = './data';
        const DETAILS_DIR = `${DATA_DIR}/details`;
        
        // Xóa dữ liệu cũ để đảm bảo kết quả mới nhất
        if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
        
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.mkdirSync(DETAILS_DIR, { recursive: true });

        let rawList = [];
        let lastId = "";
        console.log(`🚀 Đang lấy danh mục TTHC toàn quốc...`);
        
        while (true) {
            try {
                const payload = { limit: 200, lastId: lastId, q: "", categoryId: "", departmentCode: "" };
                const res = await fetchWithRetry('https://dichvucong.gov.vn/api/v1/submitting/formality/list-all-public-formality-by-citizen', payload);
                if (!res || !res.data || !res.data.items || res.data.items.length === 0) break;
                res.data.items.forEach(item => rawList.push(item));
                if (!res.data.lastId || res.data.lastId === lastId) break;
                lastId = res.data.lastId;
                console.log(`   Đã tìm thấy: ${rawList.length} mã TTHC`);
                await delay(200);
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

        if (rawList.length > 0) {
            console.log(`⚡ Tiến hành tải chi tiết cho: ${rawList.length} thủ tục.`);
            // Giảm chunkSize xuống 5 để tránh quá tải kết nối và chống bị WAF ngắt kết nối
            const chunkSize = 5; 
            
            let indexData = [];
            let successCount = 0;

            for (let i = 0; i < rawList.length; i += chunkSize) {
                const chunk = rawList.slice(i, i + chunkSize);
                
                const results = await Promise.allSettled(chunk.map(async (item) => {
                    const res = await fetchWithRetry('https://dichvucong.gov.vn/api/v1/configuring/formality/get-formality-by-citizen', { id: item.id });
                    if (res && res.data) {
                        let detail = res.data.data || res.data;
                        
                        // 1. Tạo dữ liệu cho file Index
                        const formalityItem = {
                            id: item.id,
                            ma_tthc: item.code,
                            ten_tthc: item.name,
                            cap_thuc_hien: parseFormalityCaseLevel(detail),
                            loai_tthc: parseFormalityType(item.type || detail.formalityType),
                            linh_vuc: (item.categories && item.categories.length > 0) ? item.categories.join(', ') : '',
                            co_quan_thuc_hien: detail.executingAgencies || (item.departments ? item.departments.join(', ') : '')
                        };

                        // 2. Xuất file chi tiết
                        const cleanDetail = sanitizeBase64(detail);
                        fs.writeFileSync(`${DETAILS_DIR}/${item.id}.json`, JSON.stringify(cleanDetail));
                        
                        return formalityItem;
                    }
                    return null;
                }));

                results.forEach((r) => {
                    if (r.status === 'fulfilled' && r.value) {
                        indexData.push(r.value);
                        successCount++;
                    }
                });

                const currentProcessed = Math.min(i + chunkSize, rawList.length);
                const percent = ((currentProcessed / rawList.length) * 100).toFixed(1);
                console.log(`   [${percent}%] Tiến độ: ${currentProcessed}/${rawList.length} | Thành công: ${successCount}`);
                
                // Giãn khoảng cách giữa các chunk 300ms
                await delay(300); 
            }

            // Xuất file cấu trúc Index
            fs.writeFileSync(`${DATA_DIR}/index.json`, JSON.stringify(indexData));
            const versionInfo = { 
                last_updated: new Date().toISOString(),
                total_records: indexData.length,
                success_rate: `${((successCount / rawList.length) * 100).toFixed(1)}%`
            };
            fs.writeFileSync(`${DATA_DIR}/version.json`, JSON.stringify(versionInfo));

            // TCI Golden Case Selection sau khi cào dữ liệu thành công
            console.log(`\n⚡ Tiến hành chạy TCI Calibration Selection...`);
            try {
                require('./tci/select-tci-calibration.js');
            } catch (err) {
                console.error(`⚠️ Lỗi khi chạy TCI Selection: ${err.message}`);
            }

            console.log(`🎉 HOÀN TẤT TUYỆT ĐỐI! (${successCount}/${rawList.length} TTHC). Dữ liệu đã sẵn sàng để đẩy ra nhánh data.`);
        }
    } catch (err) {
        console.error('❌ Lỗi không thể bỏ qua trong main():', err.message);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('❌ Lỗi hệ thống:', err.message);
    process.exit(1);
});
