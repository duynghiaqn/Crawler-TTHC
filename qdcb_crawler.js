const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://dichvucong.gov.vn/api/v1/configuring/procedure-proposal/list-procedure-proposal-by-citizen';
const DETAIL_URL = 'https://dichvucong.gov.vn/api/v1/configuring/procedure-proposal/get-procedure-proposal-by-citizen';
const FORMALITY_URL = 'https://dichvucong.gov.vn/api/v1/configuring/procedure-proposal/list-procedure-proposal-formality-by-citizen';
const QDCB_DIR = path.join(process.cwd(), 'qdcb');
const PARTS_DIR = path.join(QDCB_DIR, 'parts');
const DETAILS_DIR = path.join(QDCB_DIR, 'details');
const MONTHLY_DIR = path.join(QDCB_DIR, 'monthly');
const INDEX_FILE = path.join(QDCB_DIR, 'index.json');
const SNAPSHOT_FILE = path.join(QDCB_DIR, 'snapshot.json');
const VERSION_FILE = path.join(QDCB_DIR, 'version.json');
const COMPARE_REPORT_FILE = path.join(QDCB_DIR, 'compare_report.json');
const MONTHLY_NEW_FILE = path.join(QDCB_DIR, 'monthly_new.json');

const DETAILS_CONCURRENCY = 5;
const PART_TARGET_BYTES = 10 * 1024 * 1024; // Mỗi part từ ~10 MB

function loadAllFromIndexOrParts() {
  if (!fs.existsSync(INDEX_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw && raw.schema === 'qdcb-sharded-index-v2' && Array.isArray(raw.parts)) {
      const all = [];
      for (const p of raw.parts) {
        const partPath = path.join(QDCB_DIR, p.file);
        if (fs.existsSync(partPath)) {
          const partItems = JSON.parse(fs.readFileSync(partPath, 'utf8'));
          if (Array.isArray(partItems)) all.push(...partItems);
        }
      }
      return all;
    }
  } catch (e) {
    console.warn('⚠️ Lỗi đọc index/parts:', e.message);
  }
  return [];
}

function writeShardedIndex(currentItems) {
  if (!fs.existsSync(QDCB_DIR)) fs.mkdirSync(QDCB_DIR, { recursive: true });
  if (!fs.existsSync(PARTS_DIR)) fs.mkdirSync(PARTS_DIR, { recursive: true });

  // Chia part thông minh theo ngưỡng dung lượng ~10 MB/part (tránh chia quá nhỏ)
  const chunks = [];
  let currentChunk = [];
  let currentBytes = 2; // "[]"

  for (const item of currentItems) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item, null, 2), 'utf8') + 4;
    if (currentChunk.length > 0 && currentBytes >= PART_TARGET_BYTES) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentBytes = 2;
    }
    currentChunk.push(item);
    currentBytes += itemBytes;
  }
  if (currentChunk.length > 0 || chunks.length === 0) {
    chunks.push(currentChunk);
  }

  const totalParts = chunks.length;
  const partsMeta = [];
  const lookup = {};

  for (let i = 0; i < totalParts; i++) {
    const partNum = i + 1;
    const fileName = `part_${String(partNum).padStart(3, '0')}.json`;
    const relPath = `parts/${fileName}`;
    const fullPath = path.join(PARTS_DIR, fileName);
    const chunk = chunks[i];
    const chunkStr = JSON.stringify(chunk, null, 2);

    fs.writeFileSync(fullPath, chunkStr, 'utf8');

    const dates = chunk.map((x) => x.ngay_cong_bo || x.ngay_quyet_dinh).filter(Boolean).sort();
    partsMeta.push({
      part: partNum,
      file: relPath,
      count: chunk.length,
      size_bytes: Buffer.byteLength(chunkStr, 'utf8'),
      date_from: dates[0] || '',
      date_to: dates[dates.length - 1] || '',
      first_id: chunk[0]?.id || '',
      last_id: chunk[chunk.length - 1]?.id || '',
    });

    for (const item of chunk) {
      if (item.id) {
        lookup[item.id] = {
          p: partNum,
          so: item.so_quyet_dinh || '',
          d: item.ngay_quyet_dinh || '',
          pub: item.ngay_cong_bo || '',
          cq: item.co_quan_ban_hanh || '',
          u: item.updated_at_ts || null,
        };
      }
    }
  }

  // Dọn dẹp các part dư thừa nếu số lượng bản ghi giảm
  const existingPartFiles = fs.readdirSync(PARTS_DIR).filter((f) => /^part_\d+\.json$/.test(f));
  for (const f of existingPartFiles) {
    const num = parseInt(f.replace(/\D/g, ''), 10);
    if (num > totalParts) {
      fs.unlinkSync(path.join(PARTS_DIR, f));
    }
  }

  const indexManifest = {
    schema: 'qdcb-sharded-index-v2',
    updated_at: new Date().toISOString(),
    total_records: currentItems.length,
    part_target_mb: Math.round(PART_TARGET_BYTES / (1024 * 1024)),
    total_parts: partsMeta.length,
    parts: partsMeta,
    lookup,
  };

  const indexStr = JSON.stringify(indexManifest, null, 2);
  fs.writeFileSync(INDEX_FILE, indexStr, 'utf8');

  return {
    schema: 'qdcb-sharded-index-v2',
    part_target_mb: Math.round(PART_TARGET_BYTES / (1024 * 1024)),
    total_parts: partsMeta.length,
    index_size_kb: Math.round((Buffer.byteLength(indexStr, 'utf8') / 1024) * 10) / 10,
  };
}

