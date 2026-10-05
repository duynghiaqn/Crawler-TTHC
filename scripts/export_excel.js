const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DATA_DIR = path.join(process.cwd(), 'data');
const SNAPSHOT_PROVINCE_FILE = path.join(DATA_DIR, 'snapshot_province.json');
const REPORT_PROVINCE_FILE = path.join(DATA_DIR, 'compare_province_report.json');
const EXCEL_OUTPUT_FILE = path.join(DATA_DIR, 'Bao_cao_TTHC_Gia_Lai.xlsx');

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

function getLevelLabel(item) {
    if (item.isProvince && item.isWard) return 'Cả Cấp tỉnh & Cấp xã';
    if (item.isProvince) return 'Cấp tỉnh';
    if (item.isWard) return 'Cấp xã';
    return item.level_label || 'Chưa xác định';
}

/**
 * Xuat file Excel tong hop TTHC Cap Tinh, Cap Xa va Bien dong Gia Lai
 */
function exportTTHCExcel(customOutputPath = null) {
    const outputPath = customOutputPath || EXCEL_OUTPUT_FILE;
    console.log('\n================================================================');
    console.log('📊 ĐANG XUẤT FILE EXCEL MASTER DATA & BIẾN ĐỘNG TTHC GIA LAI...');
    console.log('================================================================');

    // 1. Doc du lieu tu snapshot_province.json
    let allItems = [];
    if (fs.existsSync(SNAPSHOT_PROVINCE_FILE)) {
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

    // 2. Doc du lieu bien dong tu compare_province_report.json
    let reportData = null;
    if (fs.existsSync(REPORT_PROVINCE_FILE)) {
        try {
            reportData = JSON.parse(fs.readFileSync(REPORT_PROVINCE_FILE, 'utf8'));
        } catch (e) {
            console.warn('⚠️ Lỗi đọc file compare_province_report.json:', e.message);
        }
    }

    const summary = reportData?.summary || {};
    const addedList = reportData?.added || [];
    const removedList = reportData?.removed || [];
    const modifiedList = reportData?.modified || [];

    const nowStr = formatVietnamTime();

    // 3. Loc danh sach theo cap
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
        ['  - TTHC thẩm quyền giải quyết Cấp Tỉnh (Tổng cộng):', provinceItems.length, `${((provinceItems.length / allItems.length) * 100).toFixed(1)}%`, 'Bao gồm thủ tục chỉ cấp tỉnh và cả 2 cấp'],
        ['      + Chỉ thực hiện tại Cấp Tỉnh:', provinceOnlyItems.length, `${((provinceOnlyItems.length / allItems.length) * 100).toFixed(1)}%`, ''],
        ['      + Thực hiện tại CẢ Cấp Tỉnh & Cấp Xã:', bothItems.length, `${((bothItems.length / allItems.length) * 100).toFixed(1)}%`, 'Thủ tục phân cấp linh hoạt'],
        ['  - TTHC thẩm quyền giải quyết Cấp Xã (Tổng cộng):', wardItems.length, `${((wardItems.length / allItems.length) * 100).toFixed(1)}%`, 'Bao gồm thủ tục chỉ cấp xã và cả 2 cấp'],
        ['      + Chỉ thực hiện tại Cấp Xã:', wardOnlyItems.length, `${((wardOnlyItems.length / allItems.length) * 100).toFixed(1)}%`, ''],
        [],
        ['II. THỐNG KÊ BIẾN ĐỘNG SO VỚI KỲ TRƯỚC'],
        ['Chỉ số biến động', 'Số lượng', 'Đánh giá'],
        ['Tổng số TTHC kỳ trước:', summary.previous_total ?? 'Chưa có', ''],
        ['Tổng số TTHC hiện tại:', summary.current_total ?? allItems.length, ''],
        ['Biến động ròng (Net Change):', (summary.net_change >= 0 ? `+${summary.net_change}` : summary.net_change) ?? '0', summary.net_change > 0 ? 'Tăng' : (summary.net_change < 0 ? 'Giảm' : 'Không đổi')],
        ['  - Số TTHC Mới thêm (+):', addedList.length, addedList.length > 0 ? 'Có TTHC mới ban hành' : 'Không có'],
        ['  - Số TTHC Bãi bỏ / Xóa (-):', removedList.length, removedList.length > 0 ? 'Có TTHC bãi bỏ' : 'Không có'],
        ['  - Số TTHC Điều chỉnh thông tin (~):', modifiedList.length, modifiedList.length > 0 ? 'Có TTHC sửa đổi' : 'Không có'],
        [],
        ['III. DANH SÁCH CHI TIẾT TTHC BIẾN ĐỘNG TẠI TỈNH GIA LAI (TĂNG / GIẢM / ĐIỀU CHỈNH)'],
        [
            'STT',
            'Loại biến động',
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
        s1Rows.push([
            vIndex++,
            'Mới thêm (+)',
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
        s1Rows.push([
            vIndex++,
            'Bãi bỏ (-)',
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
        s1Rows.push(['', 'Không có biến động', '', 'Không có TTHC nào tăng, giảm hoặc thay đổi so với kỳ trước', '', '', '', '', '', '']);
    }

    const ws1 = XLSX.utils.aoa_to_sheet(s1Rows);
    ws1['!cols'] = [
        { wch: 6 },   // STT
        { wch: 15 },  // Loai bien dong
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

    // -------------------------------------------------------------
    // SHEET 2: Danh sách TTHC Cấp Tỉnh (provinceItems)
    // -------------------------------------------------------------
    const s2Rows = [
        ['DANH SÁCH THỦ TỤC HÀNH CHÍNH THẨM QUYỀN GIẢI QUYẾT CẤP TỈNH (GIA LAI)'],
        [`Tổng số lượng: ${provinceItems.length} TTHC | Thời gian xuất: ${nowStr}`],
        [],
        [
            'STT',
            'Mã TTHC',
            'Tên Thủ tục Hành chính',
            'Phân cấp chi tiết',
            'Lĩnh vực',
            'Cơ quan ban hành',
            'Cơ quan thực hiện',
            'Hình thức quy định',
            'Đường dẫn tra cứu DVCQG'
        ]
    ];

    provinceItems.forEach((item, idx) => {
        const detailLevel = (item.isProvince && item.isWard) ? 'Cả Cấp tỉnh & Cấp xã' : 'Chỉ Cấp tỉnh';
        s2Rows.push([
            idx + 1,
            item.code || '',
            item.name || '',
            detailLevel,
            formatCategory(item.category),
            item.departmentPromulgate || '',
            item.executingAgencies || item.agency || '',
            item.formalityType || 'STANDARD',
            item.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.code}`
        ]);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(s2Rows);
    ws2['!cols'] = [
        { wch: 6 },   // STT
        { wch: 15 },  // Ma TTHC
        { wch: 55 },  // Ten TTHC
        { wch: 24 },  // Phan cap chi tiet
        { wch: 25 },  // Linh vuc
        { wch: 28 },  // Co quan ban hanh
        { wch: 30 },  // Co quan thuc hien
        { wch: 20 },  // Hinh thuc
        { wch: 55 }   // Link
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'TTHC Cấp Tỉnh');

    // -------------------------------------------------------------
    // SHEET 3: Danh sách TTHC Cấp Xã (wardItems)
    // -------------------------------------------------------------
    const s3Rows = [
        ['DANH SÁCH THỦ TỤC HÀNH CHÍNH THẨM QUYỀN GIẢI QUYẾT CẤP XÃ (GIA LAI)'],
        [`Tổng số lượng: ${wardItems.length} TTHC | Thời gian xuất: ${nowStr}`],
        [],
        [
            'STT',
            'Mã TTHC',
            'Tên Thủ tục Hành chính',
            'Phân cấp chi tiết',
            'Lĩnh vực',
            'Cơ quan ban hành',
            'Cơ quan thực hiện',
            'Hình thức quy định',
            'Đường dẫn tra cứu DVCQG'
        ]
    ];

    wardItems.forEach((item, idx) => {
        const detailLevel = (item.isProvince && item.isWard) ? 'Cả Cấp tỉnh & Cấp xã' : 'Chỉ Cấp xã';
        s3Rows.push([
            idx + 1,
            item.code || '',
            item.name || '',
            detailLevel,
            formatCategory(item.category),
            item.departmentPromulgate || '',
            item.executingAgencies || item.agency || '',
            item.formalityType || 'STANDARD',
            item.url || `https://dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc.html?ma_thu_tuc=${item.code}`
        ]);
    });

    const ws3 = XLSX.utils.aoa_to_sheet(s3Rows);
    ws3['!cols'] = [
        { wch: 6 },   // STT
        { wch: 15 },  // Ma TTHC
        { wch: 55 },  // Ten TTHC
        { wch: 24 },  // Phan cap chi tiet
        { wch: 25 },  // Linh vuc
        { wch: 28 },  // Co quan ban hanh
        { wch: 30 },  // Co quan thuc hien
        { wch: 20 },  // Hinh thuc
        { wch: 55 }   // Link
    ];
    XLSX.utils.book_append_sheet(wb, ws3, 'TTHC Cấp Xã');

    // -------------------------------------------------------------
    // SHEET 4: Toàn bộ Cấp Tỉnh & Cấp Xã (allItems)
    // -------------------------------------------------------------
    const s4Rows = [
        ['TOÀN BỘ DANH MỤC THỦ TỤC HÀNH CHÍNH CẤP TỈNH & CẤP XÃ ÁP DỤNG TẠI GIA LAI'],
        [`Tổng số lượng: ${allItems.length} TTHC | Thời gian xuất: ${nowStr}`],
        [],
        [
            'STT',
            'Mã TTHC',
            'Tên Thủ tục Hành chính',
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
        s4Rows.push([
            idx + 1,
            item.code || '',
            item.name || '',
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

    const ws4 = XLSX.utils.aoa_to_sheet(s4Rows);
    ws4['!cols'] = [
        { wch: 6 },   // STT
        { wch: 15 },  // Ma TTHC
        { wch: 55 },  // Ten TTHC
        { wch: 24 },  // Phan cap thuc hien
        { wch: 10 },  // Cap Tinh
        { wch: 10 },  // Cap Xa
        { wch: 25 },  // Linh vuc
        { wch: 28 },  // Co quan ban hanh
        { wch: 30 },  // Co quan thuc hien
        { wch: 20 },  // Hinh thuc
        { wch: 55 }   // Link
    ];
    XLSX.utils.book_append_sheet(wb, ws4, 'Toàn bộ Cấp Tỉnh & Xã');

    // 4. Ghi file ra dia
    XLSX.writeFile(wb, outputPath);
    console.log(`✅ Xuất thành công file Excel tại: ${outputPath}`);
    console.log(`   • Sheet 1: 'Tổng hợp & Biến động' (${s1Rows.length - 25} dòng biến động)`);
    console.log(`   • Sheet 2: 'TTHC Cấp Tỉnh' (${provinceItems.length} TTHC)`);
    console.log(`   • Sheet 3: 'TTHC Cấp Xã' (${wardItems.length} TTHC)`);
    console.log(`   • Sheet 4: 'Toàn bộ Cấp Tỉnh & Xã' (${allItems.length} TTHC)`);

    return outputPath;
}

// Chay truc tiep tu command line
if (require.main === module) {
    const customPath = process.argv[2] || null;
    exportTTHCExcel(customPath);
}

module.exports = {
    exportTTHCExcel,
    EXCEL_OUTPUT_FILE
};
