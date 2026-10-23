const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { 
    getLevelLabel, 
    isInternalProcedure, 
    getProcedureGroup 
} = require('./filter_gia_lai');

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_GL_DIR = path.join(process.cwd(), 'data-gl');

const SNAPSHOT_PROVINCE_FILE = path.join(DATA_DIR, 'snapshot_province.json');
const REPORT_PROVINCE_FILE = path.join(DATA_DIR, 'compare_province_report.json');

const SNAPSHOT_GL_FILE = path.join(DATA_GL_DIR, 'snapshot.json');
const INDEX_GL_FILE = path.join(DATA_GL_DIR, 'index.json');
const REPORT_GL_FILE = path.join(DATA_GL_DIR, 'compare_report.json');

const EXCEL_OUTPUT_FILE = path.join(DATA_GL_DIR, 'Bao_cao_TTHC_Gia_Lai.xlsx');

const INDEX_NATIONAL_FILE = path.join(DATA_DIR, 'index.json');
const SNAPSHOT_NATIONAL_FILE = path.join(DATA_DIR, 'snapshot.json');
const REPORT_NATIONAL_FILE = path.join(DATA_DIR, 'compare_report.json');
const EXCEL_NATIONAL_OUTPUT_FILE = path.join(DATA_DIR, 'Bao_cao_TTHC_DVCQG.xlsx');

/**
 * Format timestamp sang gio Viet Nam (ICT - UTC+7)
 */
function formatVietnamTime(date = new Date()) {
    return new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(date);
}

function formatCategory(cat) {
    if (!cat) return '';
    if (typeof cat === 'object') return cat.name || cat.title || '';
    return String(cat);
}

/**
 * Xuat file Excel tong hop TTHC Cap Tinh, Cap Xa va Bien dong Gia Lai
 */