const HEADER_PROFILES = [
  {
    name: 'Chrome 126 - Windows 11',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-mobile': '?0',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
  },
  {
    name: 'Chrome 125 - macOS Sonoma',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not?A_Brand";v="24"',
    'sec-ch-ua-platform': '"macOS"',
    'sec-ch-ua-mobile': '?0',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  },
  {
    name: 'Microsoft Edge 125 - Windows 11',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
    'sec-ch-ua': '"Microsoft Edge";v="125", "Chromium";v="125", "Not=A?Brand";v="24"',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-mobile': '?0',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8',
  },
  {
    name: 'Firefox 126 - Windows 11',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'vi-VN,vi;q=0.8,en-US;q=0.5,en;q=0.3',
  },
  {
    name: 'Safari 17.4 - macOS Sonoma',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'vi-VN,vi-VN;q=0.9,en-US;q=0.8,en;q=0.7',
  },
  {
    name: 'Opera 109 - Windows 11',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0',
    'sec-ch-ua': '"Opera";v="109", "Chromium";v="123", "Not:A-Brand";v="8"',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-mobile': '?0',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8',
  },
];

function getRandomHeaders() {
  const profile = HEADER_PROFILES[Math.floor(Math.random() * HEADER_PROFILES.length)];
  const { name, ...headers } = profile;
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    ...headers,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatVnDate(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '';
  // Chuyển sang múi giờ Việt Nam (UTC+7)
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 10);
}

function formatVnMonth(ts) {
  const dateStr = formatVnDate(ts);
  return dateStr ? dateStr.slice(0, 7) : '';
}

function getCurrentVnMonth() {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 7);
}

function normalizeProposalRecord(r) {
  const attachments = [
    ...(Array.isArray(r.decisionAttachmentFiles) ? r.decisionAttachmentFiles : []),
    ...(Array.isArray(r.proposalAttachmentFiles) ? r.proposalAttachmentFiles : []),
  ].map((f) => ({
    fileId: f.fileId || '',
    fileName: f.fileName || '',
  }));

  return {
    id: r.id || '',
    so_quyet_dinh: (r.proposalNumber || '').trim() || 'Không rõ số hiệu',
    trich_yeu: (r.proposalExcerpt || '').trim(),
    ngay_quyet_dinh: formatVnDate(r.decisionDate),
    decision_date_ts: r.decisionDate || null,
    ngay_cong_bo: formatVnDate(r.publicationDate || r.createdAt),
    publication_date_ts: r.publicationDate || null,
    created_at_ts: r.createdAt || null,
    updated_at_ts: r.updatedAt || null,
    co_quan_ban_hanh: (r.department && r.department.name) ? r.department.name.trim() : '',
    ma_co_quan: r.departmentId || (r.department && r.department.id) || '',
    linh_vuc: Array.isArray(r.categories) ? r.categories.map((c) => c.name).filter(Boolean) : [],
    loai_quyet_dinh: r.proposalType || '',
    trang_thai: r.state || '',
    tep_dinh_kem: attachments,
    url: r.id ? `https://dichvucong.gov.vn/quyet-dinh-cong-bo/${r.id}` : 'https://dichvucong.gov.vn/quyet-dinh-cong-bo/',
  };
}

