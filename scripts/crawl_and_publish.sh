#!/usr/bin/env bash
set -e

echo "=================================================="
echo "🚀 BẮT ĐẦU QUY TRÌNH CÀO TTHC VÀ PUBLISH DATA"
echo "=================================================="

# 1. Chạy cỗ máy cào dữ liệu
node tthc_crawler.js

echo "=================================================="
echo "📦 ĐANG CẬP NHẬT GITHUB REPOSITORY (MAIN & DATA)"
echo "=================================================="

# 2. Push cập nhật vào nhánh main
git add data/
if ! git diff --staged --quiet; then
  git commit -m "chore: cập nhật TTHC master data"
  git push origin main
  echo "✅ Đã push bản cập nhật lên nhánh main thành công!"
else
  echo "ℹ️ Không có thay đổi mới trong data trên main."
fi

# 3. Publish dữ liệu dạng orphan commit ra nhánh data (publish_branch: data)
TREE=$(git write-tree --prefix=data)
COMMIT=$(git commit-tree ${TREE} -m "🚀 Cập nhật Master Data tự động")
git push origin ${COMMIT}:refs/heads/data --force

echo "=================================================="
echo "🎉 HOÀN TẤT XUẤT BẢN THÀNH CÔNG RA NHÁNH DATA!"
echo "=================================================="
