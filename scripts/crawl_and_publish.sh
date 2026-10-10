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
echo "[1/5] ⏳ Đang chạy cỗ máy cào dữ liệu toàn quốc..."
node tthc_crawler.js

echo "[2/5] 🏛️ Đang thu thập và lọc dữ liệu TTHC Gia Lai (data-gl)..."
node tthc_crawler_gl.js || true

# 2. Phân tích so sánh biến động dữ liệu TTHC (tăng/giảm/bãi bỏ)
echo "[3/5] 📊 Đang phân tích so sánh biến động dữ liệu TTHC..."
node scripts/compare.js || true

echo "[4/5] 📊 Đang phân tích so sánh dữ liệu cấp Tỉnh và xuất file Excel..."
node scripts/compare_Province.js || true
node scripts/export_excel.js || true

# 3. Xuất bản dữ liệu & Gửi thông báo Telegram theo cấu hình .env
echo "[5/5] 📦 Đang xuất bản dữ liệu và gửi thông báo Telegram..."
node scripts/publish.js

echo "=================================================="
echo "🎉 HOÀN TẤT TOÀN BỘ QUY TRÌNH!"
echo "=================================================="