async function fetchProposalPage(lastId = '', limit = 100, retries = 3) {
  const payload = {
    limit,
    lastId,
    search: '',
    departmentCode: '',
    categoryCode: '',
    decisionDate: 0,
    decisionDateFrom: 0,
    decisionDateTo: 0,
    order: '',
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await axios.post(API_URL, payload, {
        headers: getRandomHeaders(),
        timeout: 25000,
      });
      if (resp.data && resp.data.code === 'OK' && resp.data.data) {
        return resp.data.data;
      }
      throw new Error(`API code=${resp.data?.code || 'UNKNOWN'}`);
    } catch (err) {
      if (attempt === retries) throw err;
      const backoff = attempt * 1500 + Math.floor(Math.random() * 500);
      console.warn(`⚠️ Lỗi tải trang (lastId=${lastId || 'START'}, lần ${attempt}/${retries}): ${err.message}. Thử lại sau ${backoff}ms...`);
      await sleep(backoff);
    }
  }
}

async function crawlAllProposals(options = {}) {
  const forceFull = Boolean(options.forceFull);
  console.log('\n==================================================');
  console.log('📜 BẮT ĐẦU QUÉT DANH SÁCH QUYẾT ĐỊNH CÔNG BỐ (QĐCB)');
  console.log('==================================================');

  // Nạp dữ liệu index.json / parts hiện có để hỗ trợ quét thông minh (chỉ tải bổ sung QĐCB mới)
  const existingMap = new Map();
  if (!forceFull) {
    const prev = loadAllFromIndexOrParts();
    prev.forEach((item) => {
      if (item && item.id) existingMap.set(item.id, item);
    });
  }

  let fullScan = forceFull || existingMap.size === 0;
  if (!fullScan) {
    console.log(`⚡ Chế độ Smart Incremental Sync (Đã có ${existingMap.size} QĐCB trong cache)`);
  } else {
    console.log('🌐 Chế độ Quét toàn bộ danh sách QĐCB (Full Scan)...');
  }

  const crawledMap = new Map();
  let lastId = '';
  let page = 1;
  let totalExpected = 0;

  while (true) {
    const data = await fetchProposalPage(lastId, 100);
    if (page === 1) {
      totalExpected = data.count || 0;
      console.log(`📌 Tổng số QĐCB trên Cổng DVCQG: ${totalExpected}`);
      if (!fullScan && totalExpected < existingMap.size) {
        console.log(`🔄 Phát hiện số lượng giảm (${existingMap.size} -> ${totalExpected}). Tự động chuyển sang quét toàn bộ để đối chiếu gỡ bỏ...`);
        fullScan = true;
      }
    }

    const rows = data.rows || [];
    if (rows.length === 0) break;

    let newOrUpdatedInPage = 0;
    for (const r of rows) {
      if (!r.id) continue;
      const norm = normalizeProposalRecord(r);
      if (!crawledMap.has(r.id)) {
        crawledMap.set(r.id, norm);
        const old = existingMap.get(r.id);
        if (!old || old.updated_at_ts !== norm.updated_at_ts) {
          newOrUpdatedInPage++;
        }
      }
    }

    console.log(`   ➜ Trang ${page}: +${rows.length} bản ghi (Mới/Cập nhật: ${newOrUpdatedInPage})`);

    // Dừng sớm thông minh nếu không còn bản ghi mới/sửa đổi và tổng số đã khớp DVCQG
    if (!fullScan && newOrUpdatedInPage === 0 && (crawledMap.size + existingMap.size >= totalExpected)) {
      const mergedSize = new Set([...crawledMap.keys(), ...existingMap.keys()]).size;
      if (mergedSize >= totalExpected) {
        console.log(`⚡ [SMART SYNC] Đã đồng bộ đủ toàn bộ QĐCB mới! Dừng sớm tại trang ${page} (tiết kiệm ${Math.max(0, Math.ceil(totalExpected / 100) - page)} trang).`);
        break;
      }
    }

    const nextLastId = data.lastId || '';
    if (!nextLastId || nextLastId === lastId || rows.length < 100) {
      break;
    }

    lastId = nextLastId;
    page++;
    await sleep(250 + Math.floor(Math.random() * 200));
  }

  if (fullScan) {
    return Array.from(crawledMap.values());
  }

  // Hợp nhất: ưu tiên các bản ghi mới quét (mới nhất lên đầu), nối tiếp các bản ghi cũ chưa chạm tới
  const merged = new Map(crawledMap);
  for (const [id, oldItem] of existingMap.entries()) {
    if (!merged.has(id)) {
      merged.set(id, oldItem);
    }
  }
  return Array.from(merged.values());
}

