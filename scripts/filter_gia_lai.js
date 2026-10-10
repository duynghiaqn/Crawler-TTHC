/**
 * Bộ lọc chuẩn dành riêng cho Thủ tục Hành chính (TTHC) tỉnh Gia Lai
 * Quy tắc:
 * 1. Cấp thực hiện: Chỉ giữ TTHC có cấp thực hiện là Cấp Tỉnh hoặc Cấp Xã (hoặc cả 2 cấp).
 * 2. Phạm vi địa phương: Giữ TTHC chuẩn quốc gia do Trung ương quy định áp dụng toàn quốc 
 *    hoặc TTHC do UBND tỉnh Gia Lai ban hành (Mã H21 hoặc có tên 'Gia Lai').
 *    Loại trừ TTHC đặc thù / quy định địa phương của các tỉnh, thành phố khác.
 * 3. Loại trừ ngành dọc: Trừ các thủ tục có cơ quan thực hiện / ban hành thuộc:
 *    - Thuế (Cục Thuế, Chi cục Thuế, Tổng cục Thuế, cơ quan thuế...)
 *    - Ngân hàng (Ngân hàng Nhà nước, Chi nhánh NHNN, Ngân hàng Chính sách xã hội...)
 *    - Tòa án (Tòa án nhân dân các cấp...)
 *    - Hải quan (Cục Hải quan, Chi cục Hải quan, Tổng cục Hải quan...)
 *    - Công an (Bộ Công an, Công an tỉnh, Công an cấp xã, Phòng Cảnh sát, Quản lý XNC, PCCC...)
 */

