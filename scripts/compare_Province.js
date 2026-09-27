const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const DETAILS_DIR = path.join(DATA_DIR, 'details');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const DISCOVERY_FILE = path.join(DATA_DIR, 'discovery.json');

const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot_province.json');
const REPORT_FILE = path.join(DATA_DIR, 'compare_province_report.json');

// Kiểm tra điều kiện giữ lại TTHC Cấp Tỉnh / Cấp Xã (Loại trừ TTHC đặc thù của tỉnh thành khác)
function shouldIncludeInProvinceWardReport(detail) {
    const isProvince = Boolean(detail.isProvince || detail.type === 'PROVINCE');
    const isWard = Boolean(detail.isWard || detail.type === 'WARD');

    // Chỉ xét TTHC Cấp tỉnh hoặc Cấp xã
    if (!isProvince && !isWard) return false;

    const deptCode = detail.departmentPromulgateCode || detail.departmentCode || detail.departmentPromulgateId || '';
    const deptName = detail.departmentPromulgateName || detail.departmentPromulgate || detail.executingAgencies || detail.departmentsExecuting || '';
    const isGiaLai = deptCode === 'H21' || String(deptName).toLowerCase().includes('gia lai');

    const type = detail.type || detail.formalityType || '';
    const isSpecificOther = (type === 'SPECIFIC' || type === 'LOCAL_REGULATION') && !isGiaLai;

    // Loại bỏ TTHC đặc thù/địa phương của tỉnh thành khác
    if (isSpecificOther) return false;

    return true;
}

