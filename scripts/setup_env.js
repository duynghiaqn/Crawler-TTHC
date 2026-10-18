/**
 * =====================================================================
 * TOOL KIỂM TRA & CÀI ĐẶT MÔI TRƯỜNG DỰ ÁN CRAWLER TTHC
 * =====================================================================
 * Hỗ trợ:
 * - Kiểm tra môi trường hệ thống: Node.js, npm, Git, node_modules
 * - Quản lý, khởi tạo và xác thực file cấu hình .env
 * - Hướng dẫn thiết lập tương tác (Interactive Wizard)
 * - Kiểm tra kết nối dịch vụ Telegram / Git
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const ROOT_DIR = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT_DIR, '.env');
const ENV_EXAMPLE_FILE = path.join(ROOT_DIR, '.env.example');
const PACKAGE_JSON_FILE = path.join(ROOT_DIR, 'package.json');

// Helper thực thi lệnh an toàn
function runCommand(cmd) {
    try {
        return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    } catch (e) {
        return null;
    }
}

// Ẩn bớt ký tự nhạy cảm khi hiển thị (Token)
function maskSecret(val) {
    if (!val || val.length === 0) return '(Chưa thiết lập)';
    if (val.length <= 8) return '********';
    return val.substring(0, 4) + '...' + val.substring(val.length - 4);
}

// Đọc toàn bộ các biến trong file .env
function getEnvConfig() {
    if (!fs.existsSync(ENV_FILE)) {
        return null;
    }
    const content = fs.readFileSync(ENV_FILE, 'utf8');
    const result = {};
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const eqIdx = trimmed.indexOf('=');
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        // Xóa dấu quote bọc nếu có
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
        }
        result[key] = val;
    }
    return result;
}

// Cập nhật hoặc thêm mới giá trị vào file .env nhưng giữ nguyên comment
function saveEnvValue(key, value) {
    let content = '';
    if (fs.existsSync(ENV_FILE)) {
        content = fs.readFileSync(ENV_FILE, 'utf8');
    } else if (fs.existsSync(ENV_EXAMPLE_FILE)) {
        content = fs.readFileSync(ENV_EXAMPLE_FILE, 'utf8');
    }

    const lines = content.split('\n');
    let found = false;
    const newLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) return line;
        const eqIdx = trimmed.indexOf('=');
        const currentKey = trimmed.substring(0, eqIdx).trim();
        if (currentKey === key) {
            found = true;
            return `${key}=${value}`;
        }
        return line;
    });

    if (!found) {
        newLines.push(`${key}=${value}`);
    }

    fs.writeFileSync(ENV_FILE, newLines.join('\n'), 'utf8');
}

// Khởi tạo file .env từ .env.example nếu chưa có
function ensureEnvFile() {
    if (!fs.existsSync(ENV_FILE)) {
        if (fs.existsSync(ENV_EXAMPLE_FILE)) {
            fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
            console.log('✅ Đã tự động tạo file .env mới từ .env.example');
            
            // Tự động đồng bộ git config vào .env nếu có
            const gitName = runCommand('git config user.name');
            const gitEmail = runCommand('git config user.email');
            if (gitName) saveEnvValue('GIT_USER_NAME', gitName);
            if (gitEmail) saveEnvValue('GIT_USER_EMAIL', gitEmail);
            return true;
        } else {
            console.log('⚠️ Không tìm thấy .env.example để tạo .env!');
            return false;
        }
    }
    return false;
}

// Kiểm tra toàn diện sức khỏe môi trường
function checkEnvironment() {
    console.log('=====================================================================');
    console.log('🔍 KIỂM TRA TỔNG THỂ MÔI TRƯỜNG HỆ THỐNG & CẤU HÌNH (HEALTH CHECK)');
    console.log('=====================================================================');

    // 1. Kiểm tra Node.js
    const nodeVer = process.version;
    const major = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
    const nodeStatus = major >= 18 ? `✅ Hợp lệ (${nodeVer})` : `⚠️ Cảnh báo (${nodeVer} - khuyến nghị Node 18+)`;
    console.log(`- Node.js runtime:       ${nodeStatus}`);

    // 2. Kiểm tra Git
    const gitVer = runCommand('git --version');
    if (gitVer) {
        console.log(`- Git version:           ✅ Đã cài đặt (${gitVer})`);
    } else {
        console.log(`- Git version:           ❌ Chưa cài đặt Git hoặc chưa thêm vào PATH!`);
    }

    const gitUser = runCommand('git config user.name') || '(Chưa cấu hình)';
    const gitEmail = runCommand('git config user.email') || '(Chưa cấu hình)';
    console.log(`  └─ Git User identity:   ${gitUser} <${gitEmail}>`);

    // 3. Kiểm tra Dependencies
    const nodeModulesExists = fs.existsSync(path.join(ROOT_DIR, 'node_modules'));
    if (nodeModulesExists) {
        console.log(`- Thư viện node_modules: ✅ Đã cài đặt đầy đủ`);
    } else {
        console.log(`- Thư viện node_modules: ❌ Chưa cài đặt! (Chạy 'npm install' hoặc 'run.bat install')`);
    }

    // 4. Kiểm tra file .env
    const envExists = fs.existsSync(ENV_FILE);
    if (!envExists) {
        console.log(`- File cấu hình .env:    ⚠️ CHƯA TỒN TẠI (Đang khởi tạo tự động...)`);
        ensureEnvFile();
    } else {
        console.log(`- File cấu hình .env:    ✅ Đã sẵn sàng (${ENV_FILE})`);
    }

    const env = getEnvConfig() || {};

    console.log('\n---------------------------------------------------------------------');
    console.log('📋 CHI TIẾT CẤU HÌNH DỊCH VỤ (.env):');
    console.log('---------------------------------------------------------------------');

    // Telegram
    const teleEnable = env.TELEGRAM_ENABLE !== 'false';
    const teleToken = env.TELEGRAM_BOT_TOKEN;
    const teleChatId = env.TELEGRAM_CHAT_ID;
    const teleTopicId = env.TELEGRAM_TOPIC_ID;
    const teleReady = teleEnable && !!teleToken && !!teleChatId;

    console.log(`[1] Thông báo Telegram:`);
    console.log(`    - Trạng thái bật/tắt: ${teleEnable ? '✅ BẬT (true)' : '⏸️ TẮT (false)'}`);
    console.log(`    - BOT TOKEN:          ${maskSecret(teleToken)}`);
    console.log(`    - CHAT ID:            ${teleChatId || '(Chưa thiết lập)'}`);
    if (teleTopicId) console.log(`    - TOPIC ID:           ${teleTopicId}`);
    console.log(`    => Đánh giá:          ${teleReady ? '✅ Sẵn sàng nhận thông báo' : '⚠️ Chưa đủ thông tin (cần Token & Chat ID)'}`);

    // Git Push
    const gitPushEnable = env.UPLOAD_REPO === 'true' || env.UPLOAD_TO_GIT === 'true' || (env.UPLOAD_REPO !== 'false' && env.UPLOAD_TO_GIT !== 'false');
    const ghToken = env.GITHUB_TOKEN;
    const ghRepo = env.GITHUB_REPOSITORY || 'duynghiaqn/Crawler-TTHC';
    console.log(`\n[2] Xuất bản & Đẩy dữ liệu Git:`);
    console.log(`    - Trạng thái Upload:  ${gitPushEnable ? '✅ Cho phép push' : '⏸️ Tắt upload (chỉ lưu cục bộ)'}`);
    console.log(`    - Repository:         ${ghRepo}`);
    console.log(`    - GITHUB_TOKEN (PAT): ${maskSecret(ghToken)}`);
    console.log(`    - Branch đích:        ${env.GIT_MAIN_BRANCH || 'main'} / ${env.GIT_DATA_BRANCH || 'data'}`);
    console.log(`    => Đánh giá:          ${gitPushEnable ? (ghToken ? '✅ Sẵn sàng đẩy code tự động (Token OK)' : 'ℹ️ Sẽ dùng Git Credentials hiện tại của máy') : '✅ Chạy chế độ Offline/Lưu cục bộ'}`);

    // Google Apps Script Webhook
    const gasUrl = env.GAS_WEBHOOK_URL;
    console.log(`\n[3] Cảnh báo Google Apps Script (GAS Webhook):`);
    console.log(`    - Webhook URL:        ${gasUrl ? '✅ Đã cấu hình' : '(Chưa thiết lập - Tùy chọn)'}`);
    console.log(`    - Secret Key:         ${maskSecret(env.GAS_SECRET_KEY)}`);

    console.log('\n=====================================================================');
    console.log('💡 GỢI Ý HÀNH ĐỘNG:');
    if (!teleReady && teleEnable) {
        console.log('👉 Chạy wizard cấu hình: node scripts/setup_env.js --wizard');
        console.log('   để nhập TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID.');
    } else {
        console.log('👉 Mọi cấu hình cơ bản đã sẵn sàng! Bạn có thể cào và xuất bản dữ liệu.');
    }
    console.log('=====================================================================\n');
}

// Interactive Configuration Wizard
async function runWizard() {
    ensureEnvFile();
    const env = getEnvConfig() || {};

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (query) => new Promise(resolve => rl.question(query, resolve));

    console.clear();
    console.log('=====================================================================');
    console.log('⚙️ TRÌNH HƯỚNG DẪN THIẾT LẬP MÔI TRƯỜNG (.env WIZARD)');
    console.log('=====================================================================');
    console.log('Ghi chú: Nhấn Enter để giữ nguyên giá trị hiện tại.\n');

    try {
        // 1. Telegram
        console.log('--- [1/3] CẤU HÌNH THÔNG BÁO TELEGRAM ---');
        const curEnable = env.TELEGRAM_ENABLE !== 'false' ? 'true' : 'false';
        const ansEnable = await ask(`Bật gửi thông báo Telegram? (true/false) [Hiện tại: ${curEnable}]: `);
        if (ansEnable.trim()) saveEnvValue('TELEGRAM_ENABLE', ansEnable.trim().toLowerCase());

        const curBotToken = env.TELEGRAM_BOT_TOKEN || '';
        const ansBotToken = await ask(`Nhập Telegram Bot Token từ @BotFather [Hiện tại: ${maskSecret(curBotToken)}]: `);
        if (ansBotToken.trim()) saveEnvValue('TELEGRAM_BOT_TOKEN', ansBotToken.trim());

        const curChatId = env.TELEGRAM_CHAT_ID || '';
        const ansChatId = await ask(`Nhập Telegram Chat ID hoặc Group ID [Hiện tại: ${curChatId || '(trống)'}]: `);
        if (ansChatId.trim()) saveEnvValue('TELEGRAM_CHAT_ID', ansChatId.trim());

        const curTopicId = env.TELEGRAM_TOPIC_ID || '';
        const ansTopicId = await ask(`Nhập Topic ID nếu dùng Group Forum (Enter để bỏ qua) [Hiện tại: ${curTopicId || '(trống)'}]: `);
        if (ansTopicId.trim() !== '') saveEnvValue('TELEGRAM_TOPIC_ID', ansTopicId.trim());

        // 2. Git & GitHub
        console.log('\n--- [2/3] CẤU HÌNH XUẤT BẢN REPOSITORY (GIT/GITHUB) ---');
        const curUpload = env.UPLOAD_REPO === 'false' ? 'false' : 'true';
        const ansUpload = await ask(`Tự động commit & push dữ liệu lên GitHub? (true/false) [Hiện tại: ${curUpload}]: `);
        if (ansUpload.trim()) saveEnvValue('UPLOAD_REPO', ansUpload.trim().toLowerCase());

        const curGhToken = env.GITHUB_TOKEN || '';
        const ansGhToken = await ask(`Nhập GitHub Personal Access Token (PAT) nếu cần [Hiện tại: ${maskSecret(curGhToken)}]: `);
        if (ansGhToken.trim()) saveEnvValue('GITHUB_TOKEN', ansGhToken.trim());

        const curRepo = env.GITHUB_REPOSITORY || 'duynghiaqn/Crawler-TTHC';
        const ansRepo = await ask(`Tên Repository (owner/repo) [Hiện tại: ${curRepo}]: `);
        if (ansRepo.trim()) saveEnvValue('GITHUB_REPOSITORY', ansRepo.trim());

        // 3. GAS Webhook
        console.log('\n--- [3/3] CẤU HÌNH GOOGLE APPS SCRIPT WEBHOOK (TÙY CHỌN) ---');
        const curGas = env.GAS_WEBHOOK_URL || '';
        const ansGas = await ask(`Nhập URL Webhook Google Apps Script (Enter để bỏ qua) [Hiện tại: ${curGas ? '(Đã có)' : '(trống)'}]: `);
        if (ansGas.trim() !== '') saveEnvValue('GAS_WEBHOOK_URL', ansGas.trim());

        console.log('\n=====================================================================');
        console.log('🎉 ĐÃ CẬP NHẬT CẤU HÌNH VÀO FILE .env THÀNH CÔNG!');
        console.log('=====================================================================');

        // Hỏi test Telegram
        const latestEnv = getEnvConfig() || {};
        if (latestEnv.TELEGRAM_BOT_TOKEN && latestEnv.TELEGRAM_CHAT_ID) {
            const testAns = await ask('\n>> Bạn có muốn gửi thử 1 tin nhắn kiểm tra Telegram ngay bây giờ? (Y/n): ');
            if (testAns.trim().toLowerCase() !== 'n') {
                console.log('\n⏳ Đang gửi tin nhắn thử nghiệm...');
                try {
                    execSync('node scripts/notify_telegram.js --status success --uploadStatus "Thu nghiem tu wizard cau hinh .env"', {
                        cwd: ROOT_DIR,
                        stdio: 'inherit'
                    });
                } catch (e) {
                    console.log('❌ Gửi tin nhắn thất bại. Vui lòng kiểm tra lại Token hoặc Chat ID.');
                }
            }
        }
    } finally {
        rl.close();
    }
}

// Main CLI dispatch
async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--wizard') || args.includes('-w')) {
        await runWizard();
    } else if (args.includes('--init')) {
        ensureEnvFile();
    } else {
        checkEnvironment();
    }
}

main().catch(err => {
    console.error('Lỗi khi thiết lập môi trường:', err);
    process.exit(1);
});