function normalizeText(str) {
    if (!str) return '';
    return String(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Kiểm tra xem TTHC có thuộc thẩm quyền ban hành/đặc thù của tỉnh thành khác hay không
 */
function isOtherProvince(detail) {
    const deptCode = detail.departmentPromulgateCode || detail.departmentCode || detail.departmentPromulgateId || '';
    const deptName = detail.departmentPromulgateName || detail.departmentPromulgate || detail.executingAgencies || detail.departmentsExecuting || '';
    const isGiaLai = deptCode === 'H21' || normalizeText(deptName).includes('gia lai');

    // Nếu là của Gia Lai thì không phải tỉnh khác
    if (isGiaLai) return false;

    const promName = String(detail.departmentPromulgateName || detail.departmentPromulgate || '');
    const promNorm = normalizeText(promName);

    // Kiểm tra cơ quan ban hành có phải là chính quyền địa phương tỉnh/thành khác
    if (
        promNorm.startsWith('ubnd ') ||
        promNorm.includes('tinh ') ||
        promNorm.includes('thanh pho ') ||
        promNorm.startsWith('so ') ||
        promNorm.includes('trung tam phuc vu hanh chinh cong')
    ) {
        return true;
    }

    // Kiểm tra hình thức quy định đặc thù địa phương
    const type = detail.type || '';
    const formalityType = detail.formalityType || '';
    if (type === 'SPECIFIC' || type === 'LOCAL_REGULATION' || formalityType === 'SPECIFIC' || formalityType === 'LOCAL_REGULATION') {
        return true;
    }

    return false;
}

/**
 * Kiểm tra lý do loại trừ ngành dọc (Thuế, Ngân hàng, Tòa án, Hải quan, Công an)
 * @returns {string|null} Trả về tên nhóm loại trừ hoặc null nếu hợp lệ
 */
function checkExclusionReason(detail) {
    // 1. Kiểm tra cấp thực hiện: phải có Cấp tỉnh hoặc Cấp xã
    const isProvince = Boolean(detail.isProvince || detail.type === 'PROVINCE');
    const isWard = Boolean(detail.isWard || detail.type === 'WARD');
    if (!isProvince && !isWard) {
        return 'CẤP_KHÁC';
    }

    // 2. Kiểm tra tỉnh khác
    if (isOtherProvince(detail)) {
        return 'TỈNH_KHÁC';
    }

    // 3. Chuẩn bị chuỗi tìm kiếm cơ quan thực hiện & ban hành
    const agencyFields = [
        detail.executingAgencies,
        detail.departmentsExecuting,
        detail.agency,
        detail.co_quan_thuc_hien
    ].filter(Boolean).join(' | ');

    const prom = detail.departmentPromulgateName || detail.departmentPromulgate || '';
    const combinedRaw = (agencyFields + ' | ' + prom).toLowerCase();
    const combinedNorm = normalizeText(combinedRaw);

    // - Thuế
    if (
        combinedRaw.includes('thuế') ||
        combinedNorm.includes('cuc thue') ||
        combinedNorm.includes('chi cuc thue') ||
        combinedNorm.includes('tong cuc thue') ||
        combinedNorm.includes('co quan thue')
    ) {
        return 'THUẾ';
    }

    // - Ngân hàng
    if (combinedRaw.includes('ngân hàng') || combinedNorm.includes('ngan hang')) {
        return 'NGÂN HÀNG';
    }

    // - Tòa án (toàn án)
    if (
        combinedRaw.includes('tòa án') ||
        combinedRaw.includes('toà án') ||
        combinedNorm.includes('toa an') ||
        combinedNorm.includes('toan an')
    ) {
        return 'TÒA ÁN';
    }

    // - Hải quan
    if (combinedRaw.includes('hải quan') || combinedNorm.includes('hai quan')) {
        return 'HẢI QUAN';
    }

    // - Công an
    if (
        combinedRaw.includes('công an') || combinedNorm.includes('cong an') ||
        combinedRaw.includes('cảnh sát') || combinedNorm.includes('canh sat') ||
        combinedRaw.includes('xuất nhập cảnh') || combinedNorm.includes('xuat nhap canh') ||
        combinedRaw.includes('an ninh điều tra') || combinedNorm.includes('an ninh dieu tra') ||
        combinedRaw.includes('pccc') || combinedNorm.includes('phong chay chua chay') ||
        prom.toLowerCase().includes('bộ công an')
    ) {
        return 'CÔNG AN';
    }

    // - Cục, Vụ (Cơ quan thực hiện là Cục, Vụ thuộc Bộ/ngành Trung ương)
    // Lưu ý: Không loại trừ các cơ quan địa phương như Sở Nội vụ, Sở Ngoại vụ, Chi cục thuộc Sở, v.v.
    const withoutChiCuc = agencyFields.replace(/chi\s+cục/gi, '');
    const hasCuc = /(?:^|[\s,;\/\(\)\.-])cục(?:\s+|$)/i.test(withoutChiCuc) || /tổng\s+cục/i.test(agencyFields);

    const withoutSafeWords = agencyFields
        .replace(/[a-zà-ỹ]*nội\s+vụ/gi, '')
        .replace(/[a-zà-ỹ]*ngoại\s+vụ/gi, '')
        .replace(/[a-zà-ỹ]*dịch\s+vụ/gi, '')
        .replace(/[a-zà-ỹ]*công\s+vụ/gi, '')
        .replace(/[a-zà-ỹ]*nghĩa\s+vụ/gi, '')
        .replace(/[a-zà-ỹ]*phục\s+vụ/gi, '')
        .replace(/[a-zà-ỹ]*nhiệm\s+vụ/gi, '');

    const hasVu = /(?:^|[\s,;\/\(\)\.-])vụ(?:\s+|$)/i.test(withoutSafeWords) || /cảng\s+vụ/i.test(agencyFields);

    if (hasCuc || hasVu) {
        return 'CỤC_VỤ';
    }

    return null;
}

/**
 * Kiểm tra TTHC có đủ điều kiện áp dụng cho tỉnh Gia Lai hay không
 */
function isEligibleGiaLai(detail) {
    return checkExclusionReason(detail) === null;
}

/**
 * Lấy nhãn hiển thị cấp thực hiện
 */
function getLevelLabel(item) {
    const isProvince = Boolean(item.isProvince || item.type === 'PROVINCE');
    const isWard = Boolean(item.isWard || item.type === 'WARD');

    if (isProvince && isWard) return 'Cả Cấp tỉnh & Cấp xã';
    if (isProvince) return 'Cấp tỉnh';
    if (isWard) return 'Cấp xã';
    return item.level_label || 'Chưa xác định';
}

function parseFormalityType(type) {
    if (type === 'ASSIGNED_REGULATION') return 'TTHC được luật giao quy định chi tiết';
    if (type === 'SPECIFIC') return 'TTHC Đặc thù';
    if (type === 'STANDARD') return 'TTHC Tiêu chuẩn';
    if (type === 'INTERCONNECTED') return 'TTHC liên thông';
    if (type === 'STANDARD_INTERNAL') return 'TTHC nội bộ';
    if (type === 'INTERCONNECTED_INTERNAL') return 'TTHC nội bộ liên thông';
    if (type === 'LOCAL_REGULATION') return 'Quy định địa phương';
    if (type === 'CENTRAL_REGULATION') return 'Quy định trung ương';
    return type || 'Không xác định';
}

function parseFormalityCaseLevel(detail) {
    let arr = [];
    if (detail.isWard) arr.push('Cấp xã');
    if (detail.isProvince) arr.push('Cấp tỉnh');
    if (detail.isMinistry) arr.push('Cấp Bộ');
    if (detail.isOtherAgency) arr.push('Cơ quan khác');
    return arr.length > 0 ? arr.join(', ') : 'Chưa xác định';
}

module.exports = {
    normalizeText,
    isOtherProvince,
    checkExclusionReason,
    isEligibleGiaLai,
    getLevelLabel,
    parseFormalityType,
    parseFormalityCaseLevel
};