function getModifiedFields(prev, curr) {
  const changes = [];
  if ((prev.so_quyet_dinh || '') !== (curr.so_quyet_dinh || '')) {
    changes.push({ field: 'so_quyet_dinh', old: prev.so_quyet_dinh || '', new: curr.so_quyet_dinh || '' });
  }
  if ((prev.trich_yeu || '') !== (curr.trich_yeu || '')) {
    changes.push({ field: 'trich_yeu', old: prev.trich_yeu || '', new: curr.trich_yeu || '' });
  }
  if ((prev.ngay_quyet_dinh || '') !== (curr.ngay_quyet_dinh || '')) {
    changes.push({ field: 'ngay_quyet_dinh', old: prev.ngay_quyet_dinh || '', new: curr.ngay_quyet_dinh || '' });
  }
  if ((prev.co_quan_ban_hanh || '') !== (curr.co_quan_ban_hanh || '')) {
    changes.push({ field: 'co_quan_ban_hanh', old: prev.co_quan_ban_hanh || '', new: curr.co_quan_ban_hanh || '' });
  }
  if (JSON.stringify(prev.linh_vuc || []) !== JSON.stringify(curr.linh_vuc || [])) {
    changes.push({ field: 'linh_vuc', old: prev.linh_vuc || [], new: curr.linh_vuc || [] });
  }
  if ((prev.tep_dinh_kem || []).length !== (curr.tep_dinh_kem || []).length) {
    changes.push({ field: 'tep_dinh_kem', old_count: (prev.tep_dinh_kem || []).length, new_count: (curr.tep_dinh_kem || []).length });
  }
  return changes;
}

function compareQdcbDatasets(currentItems) {
  const currentMap = new Map();
  currentItems.forEach((item) => {
    if (item.id) currentMap.set(item.id, item);
  });

  const previousMap = new Map();
  let hasSnapshot = false;

  if (fs.existsSync(SNAPSHOT_FILE)) {
    try {
      const prevRaw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
      if (Array.isArray(prevRaw) && prevRaw.length > 0) {
        prevRaw.forEach((item) => {
          if (item.id) previousMap.set(item.id, item);
        });
        hasSnapshot = true;
      }
    } catch (e) {
      console.warn('⚠️ Không đọc được snapshot.json cũ, sẽ tạo snapshot mới.');
    }
  }

  const added = [];
  const removed = [];
  const modified = [];

  if (hasSnapshot) {
    for (const [id, curr] of currentMap.entries()) {
      const prev = previousMap.get(id);
      if (!prev) {
        added.push(curr);
      } else {
        const changes = getModifiedFields(prev, curr);
        if (changes.length > 0) {
          modified.push({
            id: curr.id,
            so_quyet_dinh: curr.so_quyet_dinh,
            co_quan_ban_hanh: curr.co_quan_ban_hanh,
            url: curr.url,
            changes,
          });
        }
      }
    }

    for (const [id, prev] of previousMap.entries()) {
      if (!currentMap.has(id)) {
        removed.push(prev);
      }
    }
  }

  const previousTotal = hasSnapshot ? previousMap.size : currentItems.length;
  const currentTotal = currentItems.length;
  const summary = {
    previous_total: previousTotal,
    current_total: currentTotal,
    net_change: hasSnapshot ? currentTotal - previousTotal : 0,
    added_count: added.length,
    removed_count: removed.length,
    modified_count: modified.length,
    is_initial_snapshot: !hasSnapshot,
  };

  const report = {
    compared_at: new Date().toISOString(),
    summary,
    added,
    removed,
    modified,
  };

  return report;
}

