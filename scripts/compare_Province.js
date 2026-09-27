const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const DATA_DIR = path.join(process.cwd(), 'data');
const DETAILS_DIR = path.join(DATA_DIR, 'details');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const DISCOVERY_FILE = path.join(DATA_DIR, 'discovery.json');

const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot_province.json');
const REPORT_FILE = path.join(DATA_DIR, 'compare_province_report.json');

// Kiểm tra điều kiện giữ lại TTHC Cấp Tỉnh / Cấp Xã (Loại trừ TTHC đặc thù của tỉnh thành khác)
function shouldIncludeItem(detail) {
    const isProvince = Boolean(detail.isProvince || detail.type === 'PROVINCE');
    const isWard = Boolean(detail.isWard || detail.type === 'WARD');

    if (!isProvince && !isWard) return false;

    const deptCode = detail.departmentPromulgateCode || detail.departmentCode || detail.departmentPromulgateId || '';
    const deptName = detail.departmentPromulgateName || detail.departmentPromulgate || detail.executingAgencies || detail.departmentsExecuting || '';
    const isGiaLai = deptCode === 'H21' || String(deptName).toLowerCase().includes('gia lai');

    const type = detail.type || detail.formalityType || '';
    const isSpecificOther = (type === 'SPECIFIC' || type === 'LOCAL_REGULATION') && !isGiaLai;

    if (isSpecificOther) return false;

    return true;
}

function getLevelLabel(item) {
    if (item.isProvince && item.isWard) return 'Cấp tỉnh & Cấp xã (Cả 2 cấp)';
    if (item.isProvince) return 'Cấp tỉnh';
    if (item.isWard) return 'Cấp xã';
    return 'Chưa xác định';
}

