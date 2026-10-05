const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATA_DIR = path.join(process.cwd(), 'data');
const VERSION_FILE = path.join(DATA_DIR, 'version.json');
const COMPARE_REPORT_FILE = path.join(DATA_DIR, 'compare_report.json');
const COMPARE_PROVINCE_FILE = path.join(DATA_DIR, 'compare_province_report.json');
const EXCEL_FILE = path.join(DATA_DIR, 'Bao_cao_TTHC_Gia_Lai.xlsx');

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

/**
 * Doc thong tin phien ban va bien dong du lieu
 */
function collectSummaryData() {
    let versionInfo = null;
    let compareInfo = null;
    let provinceInfo = null;

    if (fs.existsSync(VERSION_FILE)) {
        try {
            versionInfo = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
        } catch (e) {}
    }

    if (fs.existsSync(COMPARE_REPORT_FILE)) {
        try {
            compareInfo = JSON.parse(fs.readFileSync(COMPARE_REPORT_FILE, 'utf8'));
        } catch (e) {}
    }

    if (fs.existsSync(COMPARE_PROVINCE_FILE)) {
        try {
            provinceInfo = JSON.parse(fs.readFileSync(COMPARE_PROVINCE_FILE, 'utf8'));
        } catch (e) {}
    }

    return { versionInfo, compareInfo, provinceInfo };
}

/**
 * Gui tin nhan toi Telegram
 */
async function sendTelegramMessage(htmlContent) {
    const isEnabled = process.env.TELEGRAM_ENABLE !== 'false';
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const topicId = process.env.TELEGRAM_TOPIC_ID || process.env.TELEGRAM_MESSAGE_THREAD_ID;

    if (!isEnabled) {
        console.log('[TELEGRAM] Da tat thong bao (TELEGRAM_ENABLE=false).');
        return false;
    }

    if (!botToken || !chatId) {
        console.log('[TELEGRAM] Bo qua thong bao (Chua cau hinh TELEGRAM_BOT_TOKEN hoac TELEGRAM_CHAT_ID trong .env).');
        return false;
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: htmlContent,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };

    if (topicId && !isNaN(Number(topicId))) {
        payload.message_thread_id = Number(topicId);
    }

    try {
        console.log('[TELEGRAM] Dang gui thong bao den Telegram...');
        const response = await axios.post(url, payload, { timeout: 15000 });
        if (response.data && response.data.ok) {
            console.log('[TELEGRAM] Gui thong bao thanh cong!');
            return true;
        } else {
            console.error('[TELEGRAM] Loi phan hoi tu Telegram API:', response.data);
            return false;
        }
    } catch (error) {
        if (error.response) {
            console.error(`[TELEGRAM] Loi API Telegram (${error.response.status}):`, error.response.data?.description || error.response.data);
        } else {
            console.error('[TELEGRAM] Loi ket noi Telegram:', error.message);
        }
        return false;
    }
}

/**
 * Gui file dinh kem (Excel, PDF, ...) toi Telegram
 */
