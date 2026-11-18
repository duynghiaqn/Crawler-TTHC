const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { loadAllFromIndexOrParts } = require('../qdcb_crawler');

const QDCB_DIR = path.join(process.cwd(), 'qdcb');
const DETAILS_DIR = path.join(QDCB_DIR, 'details');
const INDEX_FILE = path.join(QDCB_DIR, 'index.json');
const MONTHLY_NEW_FILE = path.join(QDCB_DIR, 'monthly_new.json');
const COMPARE_REPORT_FILE = path.join(QDCB_DIR, 'compare_report.json');
const VERSION_FILE = path.join(QDCB_DIR, 'version.json');
const EXCEL_OUTPUT_FILE = path.join(QDCB_DIR, 'Bao_cao_QDCB_DVCQG.xlsx');

function formatVietnamTime(date = new Date()) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function getDetailCounts(id) {
  if (!id) return { created: 0, updated: 0, inactive: 0 };
  const p = path.join(DETAILS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return { created: 0, updated: 0, inactive: 0 };
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const t = d.tthc_kem_theo || {};
    return {
      created: t.cong_khai_moi?.count || 0,
      updated: t.sua_doi_bo_sung?.count || 0,
      inactive: t.bai_bo?.count || 0,
    };
  } catch (e) {
    return { created: 0, updated: 0, inactive: 0 };
  }
}

function formatAttachments(files) {
  if (!Array.isArray(files) || files.length === 0) return '';
  return files.map((f) => f.fileName || f.fileId).filter(Boolean).join('; ');
}

function buildProposalRows(items) {
  return items.map((r, idx) => {
    const counts = getDetailCounts(r.id);
    return [
      idx + 1,
      r.so_quyet_dinh || '',
      r.ngay_quyet_dinh || '',
      r.ngay_cong_bo || '',
      r.co_quan_ban_hanh || '',
      Array.isArray(r.linh_vuc) ? r.linh_vuc.join(', ') : (r.linh_vuc || ''),
      r.trich_yeu || '',
      r.loai_quyet_dinh || '',
      counts.created,
      counts.updated,
      counts.inactive,
      formatAttachments(r.tep_dinh_kem),
      r.url || '',
    ];
  });
}

