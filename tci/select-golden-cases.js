const fs = require('fs');
const path = require('path');

const DATA_TCI = path.join(process.cwd(), 'data', 'tci-results');
const LOCAL_TCI = path.join(process.cwd(), 'tci-results');

const OUT_DIR = fs.existsSync(DATA_TCI) ? DATA_TCI : LOCAL_TCI;
const CALIBRATION_FILE = path.join(OUT_DIR, 'tci-calibration-selection.json');

function runGoldenSelection() {
  let samples = [];
  if (fs.existsSync(CALIBRATION_FILE)) {
    const data = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
    samples = data.samples || [];
  } else {
    console.log(`⚠️ Chưa tìm thấy ${CALIBRATION_FILE}, vui lòng chạy select-tci-calibration.js trước.`);
  }

  // Chọn ra danh sách Golden Cases tiêu biểu phủ rộng các mức độ phức tạp
  const goldenCases = samples.slice(0, 15).map((s, idx) => ({
    goldenId: `GOLDEN_${String(idx + 1).padStart(2, '0')}`,
    id: s.id,
    code: s.code,
    name: s.name,
    category: s.category,
    tier: idx < 3 ? 'VERY_SIMPLE' : idx > 11 ? 'VERY_COMPLEX' : 'MODERATE',
    reasons: s.reasons,
    features: s.features
  }));

  const result = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalGoldenCases: goldenCases.length,
      note: 'Selected Golden Test Cases for TCI Evaluation Benchmark'
    },
    goldenCases
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'tci-golden-cases.json'), JSON.stringify(result, null, 2));

  let md = '# TCI – Golden Cases Benchmark Report\n\n';
  md += `Tổng số Golden Cases được chọn: **${goldenCases.length}**\n\n`;
  for (const g of goldenCases) {
    md += `### ${g.goldenId}: ${g.code} — ${g.name}\n`;
    md += `- **Phân loại (Tier)**: ${g.tier}\n`;
    md += `- **Bước**: ${g.features?.steps || 0} | **Hồ sơ**: ${g.features?.profileComponents || 0} | **Phương thức**: ${g.features?.methods || 0}\n`;
    md += `- **Lý do chọn**: ${g.reasons?.join(', ') || 'N/A'}\n\n`;
  }
  fs.writeFileSync(path.join(OUT_DIR, 'tci-golden-cases-summary.md'), md);
  console.log(`✅ Đã chọn ${goldenCases.length} Golden Cases tại ${OUT_DIR}`);
}

runGoldenSelection();
