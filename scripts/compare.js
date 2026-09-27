const fs = require('fs');
const path = require('path');

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
                return raw.map(item => ({
                    id: item.id || item.ma_tthc,
                    code: item.ma_tthc || item.code || '',
                    name: item.ten_tthc || item.name || '',
                    category: item.linh_vuc || (Array.isArray(item.categories) ? item.categories.join(', ') : ''),
                    agency: item.co_quan_thuc_hien || (Array.isArray(item.departments) ? item.departments.join(', ') : '')
                }));
            }
        } catch (e) {}
    }

    if (fs.existsSync(DISCOVERY_FILE)) {
        try {
            const cache = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
            const items = cache.items || cache;
            if (Array.isArray(items) && items.length > 0) {
                return items.map(item => ({
                    id: item.id || item.code,
                    code: item.code || item.codeNotation || '',
                    name: item.name || '',
                    category: Array.isArray(item.categories) ? item.categories.join(', ') : '',
                    agency: Array.isArray(item.departments) ? item.departments.join(', ') : ''
                }));
            }
        } catch (e) {}
    }

    return [];
}

function compareDatasets() {
    console.log('\n==================================================');
    console.log('📊 BÁO CÁO THEO DÕI BIẾN ĐỘNG TTHC (COMPARE ENGINE)');
    console.log('==================================================\n');

    const currentItems = loadCurrentDataset();
    if (currentItems.length === 0) {
        console.error('❌ Không tìm thấy dữ liệu TTHC hiện tại trong index.json hoặc discovery.json.');
        return;
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
            if (Array.isArray(prevRaw)) {
                prevRaw.forEach(item => {
                    if (item.id) previousMap.set(item.id, item);
                });
                hasSnapshot = true;
            }
        } catch (e) {
            console.warn(`⚠️ Tệp snapshot cũ hỏng hoặc không hợp lệ: ${e.message}`);
        }
    }

    if (!hasSnapshot) {
        console.log(`📸 Chưa có Snapshot dữ liệu trước đó.`);
        console.log(`⚡ Tạo mới Snapshot khởi tạo ban đầu với: ${currentItems.length} TTHC.`);
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
                modified_count: 0
            },
            added: [],
            removed: [],
            modified: []
        };
        fs.writeFileSync(REPORT_FILE, JSON.stringify(initialReport, null, 2));
        console.log(`✅ Báo cáo khởi tạo đã được ghi vào data/compare_report.json\n`);
        return;
    }

    // Tiến hành so sánh biến động
    const added = [];
    const removed = [];
    const modified = [];

    // Tìm TTHC mới thêm vào
    currentMap.forEach((currItem, id) => {
        if (!previousMap.has(id)) {
            added.push(currItem);
        } else {
            const prevItem = previousMap.get(id);
            if (prevItem.name !== currItem.name || prevItem.code !== currItem.code) {
                modified.push({
                    id,
                    code: currItem.code,
                    old_name: prevItem.name,
                    new_name: currItem.name
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

    console.log(`📈 THỐNG KÊ TỔNG QUAN:`);
    console.log(`   • Số lượng TTHC kỳ trước: ${previousMap.size}`);
    console.log(`   • Số lượng TTHC hiện tại: ${currentItems.length}`);
    console.log(`   • Biến động ròng (Net):   ${netSign} TTHC`);
    console.log(`   • 🆕 Thêm mới:           ${added.length} TTHC`);
    console.log(`   • 🗑️ Bãi bỏ / Xóa:        ${removed.length} TTHC`);
    console.log(`   • ✏️ Thay đổi tên/mã:    ${modified.length} TTHC\n`);

    if (added.length > 0) {
        console.log(`✨ DANH SÁCH TTHC MỚI BỔ SUNG (${added.length}):`);
        added.slice(0, 10).forEach((item, idx) => {
            console.log(`   ${idx + 1}. [${item.code || 'N/A'}] ${item.name} (${item.category || 'N/A'})`);
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

    // Xuất tệp Báo cáo JSON
    const report = {
        compared_at: new Date().toISOString(),
        summary: {
            previous_total: previousMap.size,
            current_total: currentItems.length,
            net_change: netChange,
            added_count: added.length,
            removed_count: removed.length,
            modified_count: modified.length
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
}

compareDatasets();