function extractMonthlyNewProposals(currentItems, targetMonth) {
  const month = targetMonth || getCurrentVnMonth();
  const monthlyItems = currentItems.filter((item) => {
    const pubMonth = formatVnMonth(item.publication_date_ts) || (item.ngay_cong_bo ? item.ngay_cong_bo.slice(0, 7) : '');
    const createdMonth = formatVnMonth(item.created_at_ts);
    return pubMonth === month || createdMonth === month;
  });

  // Sắp xếp mới nhất lên đầu theo ngày công bố / tạo
  monthlyItems.sort((a, b) => {
    const tA = b.publication_date_ts || b.created_at_ts || 0;
    const tB = a.publication_date_ts || a.created_at_ts || 0;
    return tA - tB;
  });

  // Thống kê theo cơ quan ban hành
  const deptCounts = {};
  monthlyItems.forEach((item) => {
    const dept = item.co_quan_ban_hanh || 'Không xác định';
    deptCounts[dept] = (deptCounts[dept] || 0) + 1;
  });

  const byDepartment = Object.entries(deptCounts)
    .map(([co_quan_ban_hanh, count]) => ({ co_quan_ban_hanh, count }))
    .sort((a, b) => b.count - a.count);

  return {
    month,
    generated_at: new Date().toISOString(),
    total_monthly_new: monthlyItems.length,
    by_department: byDepartment,
    items: monthlyItems,
  };
}

async function postWithRetry(url, payload, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await axios.post(url, payload, {
        headers: getRandomHeaders(),
        timeout: 25000,
      });
      if (resp.data && resp.data.code === 'OK') {
        return resp.data.data || {};
      }
      throw new Error(`API code=${resp.data?.code || 'UNKNOWN'}`);
    } catch (err) {
      if (attempt === retries) throw err;
      const backoff = attempt * 1200 + Math.floor(Math.random() * 500);
      await sleep(backoff);
    }
  }
}

async function fetchProposalFormalitiesByType(proposalId, typeVal) {
  const rows = [];
  let lastId = '';
  let count = 0;

  while (true) {
    const data = await postWithRetry(FORMALITY_URL, {
      procedureProposalId: proposalId,
      type: typeVal,
      limit: 200,
      lastId,
      order: 'DESC',
    });
    if (lastId === '') count = data.count || 0;
    const batch = data.rows || [];
    if (batch.length === 0) break;

    for (const r of batch) {
      const fd = r.formalityData || {};
      rows.push({
        id: fd.id || r.formalityDraftId || '',
        ma_tthc: fd.code || '',
        ten_tthc: fd.name || '',
        linh_vuc: Array.isArray(fd.categoriesDetails) ? fd.categoriesDetails.map((c) => c.name).filter(Boolean) : [],
        ngay_hieu_luc: formatVnDate(fd.effectiveDate),
        trang_thai: r.state || '',
        url: (fd.id || r.formalityDraftId) ? `https://dichvucong.gov.vn/thu-tuc-hanh-chinh/${fd.id || r.formalityDraftId}` : '',
      });
    }

    const nextLastId = data.lastId || '';
    if (!nextLastId || nextLastId === lastId || batch.length < 200) break;
    lastId = nextLastId;
    await sleep(150);
  }

  return { count: Math.max(count, rows.length), items: rows };
}

