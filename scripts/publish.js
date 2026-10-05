const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config();
const { notify } = require('./notify_telegram');

function runCmd(command, options = {}) {
    return execSync(command, {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: options.silent ? 'pipe' : 'inherit',
        ...options
    });
}

function runCmdOutput(command) {
    try {
        return execSync(command, { cwd: process.cwd(), encoding: 'utf8' }).trim();
    } catch (e) {
        return null;
    }
}

async function main() {
    console.log('\n==================================================');
    console.log('📦 QUY TRÌNH XUẤT BẢN DỮ LIỆU & THÔNG BÁO');
    console.log('==================================================');

    // 1. Doc bien moi truong
    const uploadEnabled = process.env.UPLOAD_REPO === 'true' || 
                         process.env.UPLOAD_TO_GIT === 'true' ||
                         (process.env.UPLOAD_REPO !== 'false' && process.env.UPLOAD_TO_GIT !== 'false');

    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GIT_TOKEN;
    const remoteName = process.env.GIT_REMOTE_NAME || 'origin';
    const remoteUrl = process.env.GIT_REMOTE_URL;
    const mainBranch = process.env.GIT_MAIN_BRANCH || 'main';
    const dataBranch = process.env.GIT_DATA_BRANCH || 'data';

    let uploadStatusMessage = '';

    if (!uploadEnabled) {
        console.log('\nℹ️ [CONFIG] Bỏ qua bước upload Git Repository theo cấu hình trong .env (UPLOAD_REPO=false).');
        uploadStatusMessage = 'Bỏ qua (UPLOAD_REPO=false)';
    } else {
        console.log(`\n🚀 [GIT] Chuẩn bị xuất bản dữ liệu lên nhánh [${mainBranch}] & [${dataBranch}]...`);
        
        try {
            // Xác định remote đích (ưu tiên GITHUB_TOKEN, sau đó đến GIT_REMOTE_URL hoặc tên remote gốc)
            let targetRemote = remoteUrl || remoteName;

            if (githubToken) {
                console.log('🔑 [AUTH] Phát hiện GITHUB_TOKEN: Tự động cấu hình xác thực quyền push GitHub.');
                const currentUrl = remoteUrl || runCmdOutput(`git remote get-url ${remoteName}`) || 'https://github.com/duynghiaqn/Crawler-TTHC.git';
                let cleanPath = currentUrl.replace(/^https?:\/\//i, '').replace(/^git@([^:]+):/, '$1/');
                cleanPath = cleanPath.replace(/^[^@]+@/, '');
                targetRemote = `https://${githubToken}@${cleanPath}`;
            }

            // 1. Stage thu muc data/
            console.log('📁 Staging thư mục data/...');
            runCmd('git add data/');

            // 2. Kiem tra xem co thay doi trong staged hay khong
            let hasChanges = false;
            try {
                execSync('git diff --staged --quiet', { stdio: 'pipe' });
                // Exit code 0 nghia la khong co thay doi
                hasChanges = false;
            } catch (diffErr) {
                // Exit code 1 nghia la co thay doi moi
                hasChanges = true;
            }

            if (hasChanges) {
                console.log(`💾 Phát hiện dữ liệu mới. Đang commit và push lên nhánh ${mainBranch}...`);
                runCmd('git commit -m "chore: cập nhật TTHC master data"');
                runCmd(`git push ${targetRemote} ${mainBranch}`);
                console.log(`✅ Đã đẩy cập nhật lên nhánh ${mainBranch} thành công!`);
            } else {
                console.log(`ℹ️ Không có thay đổi mới trong data/ trên nhánh ${mainBranch}.`);
            }

            // 3. Publish du lieu dang orphan commit ra nhanh data
            console.log(`🚀 Đang tạo orphan commit xuất bản ra nhánh ${dataBranch}...`);
            const tree = runCmdOutput('git write-tree --prefix=data');
            if (!tree) {
                throw new Error('Không thể tạo git write-tree cho thư mục data/');
            }

            const commit = runCmdOutput(`git commit-tree ${tree} -m "🚀 Cập nhật Master Data tự động"`);
            if (!commit) {
                throw new Error('Không thể tạo commit-tree cho data/');
            }

            runCmd(`git push ${targetRemote} ${commit}:refs/heads/${dataBranch} --force`);
            console.log(`🎉 Xuất bản thành công ra nhánh [${dataBranch}]!`);

            uploadStatusMessage = hasChanges 
                ? `Thành công (Đã cập nhật ${mainBranch} & ${dataBranch})`
                : `Thành công (Đã cập nhật ${dataBranch}, ${mainBranch} không đổi)`;

        } catch (err) {
            const safeErrorMessage = (githubToken && err.message)
                ? err.message.split(githubToken).join('***TOKEN***')
                : err.message;
            console.error('\n❌ [LỖI GIT] Quá trình upload repo gặp sự cố:', safeErrorMessage);
            uploadStatusMessage = `Thất bại: ${safeErrorMessage}`;
            
            // Gui thong bao loi
            await notify({
                status: 'error',
                errorMessage: `Lỗi khi upload Git: ${safeErrorMessage}`
            });
            process.exit(1);
        }
    }

    // 4. Gui thong bao Telegram sau khi hoan tat
    console.log('\n==================================================');
    console.log('📢 GỬI THÔNG BÁO HOÀN TẤT...');
    console.log('==================================================');
    await notify({
        status: 'success',
        uploadStatus: uploadStatusMessage
    });

    console.log('\n✨ TOÀN BỘ QUY TRÌNH ĐÃ HOÀN TẤT!');
}

main().catch(async (err) => {
    console.error('❌ Lỗi không xử lý được trong publisher:', err);
    try {
        await notify({
            status: 'error',
            errorMessage: err.message
        });
    } catch (e) {}
    process.exit(1);
});