async function sendTelegramDocument(filePath, caption = '') {
    const isEnabled = process.env.TELEGRAM_ENABLE !== 'false';
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const topicId = process.env.TELEGRAM_TOPIC_ID || process.env.TELEGRAM_MESSAGE_THREAD_ID;

    if (!isEnabled) {
        console.log('[TELEGRAM] Da tat thong bao (TELEGRAM_ENABLE=false).');
        return false;
    }

    if (!botToken || !chatId) {
        console.log('[TELEGRAM] Bo qua gui file (Chua cau hinh TELEGRAM_BOT_TOKEN hoac TELEGRAM_CHAT_ID trong .env).');
        return false;
    }

    if (!filePath || !fs.existsSync(filePath)) {
        console.warn(`[TELEGRAM] File dinh kem khong ton tai: ${filePath}`);
        return false;
    }

    const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
    const formData = new FormData();
    formData.append('chat_id', chatId);

    if (topicId && !isNaN(Number(topicId))) {
        formData.append('message_thread_id', Number(topicId));
    }

    if (caption) {
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const blob = new Blob([fileBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    formData.append('document', blob, fileName);

    try {
        console.log(`[TELEGRAM] Dang gui file dinh kem [${fileName}] den Telegram...`);
        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });
        const resData = await response.json();
        if (resData && resData.ok) {
            console.log(`[TELEGRAM] Gui file [${fileName}] thanh cong!`);
            return true;
        } else {
            console.error('[TELEGRAM] Loi phan hoi tu Telegram API khi gui file:', resData);
            return false;
        }
    } catch (error) {
        console.error('[TELEGRAM] Loi ket noi Telegram khi gui file:', error.message);
        return false;
    }
}

/**
 * Xay dung noi dung thong bao thanh cong
 */
function buildSuccessMessage(uploadStatus = 'Chua thuc hien') {
    const { versionInfo, compareInfo, provinceInfo } = collectSummaryData();
    const timeStr = formatVietnamTime();

    let lines = [];
    lines.push(`🚀 <b>BÁO CÁO CÀO DỮ LIỆU TTHC (DVCQG)</b>`);
    lines.push(`📅 <i>Thời gian: ${timeStr}</i>`);
    lines.push('');

    // Thông tin Master Data
    lines.push(`📊 <b>Master Data:</b>`);
    if (versionInfo) {
        lines.push(`• Tổng số bản ghi: <b>${versionInfo.total_records ?? 'N/A'}</b>`);
        lines.push(`• ✅ Hoàn tất: <b>${versionInfo.completed_records ?? 'N/A'}</b>`);
        lines.push(`• ❌ Thất bại: <b>${versionInfo.failed_records ?? 0}</b>`);
        const statusEmoji = versionInfo.circuit_breaker_status === 'COMPLETED' ? '🟢' : '🟡';
        lines.push(`• ${statusEmoji} Trạng thái: <b>${versionInfo.circuit_breaker_status || 'UNKNOWN'}</b>`);
    } else {
        lines.push(`• <i>Chưa có dữ liệu version.json</i>`);
    }
    lines.push('');

    // Biến động TTHC toàn quốc
    if (compareInfo && compareInfo.summary) {
        const s = compareInfo.summary;
        lines.push(`📈 <b>Biến động TTHC Toàn quốc:</b>`);
        lines.push(`• 🟢 Mới thêm: <b>+${s.added_count ?? 0}</b>`);
        lines.push(`• 🔴 Bãi bỏ/Xóa: <b>-${s.removed_count ?? 0}</b>`);
        lines.push(`• 🟡 Điều chỉnh: <b>${s.modified_count ?? 0}</b>`);
        lines.push('');
    }

    // Biến động TTHC Cấp Tỉnh (nếu có)
    if (provinceInfo && provinceInfo.summary) {
        const ps = provinceInfo.summary;
        lines.push(`🏛️ <b>Dữ liệu Cấp Tỉnh & Xã (Gia Lai):</b>`);
        lines.push(`• Tổng TTHC áp dụng: <b>${ps.current_total ?? 'N/A'}</b>`);
        if (ps.level_breakdown) {
            lines.push(`• 🏢 Cấp Tỉnh: <b>${ps.level_breakdown.province_only + ps.level_breakdown.both_province_and_ward}</b> | 🏡 Cấp Xã: <b>${ps.level_breakdown.ward_only + ps.level_breakdown.both_province_and_ward}</b>`);
        }
        if (ps.added_count > 0 || ps.removed_count > 0 || ps.modified_count > 0) {
            lines.push(`• Biến động: <b>+${ps.added_count} / -${ps.removed_count} / ~${ps.modified_count}</b>`);
        }
        lines.push('');
    }

    // Thông tin file đính kèm Excel
    if (fs.existsSync(EXCEL_FILE)) {
        lines.push(`📎 <b>File đính kèm:</b> Đã xuất Excel <code>${path.basename(EXCEL_FILE)}</code> (Gồm TTHC Cấp Tỉnh, Cấp Xã & Biến động Gia Lai).`);
        lines.push('');
    }

    // Trạng thái Upload Git
    lines.push(`📦 <b>Trạng thái Upload Repo:</b>`);
    lines.push(`• <b>${uploadStatus}</b>`);
    lines.push('');
    lines.push(`🤖 <i>Crawler TTHC Engine • Chạy tự động thành công</i>`);

    return lines.join('\n');
}

/**
 * Xay dung noi dung thong bao loi
 */
function buildErrorMessage(errorMessage) {
    const timeStr = formatVietnamTime();
    let lines = [];
    lines.push(`🚨 <b>CẢNH BÁO: CRAWLER TTHC GẶP LỖI!</b>`);
    lines.push(`📅 <i>Thời gian: ${timeStr}</i>`);
    lines.push('');
    lines.push(`❌ <b>Chi tiết sự cố:</b>`);
    lines.push(`<code>${errorMessage || 'Lỗi không xác định'}</code>`);
    lines.push('');
    lines.push(`⚠️ <i>Vui lòng kiểm tra lại tiến trình cào hoặc checkpoint.</i>`);
    return lines.join('\n');
}

/**
 * Ham xu ly gui thong bao tong quat
 */
async function notify({ status = 'success', uploadStatus = '', errorMessage = '', documentPath = null, documentCaption = '' }) {
    let content = '';
    if (status === 'error') {
        content = buildErrorMessage(errorMessage);
    } else {
        content = buildSuccessMessage(uploadStatus);
    }

    // 1. Gui noi dung tin nhan HTML
    const msgOk = await sendTelegramMessage(content);

    // 2. Neu thanh cong, tu dong gui kem file Excel neu co
    if (status === 'success') {
        const targetDoc = documentPath || EXCEL_FILE;
        if (fs.existsSync(targetDoc)) {
            const timeStr = formatVietnamTime();
            const caption = documentCaption || `📊 <b>File Excel Danh Sách & Biến Động TTHC Cấp Tỉnh, Cấp Xã (Gia Lai)</b>\n📅 <i>Thời gian xuất: ${timeStr}</i>\n📁 <i>File: ${path.basename(targetDoc)}</i>`;
            await sendTelegramDocument(targetDoc, caption);
        }
    }

    return msgOk;
}

// Ho tro chay truc tiep tu command line
if (require.main === module) {
    const args = process.argv.slice(2);
    let status = 'success';
    let uploadStatus = 'Đã hoàn tất quy trình';
    let errorMessage = '';
    let documentPath = null;
    let documentCaption = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--status' && args[i + 1]) {
            status = args[i + 1];
            i++;
        } else if (args[i] === '--uploadStatus' && args[i + 1]) {
            uploadStatus = args[i + 1];
            i++;
        } else if (args[i] === '--error' && args[i + 1]) {
            errorMessage = args[i + 1];
            status = 'error';
            i++;
        } else if (args[i] === '--document' && args[i + 1]) {
            documentPath = args[i + 1];
            i++;
        } else if (args[i] === '--caption' && args[i + 1]) {
            documentCaption = args[i + 1];
            i++;
        } else if (args[i] === 'test') {
            status = 'success';
            uploadStatus = 'Kiểm tra gửi tin nhắn thử nghiệm & file đính kèm';
        }
    }

    notify({ status, uploadStatus, errorMessage, documentPath, documentCaption }).then(() => {
        process.exit(0);
    }).catch(err => {
        console.error('[TELEGRAM] Unhandled error:', err);
        process.exit(0);
    });
}

module.exports = {
    sendTelegramMessage,
    sendTelegramDocument,
    notify,
    buildSuccessMessage,
    buildErrorMessage
};
