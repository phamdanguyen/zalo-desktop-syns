# build_release.ps1 — Tạo bản phát hành 1-FILE của Zalo Sync.
# Kết quả: app\dist\ZaloSync.exe (chạy one-click, tự chứa) + HuongDan.txt + CaiDat (tuy chon).bat.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $here

# 1) Biên dịch exe 1-file (nhúng node + JS + engine + icon)
& (Join-Path $here 'build.ps1')

$dist = Join-Path $appDir 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item (Join-Path $here 'build\ZaloSync.exe') (Join-Path $dist 'ZaloSync.exe') -Force

# 2) Hướng dẫn
$huongDan = @"
ZALO SYNC — Trình thu thập & lưu trữ dữ liệu nhóm Zalo trên máy cá nhân
======================================================================

CÁCH DÙNG (chỉ 1 file, không cần cài gì):
  1. Mở Zalo PC và đăng nhập tài khoản của bạn (ít nhất một lần).
  2. Bấm đúp "ZaloSync.exe". (Lần đầu mở hơi lâu vài giây vì tự bung dữ liệu.)
  3. Làm theo 4 bước trên màn hình:
       - Bước 1: chọn tài khoản Zalo (tự phát hiện).
       - Bước 2: khóa được TỰ DÒ (không cần tìm hay nhập gì).
       - Bước 3: tích chọn nhóm cần đồng bộ.
       - Bước 4: chọn thư mục lưu + giờ chạy tự động, rồi "Hoàn tất".
  4. Xong là lịch chạy tự động hằng ngày ĐÃ BẬT (tắt/bật ở Bảng điều khiển); muốn chạy luôn thì bấm "Chạy ngay".
  5. Gặp lỗi? Bấm "Xuất log" → gửi file vừa tạo (thư mục baocao tự mở ra) cho AI / người hỗ trợ.

CHẠY NỀN:
  - Bấm X hoặc thu nhỏ → ứng dụng ẩn xuống KHAY HỆ THỐNG (gần đồng hồ),
    biểu tượng ô vuông cam chữ "Z" cho biết nó vẫn đang chạy nền.
  - Bấm đúp biểu tượng khay để mở lại; chuột phải để "Chạy ngay" hoặc "Thoát hẳn".
  - Lịch tự động chạy ngầm (không hiện cửa sổ), kể cả khi đã "Thoát hẳn".
    Máy tắt/ngủ đúng giờ hẹn → tự chạy bù ~10 phút sau khi đăng nhập Windows (hoặc khi máy thức),
    1 lượt bù lấy đủ dữ liệu mọi ngày bị lỡ. Đừng xoá/di chuyển ZaloSync.exe (lịch gọi đúng file này);
    lỡ di chuyển thì mở app từ chỗ mới 1 lần để lịch tự cập nhật.

NÂNG CẤP TỪ BẢN CŨ:
  - Thoát hẳn bản cũ (chuột phải biểu tượng ở khay → "Thoát hẳn") rồi mở bản mới.
    Cấu hình, nhóm đã chọn, tiến độ đồng bộ và lịch chạy tự động được tự chuyển sang;
    thư mục mặc định trong Documents được đổi theo tên mới (Documents\ZaloSync),
    thư mục bạn tự chọn giữ nguyên. Exe + lối tắt của bản cũ có thể xoá
    ("CaiDat (tuy chon).bat" tự dọn giúp).

GHI CHÚ:
  - CHỈ đọc dữ liệu Zalo của chính bạn trên máy này; không gửi đi đâu.
  - KHÔNG cần cài Node.js hay Administrator — mọi thứ đã nằm trong 1 file exe.
  - Muốn lấy lịch sử cũ hơn: cuộn lên trong app Zalo để nó tải về trước khi đồng bộ.
"@
Set-Content -Path (Join-Path $dist 'HuongDan.txt') -Value $huongDan -Encoding UTF8

# 3) Bộ tạo shortcut (tuỳ chọn) — cài vào Programs + shortcut Desktop
# Here-string NHÁY ĐƠN: không để PowerShell thay $s (biến của lệnh tạo shortcut) thành rỗng.
# Dọn bản cài tên cũ (ZaloSync568: thoát app, xoá exe + shortcut Desktop) để không mở nhầm bản cũ;
# cấu hình + lịch chạy của nó do chính app mới tự chuyển sang khi mở (lib/legacy_migrate.js).
$caiDat = @'
@echo off
chcp 65001 >nul
set "DEST=%LOCALAPPDATA%\Programs\ZaloSync"
taskkill /f /im ZaloSync568.exe >nul 2>&1
if exist "%LOCALAPPDATA%\Programs\ZaloSync568" rmdir /s /q "%LOCALAPPDATA%\Programs\ZaloSync568"
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%~dp0ZaloSync.exe" "%DEST%\ZaloSync.exe" >nul
powershell -NoProfile -Command "$d=[Environment]::GetFolderPath('Desktop');Remove-Item ($d+'\Zalo Sync 568.lnk') -ErrorAction SilentlyContinue;$s=(New-Object -ComObject WScript.Shell).CreateShortcut($d+'\Zalo Sync.lnk');$s.TargetPath='%DEST%\ZaloSync.exe';$s.WorkingDirectory='%DEST%';$s.Save()"
echo Da tao shortcut 'Zalo Sync' tren Desktop. Dang mo...
start "" "%DEST%\ZaloSync.exe"
'@
# .bat phải KHÔNG có BOM (cmd đọc BOM thành rác trước "@echo off") và xuống dòng CRLF.
[System.IO.File]::WriteAllText((Join-Path $dist 'CaiDat (tuy chon).bat'), (($caiDat -replace "`r?`n", "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding $false))

$mb = [math]::Round((Get-Item (Join-Path $dist 'ZaloSync.exe')).Length / 1MB, 1)
Write-Host "`n[DONE] 1-FILE RELEASE:" -ForegroundColor Green
Write-Host ("  {0}\ZaloSync.exe  ({1} MB, one-click, self-contained)" -f $dist, $mb)
Write-Host ("  {0}\HuongDan.txt" -f $dist)
Write-Host ("  {0}\CaiDat (tuy chon).bat" -f $dist)
