const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

const API_URL = 'https://dichvucong.gov.vn/api/v1/submitting/formality/list-department-url-by-citizen';

const CONFIG = {
    MAX_CONCURRENCY: parseInt(process.env.MAX_CONCURRENCY, 10) || 5,
    BASE_DELAY_MS: 200,
    JITTER_MS: 150,
    TIMEOUT_MS: 20000,
    MAX_RETRIES: 3,
    MAX_CONSECUTIVE_FAILURES: 5,
    TTL_HOURS: parseFloat(process.env.ONLINE_SERVICE_TTL_HOURS) || 24,
    PROVINCE_CODE: process.env.PROVINCE_CODE || '52',
    CHECKPOINT_INTERVAL: 50,
    HEADER_PROFILES: [
        {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
            'sec-ch-ua-platform': '"Windows"',
            'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        {
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'sec-ch-ua': '"Google Chrome";v="126", "Chromium";v="126", "Not?A_Brand";v="24"',
            'sec-ch-ua-platform': '"macOS"',
            'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
            'sec-ch-ua': '"Microsoft Edge";v="125", "Chromium";v="125", "Not=A?Brand";v="24"',
            'sec-ch-ua-platform': '"Windows"',
            'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8'
        },
        {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
            'accept-language': 'vi-VN,vi;q=0.8,en-US;q=0.5,en;q=0.3'
        },
        {
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
            'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    ]
};

const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: CONFIG.MAX_CONCURRENCY,
    maxFreeSockets: CONFIG.MAX_CONCURRENCY,
    rejectUnauthorized: false,
    family: 4
});

let globalHeaderIdx = 0;

function getHeaders(attempt = 0) {
    const profile = CONFIG.HEADER_PROFILES[(globalHeaderIdx++ + attempt) % CONFIG.HEADER_PROFILES.length];
    const headers = {
        accept: 'application/json, text/plain, */*',
        'accept-language': profile['accept-language'],
        'accept-encoding': 'gzip, deflate, br, zstd',
        'content-type': 'application/json',
        origin: 'https://dichvucong.gov.vn',
        referer: 'https://dichvucong.gov.vn/tim-kiem-thu-tuc-hanh-chinh',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': profile['user-agent']
    };
    if (profile['sec-ch-ua']) {
        headers['sec-ch-ua'] = profile['sec-ch-ua'];
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = profile['sec-ch-ua-platform'];
    }
    return headers;
}