function exportQdcbExcel(customOutputPath = null) {
  const outputPath = customOutputPath || EXCEL_OUTPUT_FILE;
  console.log('\n================================================================');
  console.log('📊 ĐANG XUẤT FILE EXCEL BÁO CÁO QUYẾT ĐỊNH CÔNG BỐ (QĐCB)...');
  console.log('================================================================');

  const allItems = loadAllFromIndexOrParts();
  if (!allItems || allItems.length === 0) {
    console.error('❌ Không tìm thấy dữ liệu trong qdcb/index.json hoặc qdcb/parts/. Hãy chạy node qdcb_crawler.js trước.');
    return null;
  }
  const monthlyData = fs.existsSync(MONTHLY_NEW_FILE)
    ? JSON.parse(fs.readFileSync(MONTHLY_NEW_FILE, 'utf8'))
    : { month: '', total_monthly_new: 0, by_department: [], items: [] };
  const compareReport = fs.existsSync(COMPARE_REPORT_FILE)
    ? JSON.parse(fs.readFileSync(COMPARE_REPORT_FILE, 'utf8'))
    : { summary: {}, added: [], removed: [], modified: [] };
  const versionData = fs.existsSync(VERSION_FILE)
    ? JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'))
    : {};

  const wb = XLSX.utils.book_new();
  const nowStr = formatVietnamTime();

  // ------------------------------------------------------------------
  // SHEET 1: Tong_quan
  // ------------------------------------------------------------------
  const summaryRows = [
    ['BÁO CÁO TỔNG HỢP QUYẾT ĐỊNH CÔNG BỐ (QĐCB) - CỔNG DVCQG'],
    [`Thời gian xuất báo cáo: ${nowStr} (Giờ Việt Nam)`],
    [],
    ['CHỈ TIÊU THỐNG KÊ', 'GIÁ TRỊ'],
    ['Tổng số Quyết định công bố trên Cổng DVCQG', allItems.length],
    [`Số QĐCB mới bổ sung trong tháng (${monthlyData.month || 'hiện tại'})`, monthlyData.total_monthly_new || 0],
    ['Số cơ quan có QĐCB mới trong tháng', (monthlyData.by_department || []).length],
    ['Biến động lần quét gần nhất - Thêm mới (+)', compareReport.summary?.added_count || 0],
    ['Biến động lần quét gần nhất - Gỡ bỏ (-)', compareReport.summary?.removed_count || 0],
    ['Biến động lần quét gần nhất - Cập nhật (~)', compareReport.summary?.modified_count || 0],
    ['Số tệp chi tiết QĐCB đã đồng bộ (qdcb/details)', versionData.details_summary ? `${versionData.details_summary.cached + versionData.details_summary.fetched}/${versionData.details_summary.total}` : allItems.length],
    [],
    [`THỐNG KÊ QĐCB MỚI TRONG THÁNG ${monthlyData.month || ''} THEO CƠ QUAN BAN HÀNH`, 'SỐ LƯỢNG QĐCB'],
    ...(monthlyData.by_department || []).map((d) => [d.co_quan_ban_hanh, d.count]),
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 58 }, { wch: 24 }];
  wsSummary['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Tong_quan');

  // ------------------------------------------------------------------
  // SHEET 2: QDCB_Moi_Trong_Thang
  // ------------------------------------------------------------------
  const headers = [
    'STT',
    'Số Quyết định',
    'Ngày quyết định',
    'Ngày công bố',
    'Cơ quan ban hành',
    'Lĩnh vực',
    'Trích yếu',
    'Loại QĐ',
    'TTHC Công khai mới',
    'TTHC Sửa đổi/Bổ sung',
    'TTHC Bãi bỏ',
    'Tệp đính kèm',
    'Link DVCQG',
  ];

  const monthlySheetRows = [
    [`DANH SÁCH QUYẾT ĐỊNH CÔNG BỐ MỚI BỔ SUNG TRONG THÁNG ${monthlyData.month || ''}`],
    [`Thời gian xuất: ${nowStr} | Tổng số: ${(monthlyData.items || []).length} quyết định`],
    [],
    headers,
    ...buildProposalRows(monthlyData.items || []),
  ];
  const wsMonthly = XLSX.utils.aoa_to_sheet(monthlySheetRows);
  wsMonthly['!cols'] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
    { wch: 32 },
    { wch: 28 },
    { wch: 60 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 14 },
    { wch: 35 },
    { wch: 52 },
  ];
  wsMonthly['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];
  XLSX.utils.book_append_sheet(wb, wsMonthly, 'QDCB_Moi_Trong_Thang');

  // ------------------------------------------------------------------
  // SHEET 3: Danh_muc_QDCB (Toàn bộ 1974+ QĐCB)
  // ------------------------------------------------------------------
  const allSheetRows = [
    ['DANH MỤC TOÀN BỘ QUYẾT ĐỊNH CÔNG BỐ THỦ TỤC HÀNH CHÍNH - CỔNG DVCQG'],
    [`Thời gian xuất: ${nowStr} | Tổng số: ${allItems.length} quyết định`],
    [],
    headers,
    ...buildProposalRows(allItems),
  ];
  const wsAll = XLSX.utils.aoa_to_sheet(allSheetRows);
  wsAll['!cols'] = wsMonthly['!cols'];
  wsAll['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];
  XLSX.utils.book_append_sheet(wb, wsAll, 'Danh_muc_QDCB');

  // ------------------------------------------------------------------
  // SHEET 4: Bien_dong_QDCB
  // ------------------------------------------------------------------
  const diffHeaders = ['STT', 'Loại biến động', 'Số Quyết định', 'Cơ quan ban hành', 'Ngày quyết định', 'Chi tiết thay đổi / Trích yếu', 'Link DVCQG'];
  const diffItems = [];
  let diffIdx = 1;
  (compareReport.added || []).forEach((r) => {
    diffItems.push([diffIdx++, 'Mới bổ sung (+)', r.so_quyet_dinh || '', r.co_quan_ban_hanh || '', r.ngay_quyet_dinh || '', r.trich_yeu || '', r.url || '']);
  });
  (compareReport.removed || []).forEach((r) => {
    diffItems.push([diffIdx++, 'Đã gỡ bỏ (-)', r.so_quyet_dinh || '', r.co_quan_ban_hanh || '', r.ngay_quyet_dinh || '', r.trich_yeu || '', r.url || '']);
  });
  (compareReport.modified || []).forEach((r) => {
    const desc = (r.changes || []).map((c) => `${c.field}: ${JSON.stringify(c.old)} -> ${JSON.stringify(c.new)}`).join(' | ');
    diffItems.push([diffIdx++, 'Cập nhật (~)', r.so_quyet_dinh || '', r.co_quan_ban_hanh || '', '', desc, r.url || '']);
  });

  const diffSheetRows = [
    ['BÁO CÁO BIẾN ĐỘNG QUYẾT ĐỊNH CÔNG BỐ KỲ QUÉT GẦN NHẤT'],
    [`Thời gian đối chiếu: ${compareReport.compared_at || nowStr}`],
    [],
    diffHeaders,
    ...(diffItems.length > 0 ? diffItems : [['', 'Không có biến động tăng/giảm/sửa đổi trong lần quét gần nhất', '', '', '', '', '']]),
  ];
  const wsDiff = XLSX.utils.aoa_to_sheet(diffSheetRows);
  wsDiff['!cols'] = [
    { wch: 6 },
    { wch: 18 },
    { wch: 20 },
    { wch: 30 },
    { wch: 15 },
    { wch: 60 },
    { wch: 52 },
  ];
  wsDiff['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: diffHeaders.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: diffHeaders.length - 1 } },
  ];
  XLSX.utils.book_append_sheet(wb, wsDiff, 'Bien_dong_QDCB');

  XLSX.writeFile(wb, outputPath);
  console.log(`✅ Đã xuất báo cáo Excel QĐCB thành công: ${outputPath}`);
  return outputPath;
}

if (require.main === module) {
  exportQdcbExcel();
}

module.exports = { exportQdcbExcel };
