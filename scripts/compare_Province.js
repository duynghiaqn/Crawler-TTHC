const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const {
    isEligibleGiaLai,
    getLevelLabel,
    isInternalProcedure,
    getProcedureGroup
} = require('./filter_gia_lai');

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_GL_DIR = path.join(process.cwd(), 'data-gl');

const DETAILS_DIR = fs.existsSync(path.join(DATA_GL_DIR, 'details')) 
    ? path.join(DATA_GL_DIR, 'details') 
    : path.join(DATA_DIR, 'details');

const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot_province.json');
const REPORT_FILE = path.join(DATA_DIR, 'compare_province_report.json');

const SNAPSHOT_GL_FILE = path.join(DATA_GL_DIR, 'snapshot.json');
const REPORT_GL_FILE = path.join(DATA_GL_DIR, 'compare_report.json');

function shouldIncludeItem(detail) {
    return isEligibleGiaLai(detail);
}

function loadUniqueProvinceWardDataset() {
    const codeMap = new Map();

    // 1. Ưu tiên đọc từ data-gl/index.json nếu có sẵn
    const glIndexFile = path.join(DATA_GL_DIR, 'index.json');
    if (fs.existsSync(glIndexFile)) {
        try {
            const raw = JSON.parse(fs.readFileSync(glIndexFile, 'utf8'));
            if (Array.isArray(raw) && raw.length > 0) {
                raw.forEach(item => {
                    const code = String(item.ma_tthc || item.code || item.id).trim();
                    if (!code) return;
                    const fType = item.loai_tthc || item.formalityType || 'STANDARD';
                    const name = item.ten_tthc || item.name || '';
                    const isInternal = typeof item.is_noi_bo === 'boolean' 
                        ? item.is_noi_bo 
                        : isInternalProcedure(fType, item.formalityType, name);
                    const group = item.nhom_thu_tuc || getProcedureGroup(fType, item.formalityType, name);

                    codeMap.set(code, {
                        id: item.id || code,
                        code,
                        name,
                        category: item.linh_vuc || (Array.isArray(item.categories) ? item.categories.join(', ') : item.category) || '',
                        agency: item.co_quan_thuc_hien || item.executingAgencies || '',
                        isProvince: Boolean(item.isProvince || (item.cap_thuc_hien && item.cap_thuc_hien.includes('tỉnh'))),
                        isWard: Boolean(item.isWard || (item.cap_thuc_hien && item.cap_thuc_hien.includes('xã'))),
                        formalityType: fType,
                        executingAgencies: item.co_quan_thuc_hien || item.executingAgencies || '',
                        departmentPromulgate: item.co_quan_ban_hanh || item.departmentPromulgate || '',
                        nhom_thu_tuc: group,
                        is_noi_bo: isInternal,
                        url: item.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${code}`
                    });
                });
            }
        } catch (e) {}
    }

    // 2. Nếu chưa có data-gl/index.json, đọc từ DETAILS_DIR áp dụng shouldIncludeItem
    if (codeMap.size === 0 && fs.existsSync(DETAILS_DIR)) {
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
                        const fType = detail.formalityType || detail.type || 'STANDARD';
                        const name = detail.name || detail.ten_tthc || '';
                        const isInternal = typeof detail.is_noi_bo === 'boolean'
                            ? detail.is_noi_bo
                            : isInternalProcedure(fType, detail.formalityType, name);
                        const group = detail.nhom_thu_tuc || getProcedureGroup(fType, detail.formalityType, name);

                        if (!codeMap.has(code)) {
                            codeMap.set(code, {
                                id: detail.id || code,
                                code,
                                name,
                                category,
                                agency,
                                isProvince,
                                isWard,
                                formalityType: fType,
                                executingAgencies: detail.executingAgencies || detail.co_quan_thuc_hien || agency,
                                departmentPromulgate: detail.departmentPromulgateName || detail.departmentPromulgate || '',
                                nhom_thu_tuc: group,
                                is_noi_bo: isInternal,
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

    return Array.from(codeMap.values()).map(item => ({
        ...item,
        level_label: getLevelLabel(item)
    }));
}

async function compareProvinceWard() {
    console.log('\n================================================================');
    console.log('🏛️  BÁO CÁO THEO DÕI BIẾN ĐỘNG TTHC THEO MÃ DUY NHẤT (PROVINCE & WARD)');
    console.log('    [Tính duy nhất theo Mã TTHC | Hợp nhất thủ tục áp dụng cả Tỉnh & Xã]');
    console.log('    [Phân loại: Thủ tục hành chính & Thủ tục nội bộ]');
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

    // Ưu tiên đọc data-gl/snapshot.json trước, rồi đến data/snapshot_province.json
    const snapshotPathToRead = fs.existsSync(SNAPSHOT_GL_FILE) 
        ? SNAPSHOT_GL_FILE 
        : (fs.existsSync(SNAPSHOT_FILE) ? SNAPSHOT_FILE : null);

    if (snapshotPathToRead) {
        try {
            const prevRaw = JSON.parse(fs.readFileSync(snapshotPathToRead, 'utf8'));
            if (Array.isArray(prevRaw) && prevRaw.length > 0) {
                prevRaw.forEach(item => {
                    const code = String(item.code || item.ma_tthc || item.codeNotation || item.id).trim();
                    if (!code) return;
                    const fType = item.formalityType || item.loai_tthc || 'STANDARD';
                    const name = item.name || item.ten_tthc || '';
                    const isInternal = typeof item.is_noi_bo === 'boolean'
                        ? item.is_noi_bo
                        : isInternalProcedure(fType, item.formalityType, name);
                    const group = item.nhom_thu_tuc || getProcedureGroup(fType, item.formalityType, name);

                    previousMap.set(code, {
                        id: item.id || code,
                        code: code,
                        name: name,
                        category: item.category || item.linh_vuc || '',
                        agency: item.agency || item.co_quan_thuc_hien || item.executingAgencies || '',
                        isProvince: Boolean(item.isProvince || (item.cap_thuc_hien && item.cap_thuc_hien.includes('tỉnh'))),
                        isWard: Boolean(item.isWard || (item.cap_thuc_hien && item.cap_thuc_hien.includes('xã'))),
                        formalityType: fType,
                        executingAgencies: item.executingAgencies || item.co_quan_thuc_hien || '',
                        departmentPromulgate: item.departmentPromulgate || item.co_quan_ban_hanh || '',
                        nhom_thu_tuc: group,
                        is_noi_bo: isInternal,
                        level_label: item.level_label || getLevelLabel(item),
                        url: item.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${code}`
                    });
                });
                hasSnapshot = previousMap.size > 0;
            }
        } catch (e) {}
    }

    // Nếu snapshot vừa bị ghi đè trùng khớp current, nhưng report đã có sẵn biến động, kiểm tra bảo tồn
    let existingReportHasDiffs = false;
    let existingReport = null;
    const checkReportFile = fs.existsSync(REPORT_GL_FILE) ? REPORT_GL_FILE : (fs.existsSync(REPORT_FILE) ? REPORT_FILE : null);
    if (checkReportFile) {
        try {
            existingReport = JSON.parse(fs.readFileSync(checkReportFile, 'utf8'));
            const s = existingReport?.summary;
            if (s && ((s.added_count || 0) > 0 || (s.removed_count || 0) > 0 || (s.modified_count || 0) > 0)) {
                existingReportHasDiffs = true;
            }
        } catch (e) {}
    }

    const provinceOnlyCount = currentItems.filter(x => x.isProvince && !x.isWard).length;
    const wardOnlyCount = currentItems.filter(x => !x.isProvince && x.isWard).length;
    const bothCount = currentItems.filter(x => x.isProvince && x.isWard).length;

    const adminCurrent = currentItems.filter(x => !x.is_noi_bo).length;
    const internalCurrent = currentItems.filter(x => x.is_noi_bo).length;

    let addedItems = [];
    let removedItems = [];
    let modifiedItems = [];

    if (!hasSnapshot) {
        console.log(`📸 Khởi tạo Snapshot theo Mã TTHC duy nhất lần đầu tiên.`);
        console.log(`⚡ Tổng số Mã TTHC duy nhất hiện tại: ${currentItems.length}`);
        console.log(`   • Thủ tục hành chính:       ${adminCurrent} TTHC`);
        console.log(`   • Thủ tục nội bộ:           ${internalCurrent} TTHC`);
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
                const groupChanged = prevItem.nhom_thu_tuc !== currItem.nhom_thu_tuc;

                if (nameChanged || levelChanged || groupChanged) {
                    modifiedItems.push({
                        id: currItem.id || code,
                        code,
                        name: currItem.name,
                        category: currItem.category || '',
                        agency: currItem.agency || currItem.executingAgencies || '',
                        nhom_thu_tuc: currItem.nhom_thu_tuc,
                        is_noi_bo: currItem.is_noi_bo,
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
                    nhom_thu_tuc: prevItem.nhom_thu_tuc || getProcedureGroup(prevItem.formalityType, prevItem.formalityType, prevItem.name),
                    is_noi_bo: typeof prevItem.is_noi_bo === 'boolean' ? prevItem.is_noi_bo : isInternalProcedure(prevItem.formalityType, prevItem.formalityType, prevItem.name),
                    departmentPromulgate: prevItem.departmentPromulgate || '',
                    executingAgencies: prevItem.executingAgencies || '',
                    url: prevItem.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${code}`
                });
            }
        });
    }

    // Safety guard: Nếu diff = 0 nhưng report cũ có biến động (do snapshot đã bị ghi đè trước đó trong cùng phiên crawl)
    if (addedItems.length === 0 && removedItems.length === 0 && modifiedItems.length === 0 && existingReportHasDiffs) {
        console.log(`ℹ️ Snapshot trùng với currentItems nhưng phát hiện báo cáo trước đó đã ghi nhận biến động.`);
        console.log(`   Giữ lại dữ liệu biến động từ báo cáo hiện có (${existingReport.summary.added_count} thêm, ${existingReport.summary.removed_count} bãi bỏ).`);
        addedItems = existingReport.added || existingReport.added_items || [];
        removedItems = existingReport.removed || existingReport.removed_items || [];
        modifiedItems = existingReport.modified || existingReport.modified_items || [];
    }

    const previousTotal = hasSnapshot ? previousMap.size : 0;
    const netChange = currentItems.length - previousTotal;
    const netSign = netChange >= 0 ? `+${netChange}` : `${netChange}`;

    const adminAdded = addedItems.filter(x => !x.is_noi_bo).length;
    const internalAdded = addedItems.filter(x => x.is_noi_bo).length;
    const adminRemoved = removedItems.filter(x => !x.is_noi_bo).length;
    const internalRemoved = removedItems.filter(x => x.is_noi_bo).length;
    const adminModified = modifiedItems.filter(x => !x.is_noi_bo).length;
    const internalModified = modifiedItems.filter(x => x.is_noi_bo).length;

    console.log(`📈 THỐNG KÊ BIẾN ĐỘNG DỮ LIỆU:`);
    console.log(`   • Tổng số mã TTHC kỳ trước: ${previousTotal}`);
    console.log(`   • Tổng số mã TTHC hiện tại: ${currentItems.length}`);
    console.log(`   • Biến động ròng (Net):      ${netSign} mã TTHC`);
    console.log(`   • 🆕 Mã TTHC thêm mới:      ${addedItems.length} (TTHC: ${adminAdded} | Nội bộ: ${internalAdded})`);
    console.log(`   • 🗑️ Mã TTHC bãi bỏ:        ${removedItems.length} (TTHC: ${adminRemoved} | Nội bộ: ${internalRemoved})`);
    console.log(`   • ✏️ Mã TTHC thay đổi:       ${modifiedItems.length} (TTHC: ${adminModified} | Nội bộ: ${internalModified})\n`);

    console.log(`📊 PHÂN LOẠI HIỆN TẠI:`);
    console.log(`   • 🌐 Thủ tục hành chính:       ${adminCurrent} TTHC`);
    console.log(`   • 🔒 Thủ tục nội bộ:           ${internalCurrent} TTHC`);
    console.log(`   • 🏢 Chỉ Cấp Tỉnh:             ${provinceOnlyCount} TTHC`);
    console.log(`   • 🏡 Chỉ Cấp Xã:               ${wardOnlyCount} TTHC`);
    console.log(`   • 🔄 CẢ CẤP TỈNH & CẤP XÃ:     ${bothCount} TTHC\n`);

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
            administrative: {
                current_total: adminCurrent,
                added_count: adminAdded,
                removed_count: adminRemoved,
                modified_count: adminModified
            },
            internal: {
                current_total: internalCurrent,
                added_count: internalAdded,
                removed_count: internalRemoved,
                modified_count: internalModified
            },
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
    console.log(`📸 Đã cập nhật Snapshot mới nhất cho kỳ so sánh tiếp theo: data/snapshot_province.json`);

    if (fs.existsSync(DATA_GL_DIR)) {
        fs.writeFileSync(REPORT_GL_FILE, JSON.stringify(report, null, 2));
        fs.writeFileSync(SNAPSHOT_GL_FILE, JSON.stringify(currentItems, null, 2));
        console.log(`💾 Đã đồng bộ Báo cáo & Snapshot vào thư mục data-gl/ (snapshot.json, compare_report.json)`);
    }

    // Tự động xuất file Excel Master Data & Biến động TTHC Gia Lai
    try {
        const { exportTTHCExcel } = require('./export_excel');
        exportTTHCExcel();
    } catch (excelErr) {
        console.warn('⚠️ Lỗi khi tự động xuất Excel từ compare_Province:', excelErr.message);
    }
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
    const admin = summary.administrative || {};
    const intern = summary.internal || {};

    let messageLines = [
        `${emoji} *[CẢNH BÁO BIẾN ĐỘNG TTHC CẤP TỈNH & CẤP XÃ]*`,
        `⏰ *Thời gian:* \`${timeVN}\` (Giờ VN)`,
        `📌 *Trạng thái kỳ so sánh:* ${hasSnapshot ? 'So với Snapshot gần nhất' : 'Khởi tạo Snapshot ban đầu'}`,
        ``,
        `📈 *THỐNG KÊ TỔNG QUAN:*`,
        `  • Kỳ trước: *${summary.previous_total}* TTHC`,
        `  • Hiện tại: *${summary.current_total}* TTHC`,
        `  • Biến động ròng (Net): *${netSign}* TTHC`,
        `  • 🆕 Thêm mới: *${summary.added_count}* TTHC (TTHC: +${admin.added_count ?? 0} | Nội bộ: +${intern.added_count ?? 0})`,
        `  • 🗑️ Bãi bỏ: *${summary.removed_count}* TTHC (TTHC: -${admin.removed_count ?? 0} | Nội bộ: -${intern.removed_count ?? 0})`,
        `  • ✏️ Thay đổi thông tin: *${summary.modified_count}* TTHC`,
        ``,
        `🌐 *PHÂN LOẠI NHÓM THỦ TỤC:*`,
        `  • Thủ tục hành chính: *${admin.current_total ?? (summary.current_total - (intern.current_total || 0))}*`,
        `  • Thủ tục nội bộ: *${intern.current_total ?? 0}*`,
        ``,
        `🏢 *PHÂN LOẠI CẤP THỰC HIỆN:*`,
        `  • Chỉ Cấp Tỉnh: ${summary.level_breakdown?.province_only ?? 0}`,
        `  • Chỉ Cấp Xã: ${summary.level_breakdown?.ward_only ?? 0}`,
        `  • Cả Tỉnh & Xã: ${summary.level_breakdown?.both_province_and_ward ?? 0}`
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