function safeWriteJson(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

const politeDelay = async () => {
    const waitMs = CONFIG.BASE_DELAY_MS + Math.floor(Math.random() * CONFIG.JITTER_MS);
    await new Promise(resolve => setTimeout(resolve, waitMs));
};

async function postDepartmentUrlApi(payload, state) {
    for (let retry = 0; retry <= CONFIG.MAX_RETRIES; retry++) {
        try {
            const res = await axios.post(API_URL, payload, {
                headers: getHeaders(retry),
                httpsAgent,
                timeout: CONFIG.TIMEOUT_MS,
                validateStatus: status => status >= 200 && status < 600
            });

            if (res.status === 429 || res.status === 403 || res.status >= 500) {
                const err = new Error(`HTTP ${res.status}`);
                err.statusCode = res.status;
                throw err;
            }

            if (!res.data || res.data.code !== 'OK' || !res.data.data) {
                throw new Error(`Invalid payload (code=${res.data ? res.data.code : 'NULL'})`);
            }

            state.consecutiveFailures = 0;
            return res.data.data;
        } catch (err) {
            const isRejection = err.statusCode === 429 || err.statusCode === 403 || err.statusCode >= 500;
            const isNetwork = err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED'
                || (err.message && (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')));

            if (retry < CONFIG.MAX_RETRIES && (!isRejection || isNetwork)) {
                const waitMs = Math.pow(2, retry) * 1000 + Math.floor(Math.random() * 500);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            } else {
                if (!isNetwork) {
                    state.consecutiveFailures += 1;
                }
                if (state.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
                    state.circuitBreakerTripped = true;
                    throw new Error(`Circuit Breaker triggered after ${state.consecutiveFailures} consecutive rejections (${err.message})`);
                }
                throw err;
            }
        }
    }
}

async function checkSingleFormality(item, provinceCode, state) {
    const basePayload = {
        formalityId: item.id,
        limit: 50,
        lastId: ''
    };
    if (provinceCode) {
        basePayload.provinceCode = provinceCode;
    }

    const firstPage = await postDepartmentUrlApi(basePayload, state);
    const total = Number(firstPage.total || 0);
    const rows = Array.isArray(firstPage.rows) ? firstPage.rows : [];

    let fullCount = 0;
    let partialCount = 0;

    if (total === 0 || rows.length === 0) {
        return {
            dvctt_code: 'CHUA_CUNG_CAP',
            muc_do_dvctt: 'Chưa cung cấp',
            is_provided: false,
            is_mixed: false,
            total_departments: 0,
            full_departments: 0,
            partial_departments: 0,
            citizen_url: '',
            checked_at: new Date().toISOString()
        };
    }

    if (total <= rows.length) {
        for (const r of rows) {
            if (r.implementLevel === 'FULL') fullCount++;
            else if (r.implementLevel === 'PARTIAL') partialCount++;
        }
    } else {
        const countPayloadBase = { formalityId: item.id, limit: 1, lastId: '' };
        if (provinceCode) countPayloadBase.provinceCode = provinceCode;

        const [fullRes, partialRes] = await Promise.all([
            postDepartmentUrlApi({ ...countPayloadBase, implementLevel: 'FULL' }, state),
            postDepartmentUrlApi({ ...countPayloadBase, implementLevel: 'PARTIAL' }, state)
        ]);
        fullCount = Number(fullRes.total || 0);
        partialCount = Number(partialRes.total || 0);
    }

    const isMixed = fullCount > 0 && partialCount > 0;
    let dvcttCode = 'CHUA_CUNG_CAP';
    let mucDoDvctt = 'Chưa cung cấp';

    if (fullCount > 0) {
        dvcttCode = 'FULL';
        mucDoDvctt = 'Toàn trình';
    } else if (partialCount > 0) {
        dvcttCode = 'PARTIAL';
        mucDoDvctt = 'Một phần';
    }

    const firstRowWithUrl = rows.find(r => r.citizenUrl) || rows[0];

    return {
        dvctt_code: dvcttCode,
        muc_do_dvctt: mucDoDvctt,
        is_provided: dvcttCode !== 'CHUA_CUNG_CAP',
        is_mixed: isMixed,
        total_departments: total,
        full_departments: fullCount,
        partial_departments: partialCount,
        citizen_url: firstRowWithUrl ? (firstRowWithUrl.citizenUrl || '') : '',
        checked_at: new Date().toISOString()
    };
}

function buildSummary(itemsMap, sourceItems, failedIds) {
    const adminIds = new Set(sourceItems.filter(x => !x.is_noi_bo).map(x => x.id));
    const entries = Object.entries(itemsMap);
    const all = entries.map(([, v]) => v);
    const fullItems = all.filter(x => x.dvctt_code === 'FULL');
    const partialItems = all.filter(x => x.dvctt_code === 'PARTIAL');
    const notProvidedItems = all.filter(x => x.dvctt_code === 'CHUA_CUNG_CAP');
    const adminAll = entries.filter(([id]) => adminIds.has(id)).map(([, v]) => v);

    return {
        total_records: sourceItems.length,
        checked_total: all.length,
        failed_count: Object.keys(failedIds).length,
        full_count: fullItems.length,
        partial_count: partialItems.length,
        not_provided_count: notProvidedItems.length,
        provided_count: fullItems.length + partialItems.length,
        mixed_count: all.filter(x => x.is_mixed).length,
        admin_full_count: adminAll.filter(x => x.dvctt_code === 'FULL').length,
        admin_partial_count: adminAll.filter(x => x.dvctt_code === 'PARTIAL').length,
        admin_not_provided_count: adminAll.filter(x => x.dvctt_code === 'CHUA_CUNG_CAP').length
    };
}

async function runScope({ label, scope, indexPath, outputPath, provinceCode, force, limit }) {
    console.log(`\n================================================================`);
    console.log(`🌐 QUÉT TRẠNG THÁI CUNG CẤP DVCTT: ${label}`);
    console.log(`   • Nguồn danh mục: ${indexPath}`);
    console.log(`   • File đầu ra:    ${outputPath}`);
    console.log(`   • Mã tỉnh lọc:    ${provinceCode || 'Toàn quốc (không lọc tỉnh)'}`);
    console.log(`================================================================\n`);

    if (!fs.existsSync(indexPath)) {
        console.error(`❌ Không tìm thấy file danh mục: ${indexPath}`);
        return null;
    }

    let sourceItems = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
        console.error(`❌ Danh mục rỗng: ${indexPath}`);
        return null;
    }

    if (limit > 0) {
        sourceItems = sourceItems.slice(0, limit);
        console.log(`⚡ Chế độ giới hạn kiểm thử: ${sourceItems.length} TTHC đầu tiên.`);
    }

    let existingItems = {};
    let failedIds = {};
    if (!force && fs.existsSync(outputPath)) {
        try {
            const prev = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
            if (prev && prev.items && typeof prev.items === 'object') {
                existingItems = prev.items;
            }
            if (prev && prev.failed_ids && typeof prev.failed_ids === 'object') {
                failedIds = prev.failed_ids;
            }
        } catch (e) {}
    }

    const ttlMs = CONFIG.TTL_HOURS * 3600 * 1000;
    const now = Date.now();
    const state = { consecutiveFailures: 0, circuitBreakerTripped: false };

    const activeIds = new Set(sourceItems.map(x => x.id).filter(Boolean));
    for (const id of Object.keys(existingItems)) {
        if (!activeIds.has(id)) delete existingItems[id];
    }

    const pending = [];
    let reusedCount = 0;

    for (const item of sourceItems) {
        if (!item.id) continue;
        const cached = existingItems[item.id];
        const checkedAt = cached && cached.checked_at ? new Date(cached.checked_at).getTime() : 0;
        if (!force && cached && checkedAt > 0 && (now - checkedAt < ttlMs)) {
            delete cached.id;
            delete cached.code;
            delete cached.name;
            delete cached.is_noi_bo;
            delete cached.department_names;
            reusedCount++;
        } else {
            pending.push(item);
        }
    }

    console.log(`📊 Tổng số TTHC: ${sourceItems.length} | ⏩ Tái sử dụng cache (<${CONFIG.TTL_HOURS}h): ${reusedCount} | 🔍 Cần quét: ${pending.length}\n`);

    const buildOutputPayload = (status) => ({
        updated_at: new Date().toISOString(),
        scope,
        province_code: provinceCode || null,
        api_endpoint: API_URL,
        status,
        summary: buildSummary(existingItems, sourceItems, failedIds),
        failed_ids: failedIds,
        items: existingItems
    });

    let shuttingDown = false;
    const onShutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.warn('\n⚠️ Nhận tín hiệu dừng. Đang lưu tiến độ online_service...');
        safeWriteJson(outputPath, buildOutputPayload('INTERRUPTED'));
        process.exit(0);
    };
    process.on('SIGINT', onShutdown);
    process.on('SIGTERM', onShutdown);

    const startTime = Date.now();
    let processed = 0;

    try {
        for (let i = 0; i < pending.length; i += CONFIG.MAX_CONCURRENCY) {
            const chunk = pending.slice(i, i + CONFIG.MAX_CONCURRENCY);
            const results = await Promise.all(chunk.map(async (item) => {
                try {
                    const record = await checkSingleFormality(item, provinceCode, state);
                    return { success: true, item, record };
                } catch (err) {
                    return { success: false, item, error: err.message };
                }
            }));

            for (const r of results) {
                if (r.success) {
                    existingItems[r.item.id] = r.record;
                    delete failedIds[r.item.id];
                } else {
                    failedIds[r.item.id] = {
                        code: r.item.ma_tthc || r.item.code || '',
                        error: r.error,
                        timestamp: new Date().toISOString()
                    };
                }
            }

            processed += chunk.length;

            if (processed % CONFIG.CHECKPOINT_INTERVAL < CONFIG.MAX_CONCURRENCY || i + CONFIG.MAX_CONCURRENCY >= pending.length) {
                safeWriteJson(outputPath, buildOutputPayload('IN_PROGRESS'));
                const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
                const pct = ((processed / Math.max(pending.length, 1)) * 100).toFixed(1);
                const s = buildSummary(existingItems, sourceItems, failedIds);
                console.log(`   [${pct}% | ${processed}/${pending.length}] ✅ Toàn trình: ${s.full_count} | 🧩 Một phần: ${s.partial_count} | ⚪ Chưa cung cấp: ${s.not_provided_count} | ❌ Lỗi: ${s.failed_count} | ⏱️ ${elapsedMin}m`);
            }

            if (state.circuitBreakerTripped) {
                console.error('\n🛑 CIRCUIT BREAKER TRIGGERED! Dừng quét an toàn.');
                break;
            }

            if (i + CONFIG.MAX_CONCURRENCY < pending.length) {
                await politeDelay();
            }
        }
    } finally {
        process.removeListener('SIGINT', onShutdown);
        process.removeListener('SIGTERM', onShutdown);
    }

    const finalStatus = state.circuitBreakerTripped ? 'CIRCUIT_BREAKER_TRIPPED' : 'COMPLETED';
    const finalPayload = buildOutputPayload(finalStatus);
    safeWriteJson(outputPath, finalPayload);

    const s = finalPayload.summary;
    console.log(`\n✅ HOÀN TẤT QUÉT DVCTT (${label}) [${finalStatus}]`);
    console.log(`   • Tổng đã kiểm tra:  ${s.checked_total}/${s.total_records} TTHC`);
    console.log(`   • ⚡ Toàn trình:      ${s.full_count} (DVC không nội bộ: ${s.admin_full_count})`);
    console.log(`   • 🧩 Một phần:        ${s.partial_count} (DVC không nội bộ: ${s.admin_partial_count})`);
    console.log(`   • ⚪ Chưa cung cấp:   ${s.not_provided_count} (DVC không nội bộ: ${s.admin_not_provided_count})`);
    console.log(`   • 🔀 Hỗn hợp:         ${s.mixed_count}`);
    console.log(`   • ❌ Thất bại:        ${s.failed_count}`);
    console.log(`   • 💾 Đã lưu tại:      ${outputPath}\n`);

    return finalPayload;
}

async function main() {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const limitArg = args.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) || 0 : 0;

    const runAll = args.includes('--all');
    const runNational = runAll || args.includes('--national') || args.includes('--dvcqg');
    const runGl = runAll || args.includes('--gl') || args.includes('--gia-lai') || (!runNational);

    if (runGl) {
        await runScope({
            label: 'Tỉnh Gia Lai (H21 / provinceCode=' + CONFIG.PROVINCE_CODE + ')',
            scope: 'GIA_LAI',
            indexPath: path.join(process.cwd(), 'data-gl', 'index.json'),
            outputPath: path.join(process.cwd(), 'data-gl', 'online_service.json'),
            provinceCode: CONFIG.PROVINCE_CODE,
            force,
            limit
        });
    }

    if (runNational) {
        await runScope({
            label: 'DVCQG Toàn quốc',
            scope: 'NATIONAL',
            indexPath: path.join(process.cwd(), 'data', 'index.json'),
            outputPath: path.join(process.cwd(), 'data', 'online_service.json'),
            provinceCode: null,
            force,
            limit
        });
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('❌ Lỗi không mong muốn trong check_online_service:', err.message);
        process.exit(1);
    });
}

module.exports = {
    checkSingleFormality,
    runScope,
    buildSummary
};
