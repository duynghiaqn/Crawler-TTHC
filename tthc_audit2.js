const axios = require('axios');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

const https = require('https');
const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

const USER_AGENT_PROFILES = [
    {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        "sec-ch-ua-platform": '"Windows"'
    },
    {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        "sec-ch-ua-platform": '"Windows"'
    },
    {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        "sec-ch-ua-platform": '"macOS"'
    },
    {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        "sec-ch-ua-platform": '"Linux"'
    },
    {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
        "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Microsoft Edge";v="122"',
        "sec-ch-ua-platform": '"Windows"'
    },
    {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0"
    },
    {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15"
    }
];

function getRandomHeaders() {
    const profile = USER_AGENT_PROFILES[Math.floor(Math.random() * USER_AGENT_PROFILES.length)];
    const reqHeaders = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "content-type": "application/json",
        "origin": "https://dichvucong.gov.vn",
        "referer": "https://dichvucong.gov.vn/p/home/dvc-thu-tuc-hanh-chinh.html",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": profile["user-agent"]
    };
    if (profile["sec-ch-ua"]) {
        reqHeaders["sec-ch-ua"] = profile["sec-ch-ua"];
        reqHeaders["sec-ch-ua-mobile"] = "?0";
        reqHeaders["sec-ch-ua-platform"] = profile["sec-ch-ua-platform"];
    }
    return reqHeaders;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetry = async (url, payload, customHeaders = null, maxRetries = 5) => {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            const reqHeaders = customHeaders || getRandomHeaders();
            const res = await axios.post(url, payload, { headers: reqHeaders, httpsAgent, timeout: 30000 });
            return res.data;
        } catch (err) {
            if (i < maxRetries) {
                const waitTime = Math.pow(2, i) * 1000;
                console.log(`\n⚠️ Mạng chậm (${err.message}), đang thử lại lần ${i + 1}...`);
                await delay(waitTime);
            } else throw err;
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
    console.log('\n=== CÔNG CỤ XÂY DỰNG DATA JSON (BẢN CLOUD - GITHUB ACTIONS) ===\n');

    // CẤU HÌNH ĐƯỜNG DẪN MÁY CHỦ ẢO (LINUX)
    const DATA_DIR = './data';
    const DETAILS_DIR = `${DATA_DIR}/details`;

    // Xóa sạch data cũ mỗi lần cào mới để kho lưu trữ không bị rác
    if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(DETAILS_DIR, { recursive: true });

    let rawList = [];
    let lastId = "";
    console.log(`🚀 Đang lấy danh mục TTHC toàn quốc...`);

    while (true) {
        const payload = { limit: 200, lastId: lastId, q: "", categoryId: "", departmentCode: "" };
        const res = await fetchWithRetry('https://dichvucong.gov.vn/api/v1/submitting/formality/list-all-public-formality-by-citizen', payload);
        if (!res || !res.data || !res.data.items || res.data.items.length === 0) break;
        res.data.items.forEach(item => rawList.push(item));
        if (!res.data.lastId || res.data.lastId === lastId) break;
        lastId = res.data.lastId;
        console.log(`   Đã tìm thấy: ${rawList.length} mã`);
        await delay(100);
    }
    console.log(`✅ Tổng số TTHC gốc: ${rawList.length}`);

    if (rawList.length > 0) {
        console.log(`⚡ Tiến hành tải chi tiết cho: ${rawList.length} thủ tục.`);
        const chunkSize = 20;

        let indexData = [];

        for (let i = 0; i < rawList.length; i += chunkSize) {
            const chunk = rawList.slice(i, i + chunkSize);
            const promises = chunk.map(async (item) => {
                try {
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
                        indexData.push(formalityItem);

                        // 2. Xuất file chi tiết
                        const cleanDetail = sanitizeBase64(detail);
                        fs.writeFileSync(`${DETAILS_DIR}/${item.id}.json`, JSON.stringify(cleanDetail));
                    }
                } catch (e) { }
            });
            await Promise.all(promises);
            console.log(`   Tải chi tiết & Lưu file: ${Math.min(i + chunkSize, rawList.length)}/${rawList.length}`);
            await delay(150);
        }

        // Xuất file cấu trúc Index
        fs.writeFileSync(`${DATA_DIR}/index.json`, JSON.stringify(indexData));
        const versionInfo = {
            last_updated: new Date().toISOString(),
            total_records: indexData.length
        };
        fs.writeFileSync(`${DATA_DIR}/version.json`, JSON.stringify(versionInfo));

        console.log(`🎉 HOÀN TẤT TUYỆT ĐỐI! Toàn bộ dữ liệu đã sẵn sàng để đẩy ra nhánh data.`);
    }
}

main();