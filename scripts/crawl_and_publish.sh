#!/usr/bin/env bash
set -e

# Chuyển về thư mục gốc
cd "$(dirname "$0")/.."

echo "=================================================="
echo "🚀 BẮT ĐẦU QUY TRÌNH CÀO TTHC VÀ PUBLISH DATA"
echo "=================================================="

# Hàm bẫy lỗi để gửi thông báo Telegram khi gặp sự cố
trap_error() {
    echo "❌ Có lỗi xảy ra trong quá trình thực thi!"
    node scripts/notify_telegram.js --status error --error "Tiến trình cào hoặc xuất bản dữ liệu gặp lỗi đột ngột!" || true
}
trap trap_error ERR

# 1. Chạy cỗ máy cào dữ liệu
echo "[1/4] ⏳ Đang chạy cỗ máy cào dữ liệu..."
node tthc_crawler.js

# 2. Phân tích so sánh biến động dữ liệu TTHC (tăng/giảm/bãi bỏ)
echo "[2/4] 📊 Đang phân tích so sánh biến động dữ liệu TTHC..."
node scripts/compare.js || true

echo "[3/4] 📊 Đang phân tích so sánh dữ liệu cấp Tỉnh và xuất file Excel..."
node scripts/compare_Province.js || true
node scripts/export_excel.js || true

# 3. Xuất bản dữ liệu & Gửi thông báo Telegram theo cấu hình .env
echo "[4/4] 📦 Đang xuất bản dữ liệu và gửi thông báo Telegram..."
node scripts/publish.js

echo "=================================================="
echo "🎉 HOÀN TẤT TOÀN BỘ QUY TRÌNH!"
echo "=================================================="
