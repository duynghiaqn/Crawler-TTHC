const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const DETAILS_DIR = path.join(DATA_DIR, 'details');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const DISCOVERY_FILE = path.join(DATA_DIR, 'discovery.json');

const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot_province.json');
const REPORT_FILE = path.join(DATA_DIR, 'compare_province_report.json');

// Kiểm tra TTHC thuộc Tỉnh Gia Lai (Mã H21)
function isGiaLaiItem(item) {
    const deptCode = item.departmentPromulgateCode || item.departmentCode || item.departmentPromulgateId || '';
    const deptName = item.departmentPromulgateName || item.departmentPromulgate || item.executingAgencies || item.departmentsExecuting || '';
    
    return (
        deptCode === 'H21' ||
        String(deptName).toLowerCase().includes('gia lai')
    );
}

function loadProvinceWardDataset() {
    const items = [];

    // 1. Đọc trực tiếp từ data/details/*.json (Lọc duy nhất Tỉnh Gia Lai - H21)
    if (fs.existsSync(DETAILS_DIR)) {
        try {
            const files = fs.readdirSync(DETAILS_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const fullPath = path.join(DETAILS_DIR, file);
                    const detail = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    if (detail && detail.id && isGiaLaiItem(detail)) {
                        const isProvince = Boolean(detail.isProvince || detail.type === 'PROVINCE');
                        const isWard = Boolean(detail.isWard);

                        items.push({
                            id: detail.id,
                            code: detail.code || detail.codeNotation || detail.ma_tthc || '',
                            name: detail.name || detail.ten_tthc || '',
                            departmentCode: 'H21',
                            formalityType: detail.formalityType || detail.type || 'STANDARD',
                            isProvince,
                            isWard,
                            isMinistry: Boolean(detail.isMinistry),
                            executingAgencies: detail.executingAgencies || detail.co_quan_thuc_hien || '',
                            departmentPromulgate: detail.departmentPromulgateName || detail.departmentPromulgate || 'UBND tỉnh Gia Lai'
                        });
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }

    if (items.length > 0) return items;

    // 2. Fallback từ discovery.json nếu chưa tải xong chi tiết
    if (fs.existsSync(DISCOVERY_FILE)) {
        try {
            const cache = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
            const raw = cache.items || cache;
            if (Array.isArray(raw)) {
                raw.forEach(item => {
                    if (isGiaLaiItem(item)) {
                        const depts = Array.isArray(item.departments) ? item.departments.join(', ') : '';
                        items.push({
                            id: item.id || item.code,
                            code: item.code || item.codeNotation || '',
                            name: item.name || '',
                            departmentCode: 'H21',
                            formalityType: item.formalityType || item.type || 'STANDARD',
                            isProvince: item.type === 'PROVINCE' || !depts.includes('cấp xã'),
                            isWard: depts.includes('cấp xã'),
                            isMinistry: false,
                            executingAgencies: depts,
                            departmentPromulgate: item.departmentPromulgate || 'UBND tỉnh Gia Lai'
                        });
                    }
                });
            }
        } catch (e) {}
    }

    return items;
}

function compareProvinceWard() {
    console.log('\n================================================================');
    console.log('🏛️  BÁO CÁO THEO DÕI BIẾN ĐỘNG TTHC TỈNH GIA LAI (H21)');
    console.log('    [Bộ lọc: departmentCode="H21" | type="PROVINCE" | STANDARD]');
    console.log('================================================================\n');

    const currentItems = loadProvinceWardDataset();
    if (currentItems.length === 0) {
        console.error('⚠️ Không tìm thấy dữ liệu TTHC Tỉnh Gia Lai (H21) trong hệ thống.');
        return;
    }

    const currentMap = new Map();
    currentItems.forEach(item => currentMap.set(item.id, item));

    let previousMap = new Map();
    let hasSnapshot = false;

    if (fs.existsSync(SNAPSHOT_FILE)) {
        try {
            const prevRaw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
            if (Array.isArray(prevRaw)) {
                prevRaw.forEach(item => previousMap.set(item.id, item));
                hasSnapshot = true;
            }
        } catch (e) {}
    }

    const currProvinceItems = currentItems.filter(x => x.isProvince);
    const currWardItems = currentItems.filter(x => x.isWard);

    if (!hasSnapshot) {
        console.log(`📸 Khởi tạo Snapshot TTHC Tỉnh Gia Lai (H21) lần đầu tiên.`);
        console.log(`⚡ Tổng TTHC Gia Lai phát hiện: ${currentItems.length} (Cấp Tỉnh: ${currProvinceItems.length} | Cấp Xã: ${currWardItems.length})`);
        fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentItems, null, 2));

        const initialReport = {
            compared_at: new Date().toISOString(),
            target_province: "Gia Lai",
            departmentCode: "H21",
            status: 'INITIAL_SNAPSHOT_CREATED',
            summary: {
                total_gialai_records: currentItems.length,
                province: { total: currProvinceItems.length, added: currProvinceItems.length, removed: 0, net_change: currProvinceItems.length },
                ward: { total: currWardItems.length, added: currWardItems.length, removed: 0, net_change: currWardItems.length }
            },
            province_added: currProvinceItems,
            province_removed: [],
            ward_added: currWardItems,
            ward_removed: []
        };

        fs.writeFileSync(REPORT_FILE, JSON.stringify(initialReport, null, 2));
        console.log(`✅ Đã ghi báo cáo khởi tạo Tỉnh Gia Lai vào: data/compare_province_report.json\n`);
        return;
    }

    // Phân tích so sánh biến động Tỉnh Gia Lai (H21)
    const provinceAdded = [];
    const provinceRemoved = [];
    const wardAdded = [];
    const wardRemoved = [];

    // Tìm TTHC thêm mới
    currentMap.forEach((currItem, id) => {
        if (!previousMap.has(id)) {
            if (currItem.isProvince) provinceAdded.push(currItem);
            if (currItem.isWard) wardAdded.push(currItem);
        } else {
            const prevItem = previousMap.get(id);
            if (!prevItem.isProvince && currItem.isProvince) provinceAdded.push(currItem);
            if (prevItem.isProvince && !currItem.isProvince) provinceRemoved.push(currItem);

            if (!prevItem.isWard && currItem.isWard) wardAdded.push(currItem);
            if (prevItem.isWard && !currItem.isWard) wardRemoved.push(currItem);
        }
    });

    // Tìm TTHC bãi bỏ
    previousMap.forEach((prevItem, id) => {
        if (!currentMap.has(id)) {
            if (prevItem.isProvince) provinceRemoved.push(prevItem);
            if (prevItem.isWard) wardRemoved.push(prevItem);
        }
    });

    let prevProvinceCount = 0;
    let prevWardCount = 0;
    previousMap.forEach(item => {
        if (item.isProvince) prevProvinceCount++;
        if (item.isWard) prevWardCount++;
    });

    const netProvinceChange = currProvinceItems.length - prevProvinceCount;
    const netWardChange = currWardItems.length - prevWardCount;

    const signProvince = netProvinceChange >= 0 ? `+${netProvinceChange}` : `${netProvinceChange}`;
    const signWard = netWardChange >= 0 ? `+${netWardChange}` : `${netWardChange}`;

    console.log(`📌 1. TTHC GIA LAI (H21) - CẤP TỈNH (PROVINCE LEVEL):`);
    console.log(`   • Số lượng kỳ trước: ${prevProvinceCount}`);
    console.log(`   • Số lượng hiện tại: ${currProvinceItems.length}`);
    console.log(`   • Biến động ròng (Net): ${signProvince} TTHC`);
    console.log(`   • 🆕 Thêm mới / bổ sung: ${provinceAdded.length} TTHC`);
    console.log(`   • 🗑️ Bãi bỏ / loại bỏ:   ${provinceRemoved.length} TTHC\n`);

    if (provinceAdded.length > 0) {
        console.log(`   ✨ Chi tiết TTHC Cấp Tỉnh thêm mới (${provinceAdded.length}):`);
        provinceAdded.forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        console.log('');
    }

    if (provinceRemoved.length > 0) {
        console.log(`   ❌ Chi tiết TTHC Cấp Tỉnh bãi bỏ (${provinceRemoved.length}):`);
        provinceRemoved.forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        console.log('');
    }

    console.log(`----------------------------------------------------------------`);
    console.log(`📌 2. TTHC GIA LAI (H21) - CẤP XÃ (WARD/COMMUNE LEVEL):`);
    console.log(`   • Số lượng kỳ trước: ${prevWardCount}`);
    console.log(`   • Số lượng hiện tại: ${currWardItems.length}`);
    console.log(`   • Biến động ròng (Net): ${signWard} TTHC`);
    console.log(`   • 🆕 Thêm mới / bổ sung: ${wardAdded.length} TTHC`);
    console.log(`   • 🗑️ Bãi bỏ / loại bỏ:   ${wardRemoved.length} TTHC\n`);

    if (wardAdded.length > 0) {
        console.log(`   ✨ Chi tiết TTHC Cấp Xã thêm mới (${wardAdded.length}):`);
        wardAdded.forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        console.log('');
    }

    if (wardRemoved.length > 0) {
        console.log(`   ❌ Chi tiết TTHC Cấp Xã bãi bỏ (${wardRemoved.length}):`);
        wardRemoved.forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        console.log('');
    }

    const report = {
        compared_at: new Date().toISOString(),
        target_province: "Gia Lai",
        departmentCode: "H21",
        summary: {
            province: {
                previous: prevProvinceCount,
                current: currProvinceItems.length,
                net_change: netProvinceChange,
                added_count: provinceAdded.length,
                removed_count: provinceRemoved.length
            },
            ward: {
                previous: prevWardCount,
                current: currWardItems.length,
                net_change: netWardChange,
                added_count: wardAdded.length,
                removed_count: wardRemoved.length
            }
        },
        province_added: provinceAdded,
        province_removed: provinceRemoved,
        ward_added: wardAdded,
        ward_removed: wardRemoved
    };

    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(`💾 Chi tiết báo cáo Tỉnh Gia Lai (H21) đã lưu tại: data/compare_province_report.json`);

    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentItems, null, 2));
    console.log(`📸 Đã cập nhật Snapshot Tỉnh Gia Lai cho kỳ so sánh tiếp theo.`);
    console.log('================================================================\n');
}

compareProvinceWard();