async function fetchProposalDetailRecord(item) {
  const [detailRaw, createdRes, updatedRes, inactiveRes] = await Promise.all([
    postWithRetry(DETAIL_URL, { procedureProposalId: item.id }),
    fetchProposalFormalitiesByType(item.id, 'CREATED'),
    fetchProposalFormalitiesByType(item.id, 'UPDATED'),
    fetchProposalFormalitiesByType(item.id, 'INACTIVE'),
  ]);

  return {
    ...item,
    source_updated_at_ts: item.updated_at_ts || null,
    fetched_at: new Date().toISOString(),
    thong_tin_chi_tiet: detailRaw || null,
    tthc_kem_theo: {
      cong_khai_moi: createdRes,
      sua_doi_bo_sung: updatedRes,
      bai_bo: inactiveRes,
    },
  };
}

async function syncAllProposalDetails(items, options = {}) {
  if (!fs.existsSync(DETAILS_DIR)) fs.mkdirSync(DETAILS_DIR, { recursive: true });
  const force = Boolean(options.force);
  const queue = [];
  let cachedCount = 0;

  for (const item of items) {
    if (!item.id) continue;
    const detailPath = path.join(DETAILS_DIR, `${item.id}.json`);
    if (!force && fs.existsSync(detailPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
        if (existing && existing.source_updated_at_ts === (item.updated_at_ts || null) && existing.tthc_kem_theo) {
          cachedCount++;
          continue;
        }
      } catch (e) {
        // File hỏng -> cào lại
      }
    }
    queue.push(item);
  }

  console.log(`\n📚 ĐỒNG BỘ CHI TIẾT QĐCB (qdcb/details/):`);
  console.log(`   ✅ Đã có cache hợp lệ : ${cachedCount} bản ghi`);
  console.log(`   ⏳ Cần tải mới/cập nhật: ${queue.length} bản ghi`);

  if (queue.length === 0) {
    return { total: items.length, cached: cachedCount, fetched: 0, failed: 0 };
  }

  let fetched = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const idx = cursor++;
      const item = queue[idx];
      const detailPath = path.join(DETAILS_DIR, `${item.id}.json`);
      try {
        const fullDetail = await fetchProposalDetailRecord(item);
        fs.writeFileSync(detailPath, JSON.stringify(fullDetail, null, 2), 'utf8');
        fetched++;
      } catch (err) {
        failed++;
        console.warn(`   ⚠️ Lỗi chi tiết [${item.so_quyet_dinh}] (${item.id}): ${err.message}`);
      }
      const done = fetched + failed;
      if (done % 50 === 0 || done === queue.length) {
        console.log(`   ➜ Tiến độ details: ${done}/${queue.length} (Thành công: ${fetched}, Lỗi: ${failed})`);
      }
      await sleep(150 + Math.floor(Math.random() * 150));
    }
  }

  const workers = Array.from({ length: Math.min(DETAILS_CONCURRENCY, queue.length) }, () => worker());
  await Promise.all(workers);

  return { total: items.length, cached: cachedCount, fetched, failed };
}

