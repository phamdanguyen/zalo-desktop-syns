# test_ui.ps1 — Kiểm thử GUI trên exe thật (Win32, không cần cài thêm gì).
# Đi qua: Bảng điều khiển → Bước 1 → 2 → 3 → 4 (KHÔNG bấm "Hoàn tất" → không ghi đè cấu hình).
# Ở mỗi màn hình × mỗi cỡ cửa sổ, kiểm tra bố cục:
#   - mọi control nằm gọn trong vùng client (không tràn/cắt chữ),
#   - các control lá (nút, nhãn, ô nhập, danh sách) không chồng lên nhau,
#   - danh sách / log giãn theo chiều ngang (và log giãn xuống đáy),
#   - nút chính của wizard nằm góc dưới-phải.
# Và hành vi:
#   - "📁 Thư mục dữ liệu" mở Explorer tại ĐÚNG downloadDir,
#   - "📋 Xuất log" tạo file mới trong thư mục báo cáo, đủ các mục, không lộ khóa (file test bị xoá sau đó),
#   - "⚙ Thiết lập lại" giữ nhóm đang đồng bộ (Bước 3) và điền sẵn thư mục dữ liệu đang dùng (Bước 4),
#   - tên app mới "Zalo Sync": tiêu đề cửa sổ + mọi nhãn/nút không còn tên cũ "568"; bản cài tên cũ đã được chuyển + dọn.
# Ảnh chụp từng trường hợp lưu ở $ShotDir. Thoát mã ≠ 0 nếu có lỗi.
# Chạy: powershell -NoProfile -ExecutionPolicy Bypass -File winform\test_ui.ps1
param(
  [string]$Exe = (Join-Path $PSScriptRoot 'build\ZaloSync.exe'),
  [string]$ShotDir = (Join-Path $env:TEMP 'zalosync_layout')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, WindowsBase
# Duyệt cửa sổ con bằng Win32 (UI Automation báo control WinForms .NET 4 là "Pane" → không lọc được theo loại).
Add-Type @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public class Ctl { public IntPtr H; public string Kind, Text; public RECT Rc; public bool Enabled; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  static readonly string[] Leaf = { "BUTTON", "STATIC", "EDIT", "LISTBOX", "SysDateTimePick32" };
  // Control lá đang hiển thị; Kind = một trong Leaf (theo tên lớp WindowsForms10.<KIND>.app…)
  public static List<Ctl> Leaves(IntPtr parent) {
    var list = new List<Ctl>();
    EnumChildWindows(parent, (h, l) => {
      if (!IsWindowVisible(h)) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      string kind = null; foreach (var k in Leaf) if (cls.ToString().Contains("." + k + ".")) kind = k;
      if (kind == null) return true;
      var t = new StringBuilder(512); SendMessage(h, 0x000D, (IntPtr)512, t); // WM_GETTEXT
      RECT r; GetWindowRect(h, out r);
      list.Add(new Ctl { H = h, Kind = kind, Text = t.ToString(), Rc = r, Enabled = IsWindowEnabled(h) });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
'@
$Sizes = @(@(720, 560), @(860, 640), @(1400, 900))   # tối thiểu, mặc định, lớn (khớp MinimumSize/Size trong Program.cs)
$EdgeTol = 40                                         # px: "sát mép" = cách mép client ≤ 40
$failures = New-Object System.Collections.Generic.List[string]

New-Item -ItemType Directory -Force $ShotDir | Out-Null
Get-Process ZaloSync -ErrorAction SilentlyContinue | Stop-Process -Force
$proc = Start-Process $Exe -PassThru
for ($i = 0; $i -lt 120 -and $proc.MainWindowHandle -eq 0; $i++) { Start-Sleep -Milliseconds 500; $proc.Refresh() }
if ($proc.MainWindowHandle -eq 0) { throw "Không thấy cửa sổ chính của $Exe" }
$h = $proc.MainWindowHandle

function Get-Leaves([string[]]$kinds) { @([W]::Leaves($h) | Where-Object { $kinds -contains $_.Kind }) }
function Name($c) { $t = $c.Text.Split("`n")[0].Trim(); if ($t.Length -gt 40) { $t = $t.Substring(0, 40) + '…' }; "$($c.Kind):'$t'" }
function Rect($c) { New-Object System.Windows.Rect($c.Rc.L, $c.Rc.T, ($c.Rc.R - $c.Rc.L), ($c.Rc.B - $c.Rc.T)) }

function Wait-For([scriptblock]$cond, [string]$what, [int]$sec = 90) {
  for ($i = 0; $i -lt $sec * 4; $i++) { $r = & $cond; if ($r) { return $r }; Start-Sleep -Milliseconds 250 }
  throw "Hết giờ chờ: $what"
}

function Find-Button([string]$name) { Get-Leaves @('BUTTON') | Where-Object { $_.Text -eq $name -and $_.Enabled } | Select-Object -First 1 }
function Find-Text([string]$prefix) { Get-Leaves @('STATIC') | Where-Object { $_.Text.StartsWith($prefix) } | Select-Object -First 1 }

function Click([string]$name) {
  $b = Wait-For { Find-Button $name } "nút '$name'"
  [W]::PostMessage($b.H, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null   # BM_CLICK
  Start-Sleep -Milliseconds 500
}

function Get-ClientRect {
  $r = New-Object W+RECT; [W]::GetClientRect($h, [ref]$r) | Out-Null
  $p = New-Object W+POINT; [W]::ClientToScreen($h, [ref]$p) | Out-Null
  New-Object System.Windows.Rect($p.X, $p.Y, $r.R, $r.B)
}

function Save-Shot([string]$name) {
  $r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
  $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
  [W]::PrintWindow($h, $dc, 2) | Out-Null
  $g.ReleaseHdc($dc); $g.Dispose()
  $bmp.Save((Join-Path $ShotDir "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

function Fail([string]$msg) { $failures.Add($msg); Write-Host "  ✗ $msg" -ForegroundColor Red }

# $navButtons: nút phải nằm góc dưới-phải; -logFillsBottom: log phải giãn xuống đáy.
function Check-Screen([string]$screen, [string[]]$navButtons = @(), [switch]$logFillsBottom) {
  # tên app mới (ô nhập/log bỏ qua: chứa đường dẫn người dùng tự chọn)
  $title = (Get-Process -Id $proc.Id).MainWindowTitle
  if ($title -ne 'Zalo Sync — Trình thu thập dữ liệu nhóm') { Fail "[$screen] tiêu đề cửa sổ: '$title'" }
  foreach ($c in (Get-Leaves @('BUTTON', 'STATIC') | Where-Object { $_.Text -match 'Sync ?568' })) { Fail "[$screen] còn tên cũ: $(Name $c)" }
  foreach ($s in $Sizes) {
    $tag = "$screen-$($s[0])x$($s[1])"
    [W]::SetWindowPos($h, [IntPtr]::Zero, 40, 40, $s[0], $s[1], 0x14) | Out-Null   # NOZORDER|NOACTIVATE
    Start-Sleep -Milliseconds 600
    Save-Shot $tag
    $cr = Get-ClientRect
    Write-Host "[$tag] client $($cr.Width)x$($cr.Height)"

    $leaves = Get-Leaves @('BUTTON', 'STATIC', 'EDIT', 'LISTBOX', 'SysDateTimePick32')
    foreach ($c in $leaves) {
      $b = Rect $c
      if ($b.Width -le 1 -or $b.Height -le 1) { continue }
      if ($b.Left -lt $cr.Left - 1 -or $b.Right -gt $cr.Right + 1 -or $b.Bottom -gt $cr.Bottom + 1) {
        Fail "[$tag] $(Name $c) tràn khỏi cửa sổ: $b (client $cr)"
      }
    }
    for ($i = 0; $i -lt $leaves.Count; $i++) {
      for ($j = $i + 1; $j -lt $leaves.Count; $j++) {
        $x = [System.Windows.Rect]::Intersect((Rect $leaves[$i]), (Rect $leaves[$j]))
        if (-not $x.IsEmpty -and $x.Width -gt 1 -and $x.Height -gt 1) {
          Fail "[$tag] chồng nhau: $(Name $leaves[$i]) × $(Name $leaves[$j])"
        }
      }
    }
    foreach ($c in (Get-Leaves @('EDIT', 'LISTBOX') | Where-Object { ($_.Rc.B - $_.Rc.T) -gt 60 })) {
      if ($cr.Right - $c.Rc.R -gt $EdgeTol) { Fail "[$tag] $($c.Kind) lớn không giãn ngang (cách mép phải $([int]($cr.Right - $c.Rc.R))px)" }
      if ($logFillsBottom -and $cr.Bottom - $c.Rc.B -gt $EdgeTol) { Fail "[$tag] log không giãn xuống đáy (cách đáy $([int]($cr.Bottom - $c.Rc.B))px)" }
    }
    foreach ($n in $navButtons) {
      $btn = Get-Leaves @('BUTTON') | Where-Object { $_.Text -eq $n } | Select-Object -First 1
      if (-not $btn) { Fail "[$tag] không thấy nút '$n'"; continue }
      if ($cr.Right - $btn.Rc.R -gt $EdgeTol -or $cr.Bottom - $btn.Rc.B -gt $EdgeTol) {
        Fail "[$tag] nút '$n' không ở góc dưới-phải (cách phải $([int]($cr.Right - $btn.Rc.R))px, cách đáy $([int]($cr.Bottom - $btn.Rc.B))px)"
      }
    }
  }
}

try {
  Wait-For { Find-Text 'Bảng điều khiển' } 'bảng điều khiển' | Out-Null
  # chờ bảng điều khiển nạp xong: nút lịch đổi sang Bật/Tắt (sau "status"), rồi log (nếu có)
  Wait-For { Get-Leaves @('BUTTON') | Where-Object { $_.Text -match '(Bật|Tắt) tự động$' } } 'trạng thái lịch' | Out-Null
  try { Wait-For { Get-Leaves @('EDIT') | Where-Object { $_.Text.Length -gt 0 } } 'log' 10 | Out-Null } catch { Write-Host '  (log trống)' }
  Check-Screen 'dashboard' -logFillsBottom

  # bản cài tên cũ phải được app tự chuyển sang + dọn ngay khi mở (lib/legacy_migrate.js)
  if (Test-Path (Join-Path $env:LOCALAPPDATA 'ZaloSync568')) { Fail 'chưa dọn thư mục bản cũ %LOCALAPPDATA%\ZaloSync568' }
  if (Get-ScheduledTask -TaskName 'ZaloSync568_Daily' -ErrorAction SilentlyContinue) { Fail 'tác vụ lịch cũ ZaloSync568_Daily vẫn còn' }

  $cfg = Get-Content (Join-Path $env:LOCALAPPDATA 'ZaloSync\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  # engine không gắn "568" vào báo cáo; thư mục MẶC ĐỊNH cũ Documents\ZaloSync568 đã đổi tên (máy chưa có Documents\ZaloSync)
  if ($cfg.projectCode -ne '') { Fail "config.projectCode phải rỗng (đang: '$($cfg.projectCode)')" }
  foreach ($d in $cfg.downloadDir, $cfg.reportDir) { if ($d -match '/Documents/ZaloSync568(/|$)') { Fail "cấu hình còn trỏ thư mục mặc định cũ: $d" } }
  $dataDir = $cfg.downloadDir -replace '/', '\'
  $reportDir = $cfg.reportDir -replace '/', '\'
  $shell = New-Object -ComObject Shell.Application
  function Explorer-Handles { @($shell.Windows() | ForEach-Object { [long]$_.HWND }) }
  # Phải có cửa sổ Explorer MỚI mở đúng $dir (config lưu 'C:/…', explorer.exe chỉ hiểu '\'); rồi đóng nó.
  function Expect-Explorer([long[]]$known, [string]$dir, [string]$tag) {
    try {
      $w = Wait-For { $shell.Windows() | Where-Object { $known -notcontains $_.HWND -and $_.LocationURL -and ([uri]$_.LocationURL).LocalPath -eq $dir } | Select-Object -First 1 } "Explorer mở $dir" 15
      $w.Quit(); Write-Host "[$tag] OK: Explorer mở $dir"
    } catch { Fail "[$tag] Explorer không mở đúng $dir" }
  }

  # Nút "📁 Thư mục dữ liệu" → Explorer tại ĐÚNG downloadDir.
  $known = Explorer-Handles
  Click '📁 Thư mục dữ liệu'
  Expect-Explorer $known $dataDir 'thư mục dữ liệu'

  # Nút "📋 Xuất log" → file mới trong thư mục báo cáo + mở Explorer tại đó.
  $before = @(Get-ChildItem $reportDir -Filter 'ZaloSync_log_*.txt' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  $known = Explorer-Handles
  Click '📋 Xuất log'
  $new = Wait-For { Get-ChildItem $reportDir -Filter 'ZaloSync_log_*.txt' -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.FullName } | Select-Object -First 1 } 'file xuất log' 30
  $txt = Get-Content $new.FullName -Raw -Encoding UTF8
  foreach ($sec in '## Trạng thái', '## Cấu hình (đã che khóa giải mã)', '## Log lượt chạy gần nhất') {
    if (-not $txt.Contains($sec)) { Fail "file xuất log thiếu mục '$sec'" }
  }
  if ($cfg.key -and $txt.Contains($cfg.key)) { Fail 'file xuất log làm lộ khóa giải mã' }
  Write-Host "[export] OK: $($new.Name) ($($txt.Length) ký tự)"
  Remove-Item $new.FullName
  Expect-Explorer $known $reportDir 'xuất log'

  Click '⚙ Thiết lập lại'
  Wait-For { Find-Text 'Bước 1' } 'bước 1' | Out-Null
  Check-Screen 'step1' -navButtons @('Tiếp tục →')

  Click 'Tiếp tục →'
  Wait-For { Find-Text 'Bước 2' } 'bước 2' | Out-Null
  Wait-For { Find-Button 'Tiếp tục →' } 'tự dò khóa xong' | Out-Null
  Check-Screen 'step2' -navButtons @('Tiếp tục →')

  Click 'Tiếp tục →'
  Wait-For { Find-Text 'Bước 3' } 'bước 3' | Out-Null
  Wait-For { Find-Button 'Tiếp tục →' } 'đọc xong danh sách nhóm' | Out-Null
  # "Thiết lập lại" phải giữ các nhóm đang đồng bộ, không tích lại tất cả
  if (-not (Find-Text 'Tích chọn nhóm (giữ nguyên')) { Fail "Bước 3 không giữ các nhóm đang đồng bộ ($($cfg.targetGroups.Count) nhóm)" }
  Check-Screen 'step3' -navButtons @('Tiếp tục →')

  Click 'Tiếp tục →'
  Wait-For { Find-Text 'Bước 4' } 'bước 4' | Out-Null
  # ...và điền sẵn thư mục dữ liệu đang dùng, không phải thư mục mặc định
  if (-not (Get-Leaves @('EDIT') | Where-Object { $_.Text -eq $dataDir })) { Fail "Bước 4 không điền sẵn thư mục dữ liệu đang dùng ($dataDir)" }
  Check-Screen 'step4' -navButtons @('✔ Hoàn tất & lưu')
}
finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}

Write-Host "`nẢnh chụp: $ShotDir"
if ($failures.Count -gt 0) { Write-Host "FAIL: $($failures.Count) lỗi" -ForegroundColor Red; exit 1 }
Write-Host 'PASS: bố cục + mở thư mục + xuất log + thiết lập lại đều đúng' -ForegroundColor Green
