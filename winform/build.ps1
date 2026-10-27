# build.ps1 — Biên dịch Zalo Sync thành MỘT file .exe DUY NHẤT (nhúng node.exe + JS + engine + icon).
# Dùng csc.exe in-box (.NET Framework 4.x). Kết quả: build\ZaloSync.exe (chạy one-click, tự giải nén runtime).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path          # ...\app\winform
$appDir = Split-Path -Parent $here                               # ...\app
$root = Split-Path -Parent $appDir                               # ...\MessageDB
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "Không thấy csc.exe in-box tại $csc" }

$outDir = Join-Path $here 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir 'ZaloSync.exe'
$ico = Join-Path $here 'app.ico'

# System.Web.Extensions.dll (JavaScriptSerializer)
$fwDir = Split-Path $csc -Parent
$webExt = Join-Path $fwDir 'System.Web.Extensions.dll'
if (-not (Test-Path $webExt)) {
  $webExt = (Get-ChildItem "C:\Windows\Microsoft.NET\Framework64" -Recurse -Filter 'System.Web.Extensions.dll' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if (-not $webExt) { throw "Không tìm thấy System.Web.Extensions.dll" }

# node.exe hệ thống để nhúng
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $nodeExe)) { throw "Không tìm thấy node.exe để nhúng: $nodeExe" }

# Danh sách tài nguyên nhúng (tên logic dùng '/', để runtime giải nén đúng cây thư mục)
$resArgs = @()
$resArgs += "/resource:$nodeExe,node/node.exe"
$resArgs += "/resource:$(Join-Path $appDir 'cli.js'),app/cli.js"
$resArgs += "/resource:$ico,app.ico"   # tên KHÔNG có '/' → không bị giải nén; Program.cs nạp icon nhiều cỡ từ đây
Get-ChildItem (Join-Path $appDir 'lib\*.js') | ForEach-Object { $resArgs += "/resource:$($_.FullName),app/lib/$($_.Name)" }
foreach ($f in 'daily_sync_568.js', 'discover_568_groups.js', 'lib_audit.js', 'lib_snapshot.js') {
  $resArgs += "/resource:$(Join-Path $root "scripts\$f"),engine/$f"
}

$refs = @('/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll', "/reference:$webExt")
$cscArgs = @('/nologo', '/target:winexe', "/out:$out", "/win32icon:$ico") + $refs + $resArgs + @((Join-Path $here 'Program.cs'))

Write-Host "csc → $out (nhúng node + JS + engine + icon)…" -ForegroundColor Cyan
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "csc thất bại (mã $LASTEXITCODE)" }
$mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host "OK: $out  ($mb MB, 1-file)" -ForegroundColor Green