function saveQdcbOutputs(currentItems, targetMonth, detailsSummary = null) {
  if (!fs.existsSync(QDCB_DIR)) fs.mkdirSync(QDCB_DIR, { recursive: true });
  if (!fs.existsSync(MONTHLY_DIR)) fs.mkdirSync(MONTHLY_DIR, { recursive: true });

  // 1. Chia part & Lưu index.json siêu nhẹ (tránh phình to index)
  const shardingSummary = writeShardedIndex(currentItems);

  // 2. So sánh với snapshot.json cũ để sinh compare_report.json
  const compareReport = compareQdcbDatasets(currentItems);
  fs.writeFileSync(COMPARE_REPORT_FILE, JSON.stringify(compareReport, null, 2), 'utf8');

  // 3. Cập nhật snapshot.json mới nhất
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentItems, null, 2), 'utf8');

  // 4. Trích xuất danh sách QĐCB mới bổ sung trong tháng
  const monthlyData = extractMonthlyNewProposals(currentItems, targetMonth);
  fs.writeFileSync(MONTHLY_NEW_FILE, JSON.stringify(monthlyData, null, 2), 'utf8');
  const monthArchiveFile = path.join(MONTHLY_DIR, `${monthlyData.month}.json`);
  fs.writeFileSync(monthArchiveFile, JSON.stringify(monthlyData, null, 2), 'utf8');

  // 5. Lưu version.json
  const versionData = {
    last_updated: new Date().toISOString(),
    total_records: currentItems.length,
    completed_records: currentItems.length,
    failed_records: detailsSummary ? detailsSummary.failed : 0,
    status: 'COMPLETED',
    sharding_summary: shardingSummary,
    compare_summary: compareReport.summary,
    monthly_summary: {
      month: monthlyData.month,
      total_monthly_new: monthlyData.total_monthly_new,
      departments_count: monthlyData.by_department.length,
    },
    ...(detailsSummary ? { details_summary: detailsSummary } : {}),
  };
  fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData, null, 2), 'utf8');

  console.log('\n📊 KẾT QUẢ LƯU TRỮ & THEO DÕI BIẾN ĐỘNG QĐCB:');
  console.log(`   📁 qdcb/index.json          : Master Index (${shardingSummary.index_size_kb} KB) -> liên kết ${shardingSummary.total_parts} parts`);
  console.log(`   📁 qdcb/parts/              : ${shardingSummary.total_parts} files (ngưỡng ~${shardingSummary.part_target_mb} MB/part)`);
  console.log(`   📁 qdcb/snapshot.json       : Đã cập nhật mốc đối chiếu`);
  console.log(`   📁 qdcb/compare_report.json : +${compareReport.summary.added_count} mới | -${compareReport.summary.removed_count} gỡ bỏ | ~${compareReport.summary.modified_count} sửa đổi`);
  console.log(`   📁 qdcb/monthly_new.json    : ${monthlyData.total_monthly_new} QĐCB mới bổ sung trong tháng ${monthlyData.month}`);
  if (detailsSummary) {
    console.log(`   📁 qdcb/details/            : ${detailsSummary.cached + detailsSummary.fetched}/${detailsSummary.total} tệp chi tiết (Mới tải: ${detailsSummary.fetched}, Lỗi: ${detailsSummary.failed})`);
  }
  console.log(`   📁 qdcb/version.json        : Đã cập nhật metadata`);
}

async function main() {
  const args = process.argv.slice(2);
  const compareOnly = args.includes('--compare');
  const skipDetails = args.includes('--skip-details');
  const forceDetails = args.includes('--force-details');
  const forceFull = args.includes('--full');
  const monthArg = args.find((a) => a.startsWith('--month='));
  const targetMonth = monthArg ? monthArg.split('=')[1].trim() : getCurrentVnMonth();

  if (compareOnly) {
    console.log('🔄 Chạy chế độ --compare trên dữ liệu qdcb/index.json & qdcb/parts/ hiện có...');
    const items = loadAllFromIndexOrParts();
    if (items.length === 0) {
      console.error('❌ Không tìm thấy dữ liệu trong qdcb/index.json hoặc qdcb/parts/. Hãy chạy node qdcb_crawler.js trước.');
      process.exit(1);
    }
    saveQdcbOutputs(items, targetMonth);
    return;
  }

  const items = await crawlAllProposals({ forceFull });
  let detailsSummary = null;
  if (!skipDetails) {
    detailsSummary = await syncAllProposalDetails(items, { force: forceDetails });
  }
  saveQdcbOutputs(items, targetMonth, detailsSummary);
  console.log('\n✅ Hoàn tất quét và trích xuất dữ liệu QĐCB!');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Lỗi nghiêm trọng trong qdcb_crawler.js:', err);
    process.exit(1);
  });
}

module.exports = {
  crawlAllProposals,
  compareQdcbDatasets,
  extractMonthlyNewProposals,
  loadAllFromIndexOrParts,
  writeShardedIndex,
  saveQdcbOutputs,
};