function loadUniqueProvinceWardDataset() {
    const codeMap = new Map();

    if (fs.existsSync(DETAILS_DIR)) {
        try {
            const files = fs.readdirSync(DETAILS_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const fullPath = path.join(DETAILS_DIR, file);
                    const detail = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    if (detail && shouldIncludeItem(detail)) {
                        const code = String(detail.code || detail.codeNotation || detail.ma_tthc || detail.id).trim();
                        if (!code) continue;

                        const isProvince = Boolean(detail.isProvince || detail.type === 'PROVINCE');
                        const isWard = Boolean(detail.isWard || detail.type === 'WARD');

                        const category = detail.category || detail.linh_vuc || (Array.isArray(detail.categories) ? detail.categories.join(', ') : detail.categories) || '';
                        const agency = detail.executingAgencies || detail.co_quan_thuc_hien || detail.departmentPromulgateName || detail.departmentPromulgate || '';

                        if (!codeMap.has(code)) {
                            codeMap.set(code, {
                                id: detail.id || code,
                                code,
                                name: detail.name || detail.ten_tthc || '',
                                category,
                                agency,
                                isProvince,
                                isWard,
                                formalityType: detail.formalityType || detail.type || 'STANDARD',
                                executingAgencies: detail.executingAgencies || detail.co_quan_thuc_hien || agency,
                                departmentPromulgate: detail.departmentPromulgateName || detail.departmentPromulgate || '',
                                url: `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${code}`
                            });
                        } else {
                            const existing = codeMap.get(code);
                            if (isProvince) existing.isProvince = true;
                            if (isWard) existing.isWard = true;
                            if (!existing.category && category) existing.category = category;
                            if (!existing.agency && agency) existing.agency = agency;
                            if (!existing.executingAgencies && (detail.executingAgencies || detail.co_quan_thuc_hien)) {
                                existing.executingAgencies = detail.executingAgencies || detail.co_quan_thuc_hien;
                            }
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }

    if (codeMap.size === 0 && fs.existsSync(DISCOVERY_FILE)) {
        try {
            const cache = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
            const raw = cache.items || cache;
            if (Array.isArray(raw)) {
                raw.forEach(item => {
                    const depts = Array.isArray(item.departments) ? item.departments.join(', ') : '';
                    const mockDetail = {
                        isProvince: item.type === 'PROVINCE' || !depts.includes('cấp xã'),
                        isWard: depts.includes('cấp xã'),
                        departmentCode: item.departmentCode || item.departmentPromulgateCode || '',
                        departmentPromulgate: item.departmentPromulgate || '',
                        executingAgencies: depts,
                        type: item.type,
                        formalityType: item.formalityType
                    };

                    if (shouldIncludeItem(mockDetail)) {
                        const code = String(item.code || item.codeNotation || item.id).trim();
                        if (!code) return;

                        const isProvince = mockDetail.isProvince;
                        const isWard = mockDetail.isWard;
                        const category = Array.isArray(item.categories) ? item.categories.join(', ') : (item.category || item.linh_vuc || '');
                        const agency = depts || (Array.isArray(item.departments) ? item.departments.join(', ') : item.co_quan_thuc_hien || item.departmentPromulgate || '');

                        if (!codeMap.has(code)) {
                            codeMap.set(code, {
                                id: item.id || code,
                                code,
                                name: item.name || '',
                                category,
                                agency,
                                isProvince,
                                isWard,
                                formalityType: item.formalityType || item.type || 'STANDARD',
                                executingAgencies: depts || agency,
                                departmentPromulgate: item.departmentPromulgate || '',
                                url: `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${code}`
                            });
                        } else {
                            const existing = codeMap.get(code);
                            if (isProvince) existing.isProvince = true;
                            if (isWard) existing.isWard = true;
                            if (!existing.category && category) existing.category = category;
                            if (!existing.agency && agency) existing.agency = agency;
                        }
                    }
                });
            }
        } catch (e) {}
    }

    return Array.from(codeMap.values()).map(item => ({
        ...item,
        level_label: getLevelLabel(item)
    }));
}

function compareProvinceWard() {
    console.log('\n================================================================');
    console.log('🏛️  BÁO CÁO THEO DÕI BIẾN ĐỘNG TTHC THEO MÃ DUY NHẤT (PROVINCE & WARD)');
    console.log('    [Tính duy nhất theo Mã TTHC | Hợp nhất thủ tục áp dụng cả Tỉnh & Xã]');
    console.log('    [Loại bỏ: TTHC Đặc thù/Địa phương của các tỉnh thành khác]');
    console.log('================================================================\n');

    const currentItems = loadUniqueProvinceWardDataset();
    if (currentItems.length === 0) {
        console.error('⚠️ Không tìm thấy dữ liệu TTHC Cấp tỉnh / Cấp xã phù hợp.');
        return;
    }

    const currentMap = new Map();
    currentItems.forEach(item => currentMap.set(item.code, item));

    let previousMap = new Map();
    let hasSnapshot = false;

    if (fs.existsSync(SNAPSHOT_FILE)) {
        try {
            const prevRaw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
            if (Array.isArray(prevRaw)) {
                prevRaw.forEach(item => previousMap.set(item.code || item.id, item));
                hasSnapshot = true;
            }
        } catch (e) {}
    }

    const provinceOnlyCount = currentItems.filter(x => x.isProvince && !x.isWard).length;
    const wardOnlyCount = currentItems.filter(x => !x.isProvince && x.isWard).length;
    const bothCount = currentItems.filter(x => x.isProvince && x.isWard).length;

    const addedItems = [];
    const removedItems = [];
    const modifiedItems = [];

    if (!hasSnapshot) {
        console.log(`📸 Khởi tạo Snapshot theo Mã TTHC duy nhất lần đầu tiên.`);
        console.log(`⚡ Tổng số Mã TTHC duy nhất hiện tại: ${currentItems.length}`);
        console.log(`   • Chỉ Cấp Tỉnh:             ${provinceOnlyCount} TTHC`);
        console.log(`   • Chỉ Cấp Xã:               ${wardOnlyCount} TTHC`);
        console.log(`   • CẢ CẤP TỈNH & CẤP XÃ:     ${bothCount} TTHC\n`);

        currentItems.forEach(item => addedItems.push(item));
    } else {
        currentMap.forEach((currItem, code) => {
            if (!previousMap.has(code)) {
                addedItems.push(currItem);
            } else {
                const prevItem = previousMap.get(code);
                const nameChanged = prevItem.name !== currItem.name;
                const levelChanged = prevItem.level_label !== currItem.level_label;

                if (nameChanged || levelChanged) {
                    modifiedItems.push({
                        id: currItem.id || code,
                        code,
                        name: currItem.name,
                        category: currItem.category || '',
                        agency: currItem.agency || currItem.executingAgencies || '',
                        old_name: prevItem.name,
                        new_name: currItem.name,
                        old_level: prevItem.level_label || getLevelLabel(prevItem),
                        new_level: currItem.level_label,
                        executingAgencies: currItem.executingAgencies,
                        departmentPromulgate: currItem.departmentPromulgate,
                        url: currItem.url
                    });
                }
            }
        });

        previousMap.forEach((prevItem, code) => {
            if (!currentMap.has(code)) {
                removedItems.push({
                    id: prevItem.id || code,
                    code: prevItem.code,
                    name: prevItem.name,
                    category: prevItem.category || '',
                    agency: prevItem.agency || prevItem.executingAgencies || prevItem.departmentPromulgate || '',
                    level_label: prevItem.level_label || getLevelLabel(prevItem),
                    isProvince: prevItem.isProvince,
                    isWard: prevItem.isWard,
                    departmentPromulgate: prevItem.departmentPromulgate || '',
                    executingAgencies: prevItem.executingAgencies || '',
                    url: prevItem.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${code}`
                });
            }
        });
    }

    const previousTotal = hasSnapshot ? previousMap.size : 0;
    const netChange = currentItems.length - previousTotal;
    const netSign = netChange >= 0 ? `+${netChange}` : `${netChange}`;

    console.log(`📈 THỐNG KÊ BIẾN ĐỘNG DỮ LIỆU:`);
    console.log(`   • Tổng số mã TTHC kỳ trước: ${previousTotal}`);
    console.log(`   • Tổng số mã TTHC hiện tại: ${currentItems.length}`);
    console.log(`   • Biến động ròng (Net):      ${netSign} mã TTHC`);
    console.log(`   • 🆕 Mã TTHC thêm mới:      ${addedItems.length} TTHC`);
    console.log(`   • 🗑️ Mã TTHC bãi bỏ:        ${removedItems.length} TTHC`);
    console.log(`   • ✏️ Mã TTHC thay đổi:       ${modifiedItems.length} TTHC\n`);

    console.log(`📊 PHÂN LOẠI CẤP THỰC HIỆN HIỆN TẠI:`);
    console.log(`   • 🏢 Chỉ Cấp Tỉnh:             ${provinceOnlyCount} TTHC`);
    console.log(`   • 🏡 Chỉ Cấp Xã:               ${wardOnlyCount} TTHC`);
    console.log(`   • 🔄 CẢ CẤP TỈNH & CẤP XÃ:     ${bothCount} TTHC\n`);

    if (addedItems.length > 0) {
        console.log(`✨ DANH SÁCH CHI TIẾT TTHC THÊM MỚI (${addedItems.length}):`);
        addedItems.slice(0, 15).forEach((item, idx) => {
            console.log(`   ${idx + 1}. [Mã: ${item.code}] ${item.name}`);
            console.log(`      └─ Phân cấp: ${item.level_label} | Ban hành: ${item.departmentPromulgate || 'N/A'}`);
        });
        if (addedItems.length > 15) console.log(`   ... và ${addedItems.length - 15} TTHC thêm mới khác.`);
        console.log('');
    }

    if (removedItems.length > 0) {
        console.log(`❌ DANH SÁCH CHI TIẾT TTHC BÃI BỎ / LOẠI BỎ (${removedItems.length}):`);
        removedItems.slice(0, 15).forEach((item, idx) => {
            console.log(`   ${idx + 1}. [Mã: ${item.code}] ${item.name}`);
            console.log(`      └─ Phân cấp: ${item.level_label} | Ban hành: ${item.departmentPromulgate || 'N/A'}`);
        });
        if (removedItems.length > 15) console.log(`   ... và ${removedItems.length - 15} TTHC bãi bỏ khác.`);
        console.log('');
    }

    if (modifiedItems.length > 0) {
        console.log(`✏️ DANH SÁCH CHI TIẾT TTHC THAY ĐỔI THÔNG TIN (${modifiedItems.length}):`);
        modifiedItems.slice(0, 15).forEach((item, idx) => {
            console.log(`   ${idx + 1}. [Mã: ${item.code}] ${item.new_name}`);
            console.log(`      └─ Thay đổi: ${item.old_level} -> ${item.new_level}`);
        });
        if (modifiedItems.length > 15) console.log(`   ... và ${modifiedItems.length - 15} TTHC thay đổi khác.`);
        console.log('');
    }

    const report = {
        compared_at: new Date().toISOString(),
        filter: "Unique by TTHC Code (National Standard + Gia Lai H21 | Excluding specific TTHCs of other provinces)",
        summary: {
            previous_total: previousTotal,
            current_total: currentItems.length,
            net_change: netChange,
            added_count: addedItems.length,
            removed_count: removedItems.length,
            modified_count: modifiedItems.length,
            level_breakdown: {
                province_only: provinceOnlyCount,
                ward_only: wardOnlyCount,
                both_province_and_ward: bothCount
            }
        },
        added: addedItems,
        removed: removedItems,
        modified: modifiedItems,
        added_items: addedItems,
        removed_items: removedItems,
        modified_items: modifiedItems
    };

    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(`💾 Đã lưu chi tiết danh sách thêm mới/bãi bỏ vào: data/compare_province_report.json`);

    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentItems, null, 2));
    console.log(`📸 Đã cập nhật Snapshot mới nhất cho kỳ so sánh tiếp theo.`);
    console.log('================================================================\n');

    const isChanged = addedItems.length > 0 || removedItems.length > 0 || modifiedItems.length > 0 || process.env.FORCE_ALERT === 'true';
    if (isChanged) {
        console.log(`🔔 Phát hiện biến động số liệu TTHC (Thêm: ${addedItems.length}, Bãi bỏ: ${removedItems.length}, Thay đổi: ${modifiedItems.length}). Tiến hành gửi cảnh báo...`);
        await sendAlertNotification({
            added: addedItems,
            removed: removedItems,
            modified: modifiedItems,
            summary: report.summary,
            hasSnapshot
        });
    } else {
        console.log(`ℹ️ Không có biến động tăng/giảm TTHC so với kỳ trước. Bỏ qua gửi cảnh báo.`);
    }
}

async function sendAlertNotification(summaryData) {
    const gasWebhookUrl = process.env.GAS_WEBHOOK_URL;
    const gasSecretKey = process.env.GAS_SECRET_KEY || '';

    if (!gasWebhookUrl) {
        console.log('⚠️ GAS_WEBHOOK_URL chưa được cấu hình. Bỏ qua gửi cảnh báo.');
        return;
    }

    const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const { added, removed, modified, summary, hasSnapshot } = summaryData;

    let emoji = '📊';
    if (summary.added_count > 0 && summary.removed_count === 0) emoji = '📈';
    else if (summary.removed_count > 0 && summary.added_count === 0) emoji = '📉';
    else if (summary.added_count > 0 || summary.removed_count > 0) emoji = '⚠️';

    const netSign = summary.net_change >= 0 ? `+${summary.net_change}` : `${summary.net_change}`;

    let messageLines = [
        `${emoji} *[CẢNH BÁO BIẾN ĐỘNG TTHC CẤP TỈNH & CẤP XÃ]*`,
        `⏰ *Thời gian:* \`${timeVN}\` (Giờ VN)`,
        `📌 *Trạng thái kỳ so sánh:* ${hasSnapshot ? 'So với Snapshot gần nhất' : 'Khởi tạo Snapshot ban đầu'}`,
        ``,
        `📈 *THỐNG KÊ TỔNG QUAN:*`,
        `  • Kỳ trước: *${summary.previous_total}* TTHC`,
        `  • Hiện tại: *${summary.current_total}* TTHC`,
        `  • Biến động ròng (Net): *${netSign}* TTHC`,
        `  • 🆕 Thêm mới: *${summary.added_count}* TTHC`,
        `  • 🗑️ Bãi bỏ: *${summary.removed_count}* TTHC`,
        `  • ✏️ Thay đổi thông tin: *${summary.modified_count}* TTHC`,
        ``,
        `🏢 *PHÂN LOẠI CẤP THỰC HIỆN:*`,
        `  • Chỉ Cấp Tỉnh: ${summary.level_breakdown.province_only}`,
        `  • Chỉ Cấp Xã: ${summary.level_breakdown.ward_only}`,
        `  • Cả Tỉnh & Xã: ${summary.level_breakdown.both_province_and_ward}`
    ];

    if (added.length > 0) {
        messageLines.push(``, `✨ *DANH SÁCH TTHC THÊM MỚI (${added.length}):*`);
        added.slice(0, 5).forEach((item, idx) => {
            messageLines.push(`${idx + 1}. \`[${item.code}]\` ${item.name}`);
        });
        if (added.length > 5) messageLines.push(`... và ${added.length - 5} TTHC khác.`);
    }

    if (removed.length > 0) {
        messageLines.push(``, `❌ *DANH SÁCH TTHC BÃI BỎ (${removed.length}):*`);
        removed.slice(0, 5).forEach((item, idx) => {
            messageLines.push(`${idx + 1}. \`[${item.code}]\` ${item.name}`);
        });
        if (removed.length > 5) messageLines.push(`... và ${removed.length - 5} TTHC khác.`);
    }

    if (modified.length > 0) {
        messageLines.push(``, `✏️ *DANH SÁCH TTHC THAY ĐỔI (${modified.length}):*`);
        modified.slice(0, 5).forEach((item, idx) => {
            messageLines.push(`${idx + 1}. \`[${item.code}]\` ${item.new_name || item.name} (${item.old_level} ➔ ${item.new_level})`);
        });
        if (modified.length > 5) messageLines.push(`... và ${modified.length - 5} TTHC khác.`);
    }

    const fullMessage = messageLines.join('\n');

    try {
        console.log('📤 Đang gửi cảnh báo biến động tới GAS Webhook...');
        const payload = {
            secret_key: gasSecretKey,
            secret: gasSecretKey,
            status: 'alert',
            status_text: `Biến động TTHC: ${netSign} (+${summary.added_count} / -${summary.removed_count})`,
            event_type: 'COMPARE_PROVINCE_ALERT',
            time: timeVN,
            message: fullMessage,
            text: fullMessage,
            summary: summary
        };
        const response = await axios.post(gasWebhookUrl, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });
        console.log('📩 Kết quả từ GAS Webhook:', response.data);
    } catch (err) {
        console.error('❌ Lỗi gửi cảnh báo tới GAS Webhook:', err.message);
    }
}

compareProvinceWard().catch(err => {
    console.error('❌ Lỗi khi thực thi compareProvinceWard:', err);
});