function loadProvinceWardDataset() {
    const items = [];

    // 1. Nạp từ data/details/*.json (Chi tiết chính xác nhất)
    if (fs.existsSync(DETAILS_DIR)) {
        try {
            const files = fs.readdirSync(DETAILS_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const fullPath = path.join(DETAILS_DIR, file);
                    const detail = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    if (detail && detail.id && shouldIncludeInProvinceWardReport(detail)) {
                        const isProvince = Boolean(detail.isProvince || detail.type === 'PROVINCE');
                        const isWard = Boolean(detail.isWard || detail.type === 'WARD');

                        items.push({
                            id: detail.id,
                            code: detail.code || detail.codeNotation || detail.ma_tthc || '',
                            name: detail.name || detail.ten_tthc || '',
                            formalityType: detail.formalityType || detail.type || 'STANDARD',
                            isProvince,
                            isWard,
                            isMinistry: Boolean(detail.isMinistry),
                            executingAgencies: detail.executingAgencies || detail.co_quan_thuc_hien || '',
                            departmentPromulgate: detail.departmentPromulgateName || detail.departmentPromulgate || ''
                        });
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }

    if (items.length > 0) return items;

    // 2. Fallback từ discovery.json
    if (fs.existsSync(DISCOVERY_FILE)) {
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

                    if (shouldIncludeInProvinceWardReport(mockDetail)) {
                        items.push({
                            id: item.id || item.code,
                            code: item.code || item.codeNotation || '',
                            name: item.name || '',
                            formalityType: item.formalityType || item.type || 'STANDARD',
                            isProvince: mockDetail.isProvince,
                            isWard: mockDetail.isWard,
                            isMinistry: false,
                            executingAgencies: depts,
                            departmentPromulgate: item.departmentPromulgate || ''
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
    console.log('🏛️  BÁO CÁO THEO DÕI BIẾN ĐỘNG TTHC CẤP TỈNH & CẤP XÃ TOÀN QUỐC');
    console.log('    [Bao gồm: TTHC Tiêu chuẩn/Liên thông + TTHC Gia Lai H21]');
    console.log('    [Loại bỏ: TTHC Đặc thù/Địa phương của các tỉnh thành khác]');
    console.log('================================================================\n');

    const currentItems = loadProvinceWardDataset();
    if (currentItems.length === 0) {
        console.error('⚠️ Không tìm thấy dữ liệu TTHC Cấp tỉnh / Cấp xã phù hợp.');
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
        console.log(`📸 Khởi tạo Snapshot Cấp Tỉnh & Cấp Xã (Đã lọc bỏ TTHC đặc thù tỉnh khác) lần đầu tiên.`);
        console.log(`⚡ Tổng TTHC hợp lệ: ${currentItems.length} (Cấp Tỉnh: ${currProvinceItems.length} | Cấp Xã: ${currWardItems.length})`);
        fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentItems, null, 2));

        const initialReport = {
            compared_at: new Date().toISOString(),
            filter: "Standard/National TTHC + Gia Lai H21 (Excluding specific TTHCs of other provinces)",
            status: 'INITIAL_SNAPSHOT_CREATED',
            summary: {
                total_target_records: currentItems.length,
                province: { total: currProvinceItems.length, added: currProvinceItems.length, removed: 0, net_change: currProvinceItems.length },
                ward: { total: currWardItems.length, added: currWardItems.length, removed: 0, net_change: currWardItems.length }
            },
            province_added: [],
            province_removed: [],
            ward_added: [],
            ward_removed: []
        };

        fs.writeFileSync(REPORT_FILE, JSON.stringify(initialReport, null, 2));
        console.log(`✅ Đã ghi báo cáo khởi tạo vào: data/compare_province_report.json\n`);
        return;
    }

    // Phân tích so sánh biến động Cấp Tỉnh & Cấp Xã
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

    console.log(`📌 1. BÁO CÁO TTHC CẤP TỈNH (PROVINCE LEVEL):`);
    console.log(`   • Số lượng kỳ trước: ${prevProvinceCount}`);
    console.log(`   • Số lượng hiện tại: ${currProvinceItems.length}`);
    console.log(`   • Biến động ròng (Net): ${signProvince} TTHC`);
    console.log(`   • 🆕 Thêm mới / bổ sung: ${provinceAdded.length} TTHC`);
    console.log(`   • 🗑️ Bãi bỏ / loại bỏ:   ${provinceRemoved.length} TTHC\n`);

    if (provinceAdded.length > 0) {
        console.log(`   ✨ Chi tiết TTHC Cấp Tỉnh thêm mới (${provinceAdded.length}):`);
        provinceAdded.slice(0, 10).forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        if (provinceAdded.length > 10) console.log(`      ... và ${provinceAdded.length - 10} TTHC khác.`);
        console.log('');
    }

    if (provinceRemoved.length > 0) {
        console.log(`   ❌ Chi tiết TTHC Cấp Tỉnh bãi bỏ (${provinceRemoved.length}):`);
        provinceRemoved.slice(0, 10).forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        if (provinceRemoved.length > 10) console.log(`      ... và ${provinceRemoved.length - 10} TTHC khác.`);
        console.log('');
    }

    console.log(`----------------------------------------------------------------`);
    console.log(`📌 2. BÁO CÁO TTHC CẤP XÃ (WARD/COMMUNE LEVEL):`);
    console.log(`   • Số lượng kỳ trước: ${prevWardCount}`);
    console.log(`   • Số lượng hiện tại: ${currWardItems.length}`);
    console.log(`   • Biến động ròng (Net): ${signWard} TTHC`);
    console.log(`   • 🆕 Thêm mới / bổ sung: ${wardAdded.length} TTHC`);
    console.log(`   • 🗑️ Bãi bỏ / loại bỏ:   ${wardRemoved.length} TTHC\n`);

    if (wardAdded.length > 0) {
        console.log(`   ✨ Chi tiết TTHC Cấp Xã thêm mới (${wardAdded.length}):`);
        wardAdded.slice(0, 10).forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        if (wardAdded.length > 10) console.log(`      ... và ${wardAdded.length - 10} TTHC khác.`);
        console.log('');
    }

    if (wardRemoved.length > 0) {
        console.log(`   ❌ Chi tiết TTHC Cấp Xã bãi bỏ (${wardRemoved.length}):`);
        wardRemoved.slice(0, 10).forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        if (wardRemoved.length > 10) console.log(`      ... và ${wardRemoved.length - 10} TTHC khác.`);
        console.log('');
    }

    const report = {
        compared_at: new Date().toISOString(),
        filter: "Standard/National TTHC + Gia Lai H21 (Excluding specific TTHCs of other provinces)",
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
    console.log(`💾 Chi tiết báo cáo Cấp tỉnh & Cấp xã đã lưu tại: data/compare_province_report.json`);

    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentItems, null, 2));
    console.log(`📸 Đã cập nhật Snapshot Cấp tỉnh/xã mới nhất cho kỳ so sánh tiếp theo.`);
    console.log('================================================================\n');
}

compareProvinceWard();