function exportTTHCExcel(customOutputPath = null) {
    const outputPath = customOutputPath || EXCEL_OUTPUT_FILE;
    console.log('\n================================================================');
    console.log('📊 ĐANG XUẤT FILE EXCEL MASTER DATA & BIẾN ĐỘNG TTHC GIA LAI...');
    console.log('================================================================');

    // 1. Doc du lieu: Ưu tiên data-gl/snapshot.json hoặc data-gl/index.json
    let allItems = [];
    if (fs.existsSync(SNAPSHOT_GL_FILE)) {
        try {
            allItems = JSON.parse(fs.readFileSync(SNAPSHOT_GL_FILE, 'utf8'));
        } catch (e) {}
    } else if (fs.existsSync(INDEX_GL_FILE)) {
        try {
            allItems = JSON.parse(fs.readFileSync(INDEX_GL_FILE, 'utf8'));
        } catch (e) {}
    }

    // Fallback: data/snapshot_province.json
    if ((!Array.isArray(allItems) || allItems.length === 0) && fs.existsSync(SNAPSHOT_PROVINCE_FILE)) {
        try {
            allItems = JSON.parse(fs.readFileSync(SNAPSHOT_PROVINCE_FILE, 'utf8'));
        } catch (e) {
            console.error('⚠️ Lỗi đọc file snapshot_province.json:', e.message);
        }
    }

    if (!Array.isArray(allItems) || allItems.length === 0) {
        console.error('❌ Không có dữ liệu TTHC Cấp tỉnh / Cấp xã để xuất Excel!');
        return null;
    }

    // Đảm bảo chuẩn hóa nhom_thu_tuc và is_noi_bo cho mọi bản ghi
    allItems = allItems.map(item => {
        const fType = item.formalityType || item.loai_tthc || 'STANDARD';
        const name = item.name || item.ten_tthc || '';
        const isInternal = typeof item.is_noi_bo === 'boolean'
            ? item.is_noi_bo
            : isInternalProcedure(fType, item.formalityType, name);
        const group = item.nhom_thu_tuc || getProcedureGroup(fType, item.formalityType, name);
        return {
            ...item,
            nhom_thu_tuc: group,
            is_noi_bo: isInternal
        };
    });

    // 2. Doc du lieu bien dong tu compare_report.json (data-gl) hoac compare_province_report.json (data)
    let reportData = null;
    if (fs.existsSync(REPORT_GL_FILE)) {
        try {
            reportData = JSON.parse(fs.readFileSync(REPORT_GL_FILE, 'utf8'));
        } catch (e) {}
    } else if (fs.existsSync(REPORT_PROVINCE_FILE)) {
        try {
            reportData = JSON.parse(fs.readFileSync(REPORT_PROVINCE_FILE, 'utf8'));
        } catch (e) {
            console.warn('⚠️ Lỗi đọc file compare_province_report.json:', e.message);
        }
    }

    const summary = reportData?.summary || {};
    const addedList = reportData?.added || reportData?.added_items || [];
    const removedList = reportData?.removed || reportData?.removed_items || [];
    const modifiedList = reportData?.modified || reportData?.modified_items || [];

    const nowStr = formatVietnamTime();

    // 3. Loc danh sach theo nhom va theo cap
    const adminItems = allItems.filter(x => !x.is_noi_bo);
    const internalItems = allItems.filter(x => x.is_noi_bo);

    const provinceItems = allItems.filter(x => x.isProvince);
    const wardItems = allItems.filter(x => x.isWard);
    const provinceOnlyItems = allItems.filter(x => x.isProvince && !x.isWard);
    const wardOnlyItems = allItems.filter(x => !x.isProvince && x.isWard);
    const bothItems = allItems.filter(x => x.isProvince && x.isWard);

    // Tao Workbook moi
    const wb = XLSX.utils.book_new();

    // -------------------------------------------------------------
    // SHEET 1: Tổng hợp & Biến động Gia Lai
    // -------------------------------------------------------------
    const s1Rows = [
        ['BÁO CÁO TỔNG HỢP VÀ THEO DÕI BIẾN ĐỘNG THỦ TỤC HÀNH CHÍNH TỈNH GIA LAI'],
        [`Thời gian xuất báo cáo: ${nowStr} (Giờ Việt Nam)`],
        [`Đơn vị áp dụng: Tỉnh Gia Lai (Mã địa phương H21 & Chuẩn quốc gia cấp Tỉnh/Xã)`],
        [`Kỳ so sánh: Đối soát so với Snapshot kỳ trước`],
        [],
        ['I. THỐNG KÊ TỔNG QUAN TTHC HIỆN TẠI TRÊN ĐỊA BÀN TỈNH GIA LAI'],
        ['Chỉ số thống kê', 'Số lượng TTHC', 'Tỷ lệ %', 'Ghi chú'],
        ['Tổng số mã TTHC cấp Tỉnh & cấp Xã áp dụng:', allItems.length, '100%', 'Tính duy nhất theo Mã TTHC DVCQG'],
        ['  1. Phân loại theo Nhóm thủ tục:'],
        ['     • Thủ tục hành chính (phục vụ người dân, doanh nghiệp):', adminItems.length, `${((adminItems.length / allItems.length) * 100).toFixed(1)}%`, 'Thủ tục chuẩn, đặc thù, liên thông...'],
        ['     • Thủ tục nội bộ (giữa các cơ quan hành chính nhà nước):', internalItems.length, `${((internalItems.length / allItems.length) * 100).toFixed(1)}%`, 'Thủ tục nội bộ các cấp'],
        ['  2. Phân loại theo Thẩm quyền / Cấp thực hiện:'],
        ['     • TTHC thẩm quyền giải quyết Cấp Tỉnh (Tổng cộng):', provinceItems.length, `${((provinceItems.length / allItems.length) * 100).toFixed(1)}%`, 'Bao gồm thủ tục chỉ cấp tỉnh và cả 2 cấp'],
        ['         + Chỉ thực hiện tại Cấp Tỉnh:', provinceOnlyItems.length, `${((provinceOnlyItems.length / allItems.length) * 100).toFixed(1)}%`, ''],
        ['         + Thực hiện tại CẢ Cấp Tỉnh & Cấp Xã:', bothItems.length, `${((bothItems.length / allItems.length) * 100).toFixed(1)}%`, 'Thủ tục phân cấp linh hoạt'],
        ['     • TTHC thẩm quyền giải quyết Cấp Xã (Tổng cộng):', wardItems.length, `${((wardItems.length / allItems.length) * 100).toFixed(1)}%`, 'Bao gồm thủ tục chỉ cấp xã và cả 2 cấp'],
        ['         + Chỉ thực hiện tại Cấp Xã:', wardOnlyItems.length, `${((wardOnlyItems.length / allItems.length) * 100).toFixed(1)}%`, ''],
        [],
        ['II. THỐNG KÊ BIẾN ĐỘNG SO VỚI KỲ TRƯỚC'],
        ['Chỉ số biến động', 'Số lượng', 'Đánh giá'],
        ['Tổng số TTHC kỳ trước:', summary.previous_total ?? 'Chưa có', ''],
        ['Tổng số TTHC hiện tại:', summary.current_total ?? allItems.length, ''],
        ['Biến động ròng (Net Change):', (summary.net_change >= 0 ? `+${summary.net_change}` : summary.net_change) ?? '0', summary.net_change > 0 ? 'Tăng' : (summary.net_change < 0 ? 'Giảm' : 'Không đổi')],
        ['  - Số TTHC Mới thêm (+):', addedList.length, `TTHC: +${summary.administrative?.added_count ?? 0} | Nội bộ: +${summary.internal?.added_count ?? 0}`],
        ['  - Số TTHC Bãi bỏ / Xóa (-):', removedList.length, `TTHC: -${summary.administrative?.removed_count ?? 0} | Nội bộ: -${summary.internal?.removed_count ?? 0}`],
        ['  - Số TTHC Điều chỉnh thông tin (~):', modifiedList.length, modifiedList.length > 0 ? 'Có TTHC sửa đổi' : 'Không có'],
        [],
        ['III. DANH SÁCH CHI TIẾT TTHC BIẾN ĐỘNG TẠI TỈNH GIA LAI (TĂNG / GIẢM / ĐIỀU CHỈNH)'],
        [
            'STT',
            'Loại biến động',
            'Nhóm thủ tục',
            'Mã TTHC',
            'Tên Thủ tục Hành chính',
            'Cấp thực hiện',
            'Lĩnh vực',
            'Cơ quan ban hành',
            'Cơ quan thực hiện',
            'Chi tiết thay đổi / Ghi chú',
            'Đường dẫn tra cứu DVCQG'
        ]
    ];

    let vIndex = 1;
    // Them moi
    addedList.forEach(item => {
        const group = item.nhom_thu_tuc || getProcedureGroup(item.formalityType || item.loai_tthc, item.formalityType, item.name || item.ten_tthc);
        s1Rows.push([
            vIndex++,
            'Mới thêm (+)',
            group,
            item.code || '',
            item.name || '',
            getLevelLabel(item),
            formatCategory(item.category),
            item.departmentPromulgate || '',
            item.executingAgencies || item.agency || '',
            'Thủ tục mới được bổ sung/ban hành trong kỳ này',
            item.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.code}`
        ]);
    });

    // Bai bo
    removedList.forEach(item => {
        const group = item.nhom_thu_tuc || getProcedureGroup(item.formalityType || item.loai_tthc, item.formalityType, item.name || item.ten_tthc);
        s1Rows.push([
            vIndex++,
            'Bãi bỏ (-)',
            group,
            item.code || '',
            item.name || '',
            getLevelLabel(item),
            formatCategory(item.category),
            item.departmentPromulgate || '',
            item.executingAgencies || item.agency || '',
            'Thủ tục đã bị bãi bỏ hoặc loại khỏi danh mục',
            item.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.code}`
        ]);
    });

    // Thay doi
    modifiedList.forEach(item => {
        const group = item.nhom_thu_tuc || getProcedureGroup(item.formalityType || item.loai_tthc, item.formalityType, item.name || item.ten_tthc);
        const changeDesc = [];
        if (item.old_name && item.old_name !== item.new_name) {
            changeDesc.push(`Đổi tên: "${item.old_name}" -> "${item.new_name}"`);
        }
        if (item.old_level && item.new_level && item.old_level !== item.new_level) {
            changeDesc.push(`Đổi cấp: ${item.old_level} -> ${item.new_level}`);
        }
        s1Rows.push([
            vIndex++,
            'Thay đổi (~)',
            group,
            item.code || '',
            item.new_name || item.name || '',
            item.new_level || getLevelLabel(item),
            formatCategory(item.category),
            item.departmentPromulgate || '',
            item.executingAgencies || item.agency || '',
            changeDesc.join(' | ') || 'Cập nhật nội dung',
            item.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.code}`
        ]);
    });

    if (vIndex === 1) {
        s1Rows.push(['', 'Không có biến động', '', '', 'Không có TTHC nào tăng, giảm hoặc thay đổi so với kỳ trước', '', '', '', '', '', '']);
    }

    const ws1 = XLSX.utils.aoa_to_sheet(s1Rows);
    ws1['!cols'] = [
        { wch: 6 },   // STT
        { wch: 15 },  // Loai bien dong
        { wch: 22 },  // Nhom thu tuc
        { wch: 15 },  // Ma TTHC
        { wch: 55 },  // Ten TTHC
        { wch: 22 },  // Cap thuc hien
        { wch: 25 },  // Linh vuc
        { wch: 28 },  // Co quan ban hanh
        { wch: 30 },  // Co quan thuc hien
        { wch: 45 },  // Ghi chu
        { wch: 55 }   // Link
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Tổng hợp & Biến động');

    // Helper tạo Sheet danh mục TTHC cấp địa phương
    function createGiaLaiDatasetSheet(items, sheetTitle) {
        const rows = [
            [sheetTitle.toUpperCase()],
            [`Thời gian xuất: ${nowStr} (Giờ VN) | Tổng số: ${items.length} TTHC`],
            [],
            [
                'STT',
                'Mã TTHC',
                'Tên Thủ tục Hành chính',
                'Nhóm thủ tục',
                'Phân cấp chi tiết',
                'Lĩnh vực',
                'Cơ quan ban hành',
                'Cơ quan thực hiện',
                'Hình thức quy định',
                'Đường dẫn tra cứu DVCQG'
            ]
        ];

        items.forEach((item, idx) => {
            const detailLevel = (item.isProvince && item.isWard) ? 'Cả Cấp tỉnh & Cấp xã' : (item.isProvince ? 'Chỉ Cấp tỉnh' : 'Chỉ Cấp xã');
            rows.push([
                idx + 1,
                item.code || '',
                item.name || '',
                item.nhom_thu_tuc || 'Thủ tục hành chính',
                detailLevel,
                formatCategory(item.category),
                item.departmentPromulgate || '',
                item.executingAgencies || item.agency || '',
                item.formalityType || 'STANDARD',
                item.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.code}`
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [
            { wch: 6 },   // STT
            { wch: 15 },  // Ma TTHC
            { wch: 55 },  // Ten TTHC
            { wch: 22 },  // Nhom thu tuc
            { wch: 24 },  // Phan cap chi tiet
            { wch: 25 },  // Linh vuc
            { wch: 28 },  // Co quan ban hanh
            { wch: 30 },  // Co quan thuc hien
            { wch: 20 },  // Hinh thuc
            { wch: 55 }   // Link
        ];
        return ws;
    }

    // SHEET 2: Thủ tục hành chính (DVC) phục vụ người dân, doanh nghiệp
    const ws2 = createGiaLaiDatasetSheet(adminItems, 'DANH MỤC THỦ TỤC HÀNH CHÍNH (DVC) ÁP DỤNG TẠI GIA LAI');
    XLSX.utils.book_append_sheet(wb, ws2, 'Thủ tục hành chính (DVC)');

    // SHEET 3: Thủ tục nội bộ
    const ws3 = createGiaLaiDatasetSheet(internalItems, 'DANH MỤC THỦ TỤC NỘI BỘ GIỮA CÁC CƠ QUAN HÀNH CHÍNH (GIA LAI)');
    XLSX.utils.book_append_sheet(wb, ws3, 'Thủ tục nội bộ');

    // SHEET 4: TTHC Cấp Tỉnh
    const ws4 = createGiaLaiDatasetSheet(provinceItems, 'DANH SÁCH THỦ TỤC HÀNH CHÍNH THẨM QUYỀN GIẢI QUYẾT CẤP TỈNH (GIA LAI)');
    XLSX.utils.book_append_sheet(wb, ws4, 'TTHC Cấp Tỉnh');

    // SHEET 5: TTHC Cấp Xã
    const ws5 = createGiaLaiDatasetSheet(wardItems, 'DANH SÁCH THỦ TỤC HÀNH CHÍNH THẨM QUYỀN GIẢI QUYẾT CẤP XÃ (GIA LAI)');
    XLSX.utils.book_append_sheet(wb, ws5, 'TTHC Cấp Xã');

    // SHEET 6: Toàn bộ Cấp Tỉnh & Cấp Xã (allItems)
    const s6Rows = [
        ['TOÀN BỘ DANH MỤC THỦ TỤC HÀNH CHÍNH & NỘI BỘ CẤP TỈNH & CẤP XÃ (GIA LAI)'],
        [`Tổng số lượng: ${allItems.length} TTHC | Thời gian xuất: ${nowStr}`],
        [],
        [
            'STT',
            'Mã TTHC',
            'Tên Thủ tục Hành chính',
            'Nhóm thủ tục',
            'Phân cấp thực hiện',
            'Cấp Tỉnh',
            'Cấp Xã',
            'Lĩnh vực',
            'Cơ quan ban hành',
            'Cơ quan thực hiện',
            'Hình thức quy định',
            'Đường dẫn tra cứu DVCQG'
        ]
    ];

    allItems.forEach((item, idx) => {
        s6Rows.push([
            idx + 1,
            item.code || '',
            item.name || '',
            item.nhom_thu_tuc || 'Thủ tục hành chính',
            getLevelLabel(item),
            item.isProvince ? 'Có' : 'Không',
            item.isWard ? 'Có' : 'Không',
            formatCategory(item.category),
            item.departmentPromulgate || '',
            item.executingAgencies || item.agency || '',
            item.formalityType || 'STANDARD',
            item.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.code}`
        ]);
    });

    const ws6 = XLSX.utils.aoa_to_sheet(s6Rows);
    ws6['!cols'] = [
        { wch: 6 },   // STT
        { wch: 15 },  // Ma TTHC
        { wch: 55 },  // Ten TTHC
        { wch: 22 },  // Nhom thu tuc
        { wch: 24 },  // Phan cap thuc hien
        { wch: 10 },  // Cap Tinh
        { wch: 10 },  // Cap Xa
        { wch: 25 },  // Linh vuc
        { wch: 28 },  // Co quan ban hanh
        { wch: 30 },  // Co quan thuc hien
        { wch: 20 },  // Hinh thuc
        { wch: 55 }   // Link
    ];
    XLSX.utils.book_append_sheet(wb, ws6, 'Toàn bộ Cấp Tỉnh & Xã');

    // 4. Ghi file ra dia
    XLSX.writeFile(wb, outputPath);
    console.log(`✅ Xuất thành công file Excel tại: ${outputPath}`);
    console.log(`   • Sheet 1: 'Tổng hợp & Biến động' (${s1Rows.length - 27} dòng biến động)`);
    console.log(`   • Sheet 2: 'Thủ tục hành chính (DVC)' (${adminItems.length} TTHC)`);
    console.log(`   • Sheet 3: 'Thủ tục nội bộ' (${internalItems.length} TTHC)`);
    console.log(`   • Sheet 4: 'TTHC Cấp Tỉnh' (${provinceItems.length} TTHC)`);
    console.log(`   • Sheet 5: 'TTHC Cấp Xã' (${wardItems.length} TTHC)`);
    console.log(`   • Sheet 6: 'Toàn bộ Cấp Tỉnh & Xã' (${allItems.length} TTHC)`);

    return outputPath;
}

/**
 * Xuất file Excel tổng hợp Toàn bộ TTHC Cổng DVCQG và Báo cáo Biến động
 */
function exportNationalExcel(customOutputPath = null) {
    const outputPath = customOutputPath || EXCEL_NATIONAL_OUTPUT_FILE;
    console.log('\n================================================================');
    console.log('📊 ĐANG XUẤT FILE EXCEL MASTER DATA & BIẾN ĐỘNG TTHC DVCQG (TOÀN QUỐC)...');
    console.log('================================================================');

    // 1. Đọc dữ liệu toàn bộ TTHC từ data/index.json (hoặc snapshot.json)
    let allItems = [];
    if (fs.existsSync(INDEX_NATIONAL_FILE)) {
        try {
            allItems = JSON.parse(fs.readFileSync(INDEX_NATIONAL_FILE, 'utf8'));
        } catch (e) {}
    }
    if ((!Array.isArray(allItems) || allItems.length === 0) && fs.existsSync(SNAPSHOT_NATIONAL_FILE)) {
        try {
            allItems = JSON.parse(fs.readFileSync(SNAPSHOT_NATIONAL_FILE, 'utf8'));
        } catch (e) {}
    }

    if (!Array.isArray(allItems) || allItems.length === 0) {
        console.error('❌ Không có dữ liệu TTHC toàn quốc trong data/index.json để xuất Excel!');
        return null;
    }

    // Chuẩn hóa nhom_thu_tuc và is_noi_bo cho toàn bộ danh mục
    allItems = allItems.map(item => {
        const fType = item.loai_tthc || item.formalityType || 'STANDARD';
        const name = item.ten_tthc || item.name || '';
        const isInternal = typeof item.is_noi_bo === 'boolean'
            ? item.is_noi_bo
            : isInternalProcedure(fType, item.formalityType, name);
        const group = item.nhom_thu_tuc || getProcedureGroup(fType, item.formalityType, name);
        return {
            ...item,
            nhom_thu_tuc: group,
            is_noi_bo: isInternal
        };
    });

    // 2. Đọc dữ liệu biến động từ data/compare_report.json
    let reportData = null;
    if (fs.existsSync(REPORT_NATIONAL_FILE)) {
        try {
            reportData = JSON.parse(fs.readFileSync(REPORT_NATIONAL_FILE, 'utf8'));
        } catch (e) {}
    }

    const summary = reportData?.summary || {};
    const addedList = reportData?.added || reportData?.added_items || [];
    const removedList = reportData?.removed || reportData?.removed_items || [];
    const modifiedList = reportData?.modified || reportData?.modified_items || [];

    const nowStr = formatVietnamTime();

    // 3. Phân loại theo nhóm và theo cấp thực hiện
    const adminItems = allItems.filter(x => !x.is_noi_bo);
    const internalItems = allItems.filter(x => x.is_noi_bo);

    const ministryItems = allItems.filter(x => (x.cap_thuc_hien || '').includes('Cấp Bộ'));
    const provinceItems = allItems.filter(x => (x.cap_thuc_hien || '').includes('Cấp tỉnh'));
    const wardItems = allItems.filter(x => (x.cap_thuc_hien || '').includes('Cấp xã'));
    const otherAgencyItems = allItems.filter(x => (x.cap_thuc_hien || '').includes('Cơ quan khác'));

    const standardItems = allItems.filter(x => (x.loai_tthc || '').toLowerCase().includes('tiêu chuẩn'));
    const specificItems = allItems.filter(x => (x.loai_tthc || '').toLowerCase().includes('đặc thù'));

    // Tạo Workbook mới
    const wb = XLSX.utils.book_new();

    // -------------------------------------------------------------
    // SHEET 1: Tổng hợp & Biến động DVCQG
    // -------------------------------------------------------------
    const s1Rows = [
        ['BÁO CÁO TỔNG HỢP VÀ THEO DÕI BIẾN ĐỘNG THỦ TỤC HÀNH CHÍNH QUỐC GIA (DVCQG)'],
        [`Thời gian xuất báo cáo: ${nowStr} (Giờ Việt Nam)`],
        [`Nguồn dữ liệu: Cổng Dịch vụ công Quốc gia (dichvucong.gov.vn)`],
        [`Kỳ so sánh: Đối soát so với Snapshot kỳ trước`],
        [],
        ['I. THỐNG KÊ TỔNG QUAN DANH MỤC TTHC TOÀN QUỐC'],
        ['Chỉ số thống kê', 'Số lượng TTHC', 'Tỷ lệ %', 'Ghi chú'],
        ['Tổng số TTHC công bố trên Cổng DVCQG:', allItems.length, '100%', 'Master Data toàn quốc'],
        ['  1. Phân loại theo Nhóm thủ tục:'],
        ['     • Thủ tục hành chính (phục vụ người dân, doanh nghiệp):', adminItems.length, `${((adminItems.length / allItems.length) * 100).toFixed(1)}%`, 'Thủ tục tiêu chuẩn, đặc thù, liên thông...'],
        ['     • Thủ tục nội bộ (giữa các cơ quan hành chính nhà nước):', internalItems.length, `${((internalItems.length / allItems.length) * 100).toFixed(1)}%`, 'Thủ tục nội bộ các cấp'],
        ['  2. Phân loại theo Thẩm quyền giải quyết:'],
        ['     • TTHC Thẩm quyền Cấp Trung ương (Cấp Bộ):', ministryItems.length, `${((ministryItems.length / allItems.length) * 100).toFixed(1)}%`, 'Các Bộ, cơ quan ngang Bộ'],
        ['     • TTHC Thẩm quyền Cấp Tỉnh:', provinceItems.length, `${((provinceItems.length / allItems.length) * 100).toFixed(1)}%`, 'UBND cấp tỉnh và các Sở/Ban/Ngành'],
        ['     • TTHC Thẩm quyền Cấp Xã:', wardItems.length, `${((wardItems.length / allItems.length) * 100).toFixed(1)}%`, 'UBND cấp xã, phường, thị trấn'],
        ['     • TTHC Thẩm quyền Cơ quan khác:', otherAgencyItems.length, `${((otherAgencyItems.length / allItems.length) * 100).toFixed(1)}%`, 'Doanh nghiệp, đơn vị sự nghiệp, ngành dọc...'],
        [],
        ['II. THỐNG KÊ BIẾN ĐỘNG TOÀN QUỐC SO VỚI KỲ TRƯỚC'],
        ['Chỉ số biến động', 'Số lượng', 'Đánh giá'],
        ['Tổng số TTHC kỳ trước:', summary.previous_total ?? 'Chưa có', ''],
        ['Tổng số TTHC hiện tại:', summary.current_total ?? allItems.length, ''],
        ['Biến động ròng (Net Change):', (summary.net_change >= 0 ? `+${summary.net_change}` : summary.net_change) ?? '0', summary.net_change > 0 ? 'Tăng' : (summary.net_change < 0 ? 'Giảm' : 'Không đổi')],
        ['  - Số TTHC Mới ban hành / Thêm mới (+):', addedList.length, `TTHC: +${summary.administrative?.added_count ?? 0} | Nội bộ: +${summary.internal?.added_count ?? 0}`],
        ['  - Số TTHC Bãi bỏ / Hết hiệu lực (-):', removedList.length, `TTHC: -${summary.administrative?.removed_count ?? 0} | Nội bộ: -${summary.internal?.removed_count ?? 0}`],
        ['  - Số TTHC Điều chỉnh thông tin (~):', modifiedList.length, modifiedList.length > 0 ? 'Có TTHC sửa đổi' : 'Không có'],
        [],
        ['III. DANH SÁCH CHI TIẾT TTHC BIẾN ĐỘNG TOÀN QUỐC (TĂNG / GIẢM / ĐIỀU CHỈNH)'],
        [
            'STT',
            'Loại biến động',
            'Nhóm thủ tục',
            'Mã TTHC',
            'Tên Thủ tục Hành chính',
            'Cấp thực hiện',
            'Loại TTHC',
            'Lĩnh vực',
            'Cơ quan thực hiện',
            'Chi tiết thay đổi / Ghi chú',
            'Đường dẫn tra cứu DVCQG'
        ]
    ];

    let vIndex = 1;
    // Thêm mới
    addedList.forEach(item => {
        const itemUrl = item.url || (item.id ? `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${item.id}` : `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.code || item.ma_tthc}`);
        const group = item.nhom_thu_tuc || getProcedureGroup(item.loai_tthc || item.formalityType, item.formalityType, item.ten_tthc || item.name);
        s1Rows.push([
            vIndex++,
            'Mới thêm (+)',
            group,
            item.code || item.ma_tthc || '',
            item.name || item.ten_tthc || '',
            item.cap_thuc_hien || '',
            item.loai_tthc || '',
            formatCategory(item.category || item.linh_vuc),
            item.agency || item.co_quan_thuc_hien || '',
            'Thủ tục mới được bổ sung/ban hành trong kỳ này',
            itemUrl
        ]);
    });

    // Bãi bỏ
    removedList.forEach(item => {
        const itemUrl = item.url || (item.id ? `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${item.id}` : `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.code || item.ma_tthc}`);
        const group = item.nhom_thu_tuc || getProcedureGroup(item.loai_tthc || item.formalityType, item.formalityType, item.ten_tthc || item.name);
        s1Rows.push([
            vIndex++,
            'Bãi bỏ (-)',
            group,
            item.code || item.ma_tthc || '',
            item.name || item.ten_tthc || '',
            item.cap_thuc_hien || '',
            item.loai_tthc || '',
            formatCategory(item.category || item.linh_vuc),
            item.agency || item.co_quan_thuc_hien || '',
            'Thủ tục đã bị bãi bỏ hoặc loại khỏi danh mục',
            itemUrl
        ]);
    });

    // Thay đổi
    modifiedList.forEach(item => {
        const itemUrl = item.url || (item.id ? `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${item.id}` : `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.code || item.ma_tthc}`);
        const group = item.nhom_thu_tuc || getProcedureGroup(item.loai_tthc || item.formalityType, item.formalityType, item.ten_tthc || item.name);
        const changeDesc = [];
        if (Array.isArray(item.changes)) {
            item.changes.forEach(c => changeDesc.push(`${c.field}: "${c.old}" ➔ "${c.new}"`));
        } else {
            if (item.old_name && item.old_name !== item.new_name) changeDesc.push(`Đổi tên: "${item.old_name}" -> "${item.new_name}"`);
            if (item.old_level && item.new_level && item.old_level !== item.new_level) changeDesc.push(`Đổi cấp: ${item.old_level} -> ${item.new_level}`);
        }

        s1Rows.push([
            vIndex++,
            'Thay đổi (~)',
            group,
            item.code || item.ma_tthc || '',
            item.new_name || item.name || item.ten_tthc || '',
            item.cap_thuc_hien || '',
            item.loai_tthc || '',
            formatCategory(item.category || item.linh_vuc),
            item.agency || item.co_quan_thuc_hien || '',
            changeDesc.join(' | ') || 'Cập nhật nội dung',
            itemUrl
        ]);
    });

    if (vIndex === 1) {
        s1Rows.push(['', 'Không có biến động', '', '', 'Không có TTHC nào tăng, giảm hoặc thay đổi so với kỳ trước', '', '', '', '', '', '']);
    }

    const ws1 = XLSX.utils.aoa_to_sheet(s1Rows);
    ws1['!cols'] = [
        { wch: 6 },   // STT
        { wch: 16 },  // Loai bien dong
        { wch: 22 },  // Nhom thu tuc
        { wch: 15 },  // Ma TTHC
        { wch: 55 },  // Ten TTHC
        { wch: 22 },  // Cap thuc hien
        { wch: 18 },  // Loai TTHC
        { wch: 25 },  // Linh vuc
        { wch: 35 },  // Co quan thuc hien
        { wch: 40 },  // Chi tiet thay doi
        { wch: 60 }   // Link
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Tổng hợp & Biến động DVCQG');

    // Helper tạo Sheet danh mục TTHC
    function createDatasetSheet(items, sheetTitle) {
        const rows = [
            [sheetTitle.toUpperCase()],
            [`Thời gian xuất: ${nowStr} (Giờ VN) | Tổng số: ${items.length} TTHC`],
            [],
            [
                'STT',
                'Mã TTHC',
                'Tên Thủ tục Hành chính',
                'Nhóm thủ tục',
                'Cấp thực hiện',
                'Loại TTHC',
                'Lĩnh vực',
                'Cơ quan thực hiện',
                'Đường dẫn tra cứu DVCQG'
            ]
        ];

        items.forEach((item, index) => {
            const itemUrl = item.url || (item.id ? `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${item.id}` : `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.ma_tthc || item.code}`);
            rows.push([
                index + 1,
                item.ma_tthc || item.code || '',
                item.ten_tthc || item.name || '',
                item.nhom_thu_tuc || 'Thủ tục hành chính',
                item.cap_thuc_hien || '',
                item.loai_tthc || '',
                formatCategory(item.linh_vuc || item.category),
                item.co_quan_thuc_hien || item.agency || '',
                itemUrl
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [
            { wch: 6 },   // STT
            { wch: 15 },  // Ma TTHC
            { wch: 60 },  // Ten TTHC
            { wch: 22 },  // Nhom thu tuc
            { wch: 22 },  // Cap thuc hien
            { wch: 18 },  // Loai TTHC
            { wch: 25 },  // Linh vuc
            { wch: 35 },  // Co quan thuc hien
            { wch: 60 }   // Link
        ];
        return ws;
    }

    // SHEET 2: Thủ tục hành chính (DVC) phục vụ người dân, doanh nghiệp
    const ws2 = createDatasetSheet(adminItems, 'DANH MỤC THỦ TỤC HÀNH CHÍNH (DVC) TOÀN QUỐC');
    XLSX.utils.book_append_sheet(wb, ws2, 'Thủ tục hành chính (DVC)');

    // SHEET 3: Thủ tục nội bộ
    const ws3 = createDatasetSheet(internalItems, 'DANH MỤC THỦ TỤC NỘI BỘ GIỮA CÁC CƠ QUAN HÀNH CHÍNH (DVCQG)');
    XLSX.utils.book_append_sheet(wb, ws3, 'Thủ tục nội bộ');

    // SHEET 4: Toàn bộ TTHC Quốc gia
    const ws4 = createDatasetSheet(allItems, 'DANH MỤC TOÀN BỘ THỦ TỤC HÀNH CHÍNH & NỘI BỘ QUỐC GIA (DVCQG)');
    XLSX.utils.book_append_sheet(wb, ws4, 'Toàn bộ TTHC Quốc gia');

    // SHEET 5: TTHC Cấp Trung ương (Cấp Bộ)
    const ws5 = createDatasetSheet(ministryItems, 'DANH MỤC TTHC THẨM QUYỀN GIẢI QUYẾT CẤP TRUNG ƯƠNG (CẤP BỘ)');
    XLSX.utils.book_append_sheet(wb, ws5, 'TTHC Cấp Bộ');

    // SHEET 6: TTHC Cấp Tỉnh
    const ws6 = createDatasetSheet(provinceItems, 'DANH MỤC TTHC THẨM QUYỀN GIẢI QUYẾT CẤP TỈNH');
    XLSX.utils.book_append_sheet(wb, ws6, 'TTHC Cấp Tỉnh');

    // SHEET 7: TTHC Cấp Xã
    const ws7 = createDatasetSheet(wardItems, 'DANH MỤC TTHC THẨM QUYỀN GIẢI QUYẾT CẤP XÃ');
    XLSX.utils.book_append_sheet(wb, ws7, 'TTHC Cấp Xã');

    // Ghi file ra đĩa
    XLSX.writeFile(wb, outputPath);
    console.log(`✅ Xuất thành công file Excel Báo cáo DVCQG tại: ${outputPath}`);
    console.log(`   • Sheet 1: 'Tổng hợp & Biến động DVCQG' (${s1Rows.length - 28} dòng biến động)`);
    console.log(`   • Sheet 2: 'Thủ tục hành chính (DVC)' (${adminItems.length} TTHC)`);
    console.log(`   • Sheet 3: 'Thủ tục nội bộ' (${internalItems.length} TTHC)`);
    console.log(`   • Sheet 4: 'Toàn bộ TTHC Quốc gia' (${allItems.length} TTHC)`);
    console.log(`   • Sheet 5: 'TTHC Cấp Bộ' (${ministryItems.length} TTHC)`);
    console.log(`   • Sheet 6: 'TTHC Cấp Tỉnh' (${provinceItems.length} TTHC)`);
    console.log(`   • Sheet 7: 'TTHC Cấp Xã' (${wardItems.length} TTHC)`);

    return outputPath;
}

/**
 * Xuất đồng thời cả 2 Báo cáo Excel: Gia Lai & DVCQG Toàn quốc
 */
function exportAllExcel() {
    const glPath = exportTTHCExcel();
    const nationalPath = exportNationalExcel();
    return { glPath, nationalPath };
}

// Chạy trực tiếp từ dòng lệnh
if (require.main === module) {
    const arg = (process.argv[2] || '').toLowerCase();
    if (arg === '--national' || arg === '--dvcqg') {
        exportNationalExcel();
    } else if (arg === '--gl' || arg === '--gia-lai') {
        exportTTHCExcel();
    } else {
        // Mặc định xuất cả 2 báo cáo Excel
        exportAllExcel();
    }
}

module.exports = {
    exportTTHCExcel,
    exportNationalExcel,
    exportAllExcel,
    EXCEL_OUTPUT_FILE,
    EXCEL_NATIONAL_OUTPUT_FILE
};
