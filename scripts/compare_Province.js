const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const DETAILS_DIR = path.join(DATA_DIR, 'details');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const DISCOVERY_FILE = path.join(DATA_DIR, 'discovery.json');

const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot_province.json');
const REPORT_FILE = path.join(DATA_DIR, 'compare_province_report.json');

function loadProvinceWardDataset() {
    const items = [];

    // 1. Đọc trực tiếp từ data/details/*.json (nhiều thông tin chính xác nhất về isProvince, isWard)
    if (fs.existsSync(DETAILS_DIR)) {
        try {
            const files = fs.readdirSync(DETAILS_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const fullPath = path.join(DETAILS_DIR, file);
                    const detail = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    if (detail && detail.id) {
                        const isProvince = Boolean(detail.isProvince);
                        const isWard = Boolean(detail.isWard);
                        const isMinistry = Boolean(detail.isMinistry);
                        const isOtherAgency = Boolean(detail.isOtherAgency);

                        if (isProvince || isWard) {
                            items.push({
                                id: detail.id,
                                code: detail.code || detail.codeNotation || detail.ma_tthc || '',
                                name: detail.name || detail.ten_tthc || '',
                                isProvince,
                                isWard,
                                isMinistry,
                                isOtherAgency,
                                executingAgencies: detail.executingAgencies || detail.co_quan_thuc_hien || '',
                                departmentPromulgate: detail.departmentPromulgate || ''
                            });
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }

    if (items.length > 0) return items;

    // 2. Fallback từ index.json nếu chưa tải xong chi tiết
    if (fs.existsSync(INDEX_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
            if (Array.isArray(raw)) {
                raw.forEach(item => {
                    const levelStr = String(item.cap_thuc_hien || '');
                    const isProvince = levelStr.includes('Cấp tỉnh');
                    const isWard = levelStr.includes('Cấp xã');
                    if (isProvince || isWard) {
                        items.push({
                            id: item.id || item.ma_tthc,
                            code: item.ma_tthc || '',
                            name: item.ten_tthc || '',
                            isProvince,
                            isWard,
                            isMinistry: levelStr.includes('Cấp Bộ'),
                            isOtherAgency: levelStr.includes('Cơ quan khác'),
                            executingAgencies: item.co_quan_thuc_hien || '',
                            departmentPromulgate: ''
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
    console.log('🏛️  BÁO CÁO THEO DÕI BIẾN ĐỘNG TTHC CẤP TỈNH & CẤP XÃ');
    console.log('================================================================\n');

    const currentItems = loadProvinceWardDataset();
    if (currentItems.length === 0) {
        console.error('❌ Không tìm thấy dữ liệu TTHC Cấp tỉnh / Cấp xã.');
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

    if (!hasSnapshot) {
        console.log(`📸 Khởi tạo Snapshot Cấp Tỉnh & Cấp Xã lần đầu tiên.`);
        console.log(`⚡ Tổng số TTHC Cấp Tỉnh/Xã hiện có: ${currentItems.length}`);
        fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentItems, null, 2));

        const provinceCount = currentItems.filter(x => x.isProvince).length;
        const wardCount = currentItems.filter(x => x.isWard).length;

        const initialReport = {
            compared_at: new Date().toISOString(),
            status: 'INITIAL_SNAPSHOT_CREATED',
            summary: {
                total_target_records: currentItems.length,
                province: { total: provinceCount, added: provinceCount, removed: 0, net_change: provinceCount },
                ward: { total: wardCount, added: wardCount, removed: 0, net_change: wardCount }
            },
            province_added: [],
            province_removed: [],
            ward_added: [],
            ward_removed: []
        };

        fs.writeFileSync(REPORT_FILE, JSON.stringify(initialReport, null, 2));
        console.log(`✅ Đã tạo tệp báo cáo khởi tạo: data/compare_province_report.json\n`);
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
            // Kiểm tra trường hợp chuyển cấp (từ không phải cấp tỉnh/xã sang cấp tỉnh/xã)
            const prevItem = previousMap.get(id);
            if (!prevItem.isProvince && currItem.isProvince) provinceAdded.push(currItem);
            if (prevItem.isProvince && !currItem.isProvince) provinceRemoved.push(currItem);

            if (!prevItem.isWard && currItem.isWard) wardAdded.push(currItem);
            if (prevItem.isWard && !currItem.isWard) wardRemoved.push(currItem);
        }
    });

    // Tìm TTHC bị bãi bỏ / xóa
    previousMap.forEach((prevItem, id) => {
        if (!currentMap.has(id)) {
            if (prevItem.isProvince) provinceRemoved.push(prevItem);
            if (prevItem.isWard) wardRemoved.push(prevItem);
        }
    });

    // Tính toán số lượng trước và sau
    let prevProvinceCount = 0;
    let prevWardCount = 0;
    previousMap.forEach(item => {
        if (item.isProvince) prevProvinceCount++;
        if (item.isWard) prevWardCount++;
    });

    const currProvinceCount = currentItems.filter(x => x.isProvince).length;
    const currWardCount = currentItems.filter(x => x.isWard).length;

    const netProvinceChange = currProvinceCount - prevProvinceCount;
    const netWardChange = currWardCount - prevWardCount;

    const signProvince = netProvinceChange >= 0 ? `+${netProvinceChange}` : `${netProvinceChange}`;
    const signWard = netWardChange >= 0 ? `+${netWardChange}` : `${netWardChange}`;

    console.log(`📌 1. BÁO CÁO TTHC CẤP TỈNH (PROVINCE LEVEL):`);
    console.log(`   • Số lượng TTHC Cấp tỉnh kỳ trước: ${prevProvinceCount}`);
    console.log(`   • Số lượng TTHC Cấp tỉnh hiện tại: ${currProvinceCount}`);
    console.log(`   • Biến động ròng (Net):             ${signProvince} TTHC`);
    console.log(`   • 🆕 Thêm mới / bổ sung cấp:       ${provinceAdded.length} TTHC`);
    console.log(`   • 🗑️ Bãi bỏ / bỏ phân cấp:         ${provinceRemoved.length} TTHC\n`);

    if (provinceAdded.length > 0) {
        console.log(`   ✨ TTHC Cấp Tỉnh thêm mới (${provinceAdded.length}):`);
        provinceAdded.slice(0, 5).forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        if (provinceAdded.length > 5) console.log(`      ... và ${provinceAdded.length - 5} TTHC khác.`);
        console.log('');
    }

    if (provinceRemoved.length > 0) {
        console.log(`   ❌ TTHC Cấp Tỉnh bãi bỏ (${provinceRemoved.length}):`);
        provinceRemoved.slice(0, 5).forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        if (provinceRemoved.length > 5) console.log(`      ... và ${provinceRemoved.length - 5} TTHC khác.`);
        console.log('');
    }

    console.log(`----------------------------------------------------------------`);
    console.log(`📌 2. BÁO CÁO TTHC CẤP XÃ (WARD/COMMUNE LEVEL):`);
    console.log(`   • Số lượng TTHC Cấp xã kỳ trước:   ${prevWardCount}`);
    console.log(`   • Số lượng TTHC Cấp xã hiện tại:   ${currWardCount}`);
    console.log(`   • Biến động ròng (Net):             ${signWard} TTHC`);
    console.log(`   • 🆕 Thêm mới / bổ sung cấp:       ${wardAdded.length} TTHC`);
    console.log(`   • 🗑️ Bãi bỏ / bỏ phân cấp:         ${wardRemoved.length} TTHC\n`);

    if (wardAdded.length > 0) {
        console.log(`   ✨ TTHC Cấp Xã thêm mới (${wardAdded.length}):`);
        wardAdded.slice(0, 5).forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        if (wardAdded.length > 5) console.log(`      ... và ${wardAdded.length - 5} TTHC khác.`);
        console.log('');
    }

    if (wardRemoved.length > 0) {
        console.log(`   ❌ TTHC Cấp Xã bãi bỏ (${wardRemoved.length}):`);
        wardRemoved.slice(0, 5).forEach((item, idx) => {
            console.log(`      ${idx + 1}. [${item.code}] ${item.name}`);
        });
        if (wardRemoved.length > 5) console.log(`      ... và ${wardRemoved.length - 5} TTHC khác.`);
        console.log('');
    }

    // Ghi file báo cáo JSON
    const report = {
        compared_at: new Date().toISOString(),
        summary: {
            province: {
                previous: prevProvinceCount,
                current: currProvinceCount,
                net_change: netProvinceChange,
                added_count: provinceAdded.length,
                removed_count: provinceRemoved.length
            },
            ward: {
                previous: prevWardCount,
                current: currWardCount,
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

    // Cập nhật Snapshot cho kỳ tiếp theo
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentItems, null, 2));
    console.log(`📸 Đã cập nhật Snapshot Cấp tỉnh/xã mới nhất cho lần so sánh tiếp theo.`);
    console.log('================================================================\n');
}

compareProvinceWard();
