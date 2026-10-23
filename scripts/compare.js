const fs = require('fs');
const path = require('path');
const { isInternalProcedure, getProcedureGroup } = require('./filter_gia_lai');

const DATA_DIR = path.join(process.cwd(), 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const DISCOVERY_FILE = path.join(DATA_DIR, 'discovery.json');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot.json');
const REPORT_FILE = path.join(DATA_DIR, 'compare_report.json');

function loadCurrentDataset() {
    if (fs.existsSync(INDEX_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
            if (Array.isArray(raw) && raw.length > 0) {
                return raw.map(item => {
                    const isInternal = item.is_noi_bo !== undefined 
                        ? Boolean(item.is_noi_bo) 
                        : isInternalProcedure(item.loai_tthc, item.loai_tthc, item.ten_tthc || item.name);
                    return {
                        id: item.id || item.ma_tthc,
                        code: item.ma_tthc || item.code || '',
                        name: item.ten_tthc || item.name || '',
                        cap_thuc_hien: item.cap_thuc_hien || '',
                        nhom_thu_tuc: item.nhom_thu_tuc || (isInternal ? 'Thủ tục nội bộ' : 'Thủ tục hành chính'),
                        is_noi_bo: isInternal,
                        loai_tthc: item.loai_tthc || '',
                        category: item.linh_vuc || (Array.isArray(item.categories) ? item.categories.join(', ') : ''),
                        agency: item.co_quan_thuc_hien || (Array.isArray(item.departments) ? item.departments.join(', ') : ''),
                        url: item.url || (item.id ? `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${item.id}` : '')
                    };
                });
            }
        } catch (e) {}
    }

    if (fs.existsSync(DISCOVERY_FILE)) {
        try {
            const cache = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
            const items = cache.items || cache;
            if (Array.isArray(items) && items.length > 0) {
                return items.map(item => {
                    const isInternal = isInternalProcedure(item.type, item.type, item.name);
                    return {
                        id: item.id || item.code,
                        code: item.code || item.codeNotation || '',
                        name: item.name || '',
                        nhom_thu_tuc: isInternal ? 'Thủ tục nội bộ' : 'Thủ tục hành chính',
                        is_noi_bo: isInternal,
                        loai_tthc: item.type || '',
                        category: Array.isArray(item.categories) ? item.categories.join(', ') : '',
                        agency: Array.isArray(item.departments) ? item.departments.join(', ') : ''
                    };
                });
            }
        } catch (e) {}
    }

    return [];
}

function compareDatasets() {
    console.log('\n==================================================');
    console.log('📊 BÁO CÁO THEO DÕI BIẾN ĐỘNG TTHC TOÀN QUỐC (COMPARE ENGINE)');
    console.log('==================================================\n');

    const currentItems = loadCurrentDataset();
    if (currentItems.length === 0) {
        console.error('❌ Không tìm thấy dữ liệu TTHC hiện tại trong index.json hoặc discovery.json.');
        return null;
    }

    const currentMap = new Map();
    currentItems.forEach(item => {
        if (item.id) currentMap.set(item.id, item);
    });

    let previousMap = new Map();
    let hasSnapshot = false;

    if (fs.existsSync(SNAPSHOT_FILE)) {
        try {
            const prevRaw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
            if (Array.isArray(prevRaw) && prevRaw.length > 0) {
                prevRaw.forEach(item => {
                    const key = item.id || item.code || item.ma_tthc;
                    if (key) {
                        const isInternal = item.is_noi_bo !== undefined 
                            ? Boolean(item.is_noi_bo) 
                            : isInternalProcedure(item.loai_tthc || item.type, item.loai_tthc, item.name || item.ten_tthc);
                        previousMap.set(key, {
                            id: item.id || key,
                            code: item.code || item.ma_tthc || '',
                            name: item.name || item.ten_tthc || '',
                            cap_thuc_hien: item.cap_thuc_hien || '',
                            nhom_thu_tuc: item.nhom_thu_tuc || (isInternal ? 'Thủ tục nội bộ' : 'Thủ tục hành chính'),
                            is_noi_bo: isInternal,
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

    const adminCurrent = currentItems.filter(x => !x.is_noi_bo).length;
    const internalCurrent = currentItems.filter(x => x.is_noi_bo).length;

    // Kiểm tra xem báo cáo so sánh đã được tạo hợp lệ trước đó chưa
    if (hasSnapshot && previousMap.size === currentMap.size && fs.existsSync(REPORT_FILE)) {
        try {
            const existingReport = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
            const reportAge = Date.now() - new Date(existingReport.compared_at || 0).getTime();
            // Nếu báo cáo vừa được tạo dưới 15 phút và có ghi nhận biến động
            if (reportAge < 15 * 60 * 1000 && existingReport.summary && 
                (existingReport.summary.added_count > 0 || existingReport.summary.removed_count > 0 || existingReport.summary.modified_count > 0)) {
                console.log(`ℹ️ Báo cáo biến động đã được cập nhật gần nhất (${Math.round(reportAge / 1000)}s trước) với ${existingReport.summary.added_count} thêm, ${existingReport.summary.removed_count} bãi bỏ, ${existingReport.summary.modified_count} sửa đổi.`);
                console.log(`   Giữ nguyên kết quả báo cáo hợp lệ và bỏ qua ghi đè rỗng.`);
                return existingReport;
            }
        } catch (e) {}
    }

    if (!hasSnapshot) {
        console.log(`📸 Chưa có Snapshot dữ liệu trước đó.`);
        console.log(`⚡ Tạo mới Snapshot khởi tạo ban đầu với: ${currentItems.length} TTHC.`);
        console.log(`   • 👥 Thủ tục hành chính: ${adminCurrent} TTHC`);
        console.log(`   • 🏢 Thủ tục nội bộ:    ${internalCurrent} TTHC\n`);
        fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentItems, null, 2));
        
        const initialReport = {
            compared_at: new Date().toISOString(),
            status: 'INITIAL_SNAPSHOT_CREATED',
            summary: {
                previous_total: 0,
                current_total: currentItems.length,
                net_change: currentItems.length,
                added_count: currentItems.length,
                removed_count: 0,
                modified_count: 0,
                administrative: {
                    current_total: adminCurrent,
                    added_count: adminCurrent,
                    removed_count: 0,
                    modified_count: 0
                },
                internal: {
                    current_total: internalCurrent,
                    added_count: internalCurrent,
                    removed_count: 0,
                    modified_count: 0
                }
            },
            added: currentItems,
            removed: [],
            modified: []
        };
        fs.writeFileSync(REPORT_FILE, JSON.stringify(initialReport, null, 2));
        console.log(`✅ Báo cáo khởi tạo đã được ghi vào data/compare_report.json\n`);
        return initialReport;
    }

    // Tiến hành so sánh biến động
    const added = [];
    const removed = [];
    const modified = [];

    // Tìm TTHC mới thêm vào & sửa đổi
    currentMap.forEach((currItem, id) => {
        if (!previousMap.has(id)) {
            added.push(currItem);
        } else {
            const prevItem = previousMap.get(id);
            const changes = [];
            if (prevItem.name !== currItem.name) changes.push({ field: 'Tên TTHC', old: prevItem.name, new: currItem.name });
            if (prevItem.code && currItem.code && prevItem.code !== currItem.code) changes.push({ field: 'Mã TTHC', old: prevItem.code, new: currItem.code });
            if (prevItem.cap_thuc_hien && currItem.cap_thuc_hien && prevItem.cap_thuc_hien !== currItem.cap_thuc_hien) changes.push({ field: 'Cấp thực hiện', old: prevItem.cap_thuc_hien, new: currItem.cap_thuc_hien });
            if (prevItem.nhom_thu_tuc && currItem.nhom_thu_tuc && prevItem.nhom_thu_tuc !== currItem.nhom_thu_tuc) changes.push({ field: 'Nhóm thủ tục', old: prevItem.nhom_thu_tuc, new: currItem.nhom_thu_tuc });
            if (prevItem.loai_tthc && currItem.loai_tthc && prevItem.loai_tthc !== currItem.loai_tthc) changes.push({ field: 'Loại TTHC', old: prevItem.loai_tthc, new: currItem.loai_tthc });
            if (prevItem.agency && currItem.agency && prevItem.agency !== currItem.agency) changes.push({ field: 'Cơ quan thực hiện', old: prevItem.agency, new: currItem.agency });

            if (changes.length > 0) {
                modified.push({
                    id,
                    code: currItem.code,
                    name: currItem.name,
                    nhom_thu_tuc: currItem.nhom_thu_tuc,
                    changes,
                    url: currItem.url
                });
            }
        }
    });

    // Tìm TTHC đã bị bãi bỏ / xóa
    previousMap.forEach((prevItem, id) => {
        if (!currentMap.has(id)) {
            removed.push(prevItem);
        }
    });

    const netChange = currentItems.length - previousMap.size;
    const netSign = netChange >= 0 ? `+${netChange}` : `${netChange}`;

    const adminAdded = added.filter(x => !x.is_noi_bo).length;
    const internalAdded = added.filter(x => x.is_noi_bo).length;

    const adminRemoved = removed.filter(x => !x.is_noi_bo).length;
    const internalRemoved = removed.filter(x => x.is_noi_bo).length;

    const adminModified = modified.filter(x => !x.is_noi_bo).length;
    const internalModified = modified.filter(x => x.is_noi_bo).length;

    console.log(`📈 THỐNG KÊ TỔNG QUAN BIẾN ĐỘNG TOÀN BỘ TTHC:`);
    console.log(`   • Số lượng TTHC kỳ trước: ${previousMap.size}`);
    console.log(`   • Số lượng TTHC hiện tại: ${currentItems.length}`);
    console.log(`     └─ 👥 Thủ tục hành chính: ${adminCurrent} TTHC`);
    console.log(`     └─ 🏢 Thủ tục nội bộ:    ${internalCurrent} TTHC`);
    console.log(`   • Biến động ròng (Net):   ${netSign} TTHC`);
    console.log(`   • 🆕 Thêm mới:           ${added.length} TTHC (TTHC: +${adminAdded} | Nội bộ: +${internalAdded})`);
    console.log(`   • 🗑️ Bãi bỏ / Xóa:        ${removed.length} TTHC (TTHC: -${adminRemoved} | Nội bộ: -${internalRemoved})`);
    console.log(`   • ✏️ Thay đổi nội dung:   ${modified.length} TTHC (TTHC: ~${adminModified} | Nội bộ: ~${internalModified})\n`);

    if (added.length > 0) {
        console.log(`✨ DANH SÁCH TTHC MỚI BỔ SUNG (${added.length}):`);
        added.slice(0, 10).forEach((item, idx) => {
            console.log(`   ${idx + 1}. [${item.code || 'N/A'}] [${item.nhom_thu_tuc || 'TTHC'}] ${item.name} (${item.category || item.agency || 'N/A'})`);
        });
        if (added.length > 10) console.log(`   ... và ${added.length - 10} TTHC mới khác.`);
        console.log('');
    }

    if (removed.length > 0) {
        console.log(`❌ DANH SÁCH TTHC ĐÃ BÃI BỎ (${removed.length}):`);
        removed.slice(0, 10).forEach((item, idx) => {
            console.log(`   ${idx + 1}. [${item.code || 'N/A'}] [${item.nhom_thu_tuc || 'TTHC'}] ${item.name}`);
        });
        if (removed.length > 10) console.log(`   ... và ${removed.length - 10} TTHC bãi bỏ khác.`);
        console.log('');
    }

    // Xuất tệp Báo cáo JSON
    const report = {
        compared_at: new Date().toISOString(),
        summary: {
            previous_total: previousMap.size,
            current_total: currentItems.length,
            net_change: netChange,
            added_count: added.length,
            removed_count: removed.length,
            modified_count: modified.length,
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
            }
        },
        added,
        removed,
        modified
    };

    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(`💾 Chi tiết báo cáo đã được lưu vào: data/compare_report.json`);

    // Cập nhật Snapshot cho kỳ tiếp theo
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentItems, null, 2));
    console.log(`📸 Đã cập nhật Snapshot mới nhất cho lần so sánh tiếp theo.`);
    console.log('==================================================\n');

    return report;
}

if (require.main === module) {
    compareDatasets();
}

module.exports = {
    compareDatasets,
    loadCurrentDataset
};
