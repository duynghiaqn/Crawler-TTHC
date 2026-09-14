const axios = require('axios');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getDynamicHeaders() {
    return {
        "accept": "application/json, text/plain, */*",
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "content-type": "application/json",
        "user-agent": getRandomUserAgent(),
        "origin": "https://dichvucong.gov.vn",
        "referer": "https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc-hanh-chinh.html"
    };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetry = async (url, payload, customHeaders = null, maxRetries = 8) => {
    for (let i = 0; i <= maxRetries; i++) {
        const activeHeaders = customHeaders || getDynamicHeaders();
        try {
            const res = await axios.post(url, payload, { headers: activeHeaders, timeout: 60000 }); 
            return res.data;
        } catch (err) {
            if (i < maxRetries) {
                const waitTime = Math.min(Math.pow(2, i) * 1000, 10000);
                console.log(`\n⚠️ Mạng chậm/Timeout, xoay User-Agent & thử lại lần ${i + 1}/${maxRetries}... (${err.message})`);
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

        // TCI Golden Case Selection sau khi cào dữ liệu
        console.log(`\n⚡ Tiến hành chạy TCI Calibration Selection...`);
        try {
            require('./tci/select-tci-calibration.js');
        } catch (err) {
            console.error(`⚠️ Lỗi khi chạy TCI Selection: ${err.message}`);
        }

        console.log(`🎉 HOÀN TẤT TUYỆT ĐỐI! Toàn bộ dữ liệu đã sẵn sàng để đẩy ra nhánh data.`);
    }
}

main();
