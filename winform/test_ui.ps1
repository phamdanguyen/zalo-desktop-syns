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
#
# -Schedule: thêm kiểm thử đầu-cuối LỊCH TỰ ĐỘNG trên exe thật. CẢNH BÁO: chế độ này SỬA tác vụ ZaloSync_Daily + config.json
# thật của máy (có sao lưu → khôi phục nguyên byte trong finally, rồi mở lại app để tác vụ khớp lại giờ gốc).
#   A. tác vụ thật khớp định nghĩa (exe --scheduled, trigger Daily đúng giờ + Logon Delay PT10M, StartWhenAvailable,
#      IgnoreNew, không còn run_sync.bat); nhãn bảng điều khiển "BẬT · giờ (kế tiếp … giờ)" khớp giờ cấu hình.
#   B. nút ⏸ Tắt tự động / ⏰ Bật tự động: xoá + tạo lại tác vụ, nhãn đổi, không hiện hộp thoại lỗi.
#   C. Thiết lập lại → đổi giờ (DateTimePicker: bấm vào ô giờ rồi gửi VK_UP) → Hoàn tất: config + tác vụ + nhãn sang giờ mới.
#   D. đường lỗi phải ồn ào: chạy app với PATH không có WindowsPowerShell → bấm Bật tự động ra hộp thoại "Không bật được…",
#      tác vụ thật không đổi.
#   E. Start-ScheduledTask khi đã đồng bộ sau mốc lịch (lastSuccessAt = bây giờ) → chạy ẨN (không cửa sổ mới nào của
#      ZaloSync/node/cmd/conhost/terminal/powershell), exit 0, log có "[TỰ ĐỘNG] … bỏ qua", lastSuccessAt không đổi.
#      Không bao giờ chạy đồng bộ thật: nếu log báo "chạy (" → dừng tác vụ + giết node engine ngay và FAIL.
#   A/B còn kiểm mục Startup HKCU\...\Run\ZaloSync_Daily = "<exe>" --tray (có khi Bật, mất khi Tắt; khôi phục trong finally).
#   F. exe --tray: sống nhưng không cửa sổ nào hiện; mở exe lần nữa → bản đang chạy hiện cửa sổ, tiến trình mới thoát exit 0.
#   G. WM_QUERYENDSESSION phải trả ≠ 0 (không chặn tắt máy); bấm X (SC_CLOSE) chỉ ẩn xuống tray.
# Chạy: powershell -NoProfile -ExecutionPolicy Bypass -File winform\test_ui.ps1 -Schedule
param(
  [string]$Exe = (Join-Path $PSScriptRoot 'build\ZaloSync.exe'),
  [string]$ShotDir = (Join-Path $env:TEMP 'zalosync_layout'),
  [switch]$Schedule
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
  // --- dùng cho -Schedule: cửa sổ cấp cao đang hiện + mọi control con (kể cả hộp thoại MessageBox, lớp Static/Button) ---
  public class Top { public IntPtr H; public uint Pid; public string Cls, Title; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll", EntryPoint = "SendMessageW")] public static extern IntPtr SendMsg(IntPtr h, int m, IntPtr w, IntPtr l);
  public static List<Top> Tops() { return Tops(false); }
  public static List<Top> Tops(bool includeHidden) {
    var list = new List<Top>();
    EnumWindows((h, l) => {
      if (!includeHidden && !IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      list.Add(new Top { H = h, Pid = pid, Cls = c.ToString(), Title = t.ToString() });
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static List<Ctl> Kids(IntPtr parent) {
    var list = new List<Ctl>();
    EnumChildWindows(parent, (h, l) => {
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      var t = new StringBuilder(1024); SendMessage(h, 0x000D, (IntPtr)1024, t);
      list.Add(new Ctl { H = h, Kind = cls.ToString(), Text = t.ToString(), Enabled = IsWindowEnabled(h) });
      return true;
    }, IntPtr.Zero);
    return list;
  }
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
$AppDir = Join-Path $env:LOCALAPPDATA 'ZaloSync'
if ($Schedule) {
  # sao lưu TRƯỚC khi mở exe (app tự đối soát tác vụ khi khởi động); khôi phục trong finally
  $Backup = Join-Path $env:TEMP ('zalosync_sched_backup_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
  New-Item -ItemType Directory -Force $Backup | Out-Null
  Copy-Item (Join-Path $AppDir 'config.json') $Backup
  $hasState = Test-Path (Join-Path $AppDir 'state.json')
  if ($hasState) { Copy-Item (Join-Path $AppDir 'state.json') $Backup }
  $hadTask = [bool](Get-ScheduledTask -TaskName 'ZaloSync_Daily' -ErrorAction SilentlyContinue)
  if ($hadTask) { $taskXml = Export-ScheduledTask -TaskName 'ZaloSync_Daily'; [IO.File]::WriteAllText((Join-Path $Backup 'task.xml'), $taskXml) }
  $runData = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'ZaloSync_Daily' -ErrorAction SilentlyContinue).ZaloSync_Daily   # mục Startup (null = chưa có)
  Write-Host "[schedule] mục Run ZaloSync_Daily trước test: $runData"
  Write-Host "[schedule] sao lưu config/state/task → $Backup (task có sẵn: $hadTask)"
}
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

function Save-Shot([string]$name, [IntPtr]$hwnd = $h) {
  $r = New-Object W+RECT; [W]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
  [W]::PrintWindow($hwnd, $dc, 2) | Out-Null
  $g.ReleaseHdc($dc); $g.Dispose()
  $bmp.Save((Join-Path $ShotDir "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

function Fail([string]$msg) { $failures.Add($msg); Write-Host "  ✗ $msg" -ForegroundColor Red }

# ---------- tiện ích cho -Schedule ----------
$TaskName = 'ZaloSync_Daily'
$CfgFile = Join-Path $AppDir 'config.json'
$StateFile = Join-Path $AppDir 'state.json'
$LogFile = Join-Path $AppDir 'logs\daily_sync.log'
$MeUser = "$env:USERDOMAIN\$env:USERNAME"
function Wait-Soft([scriptblock]$cond, [string]$what, [int]$sec = 20) { try { Wait-For $cond $what $sec } catch { $null } }
function Get-Task { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
function Get-RunValue { (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $TaskName -ErrorAction SilentlyContinue).$TaskName }
function Get-CfgTime { ((Get-Content $CfgFile -Raw -Encoding UTF8) | ConvertFrom-Json)._app.scheduleTime }
function Get-DailyTime {
  $t = Get-Task; if (-not $t) { return $null }
  $d = @($t.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger' }) | Select-Object -First 1
  if ($d -and $d.StartBoundary -match 'T(\d\d:\d\d)') { $Matches[1] }
}
# Tác vụ thật phải khớp định nghĩa: <exe> --scheduled, Daily đúng giờ + Logon(user hiện tại, Delay PT10M), StartWhenAvailable, IgnoreNew, không admin.
function Check-Task([string]$tag, [string]$time) {
  $t = Get-Task
  if (-not $t) { Fail "[$tag] không thấy tác vụ $TaskName"; return }
  $a = @($t.Actions)[0]
  if (([string]$a.Execute).Trim('"') -ine [IO.Path]::GetFullPath($Exe)) { Fail "[$tag] exe của tác vụ: '$($a.Execute)' ≠ '$([IO.Path]::GetFullPath($Exe))'" }
  if ($a.Arguments -ne '--scheduled') { Fail "[$tag] tham số của tác vụ: '$($a.Arguments)'" }
  $daily = @($t.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger' })
  $logon = @($t.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' })
  if ($daily.Count -ne 1) { Fail "[$tag] cần đúng 1 trigger Daily (có $($daily.Count))" }
  elseif ((Get-DailyTime) -ne $time) { Fail "[$tag] giờ trigger Daily: '$(Get-DailyTime)' ≠ '$time'" }
  if ($logon.Count -ne 1) { Fail "[$tag] cần đúng 1 trigger Logon (có $($logon.Count))" }
  else {
    if ($logon[0].UserId -ine $MeUser) { Fail "[$tag] Logon.UserId '$($logon[0].UserId)' ≠ '$MeUser'" }
    if ($logon[0].Delay -ne 'PT10M') { Fail "[$tag] Logon.Delay '$($logon[0].Delay)' ≠ PT10M" }
  }
  if ($t.Settings.StartWhenAvailable -ne $true) { Fail "[$tag] StartWhenAvailable không bật" }
  if ("$($t.Settings.MultipleInstances)" -ne 'IgnoreNew') { Fail "[$tag] MultipleInstances = '$($t.Settings.MultipleInstances)'" }
  if ("$($t.Principal.LogonType)" -ne 'Interactive') { Fail "[$tag] LogonType = '$($t.Principal.LogonType)'" }
  if ("$($t.Principal.RunLevel)" -eq 'Highest') { Fail "[$tag] tác vụ chạy quyền admin (RunLevel Highest)" }
  if (Test-Path (Join-Path $AppDir 'run_sync.bat')) { Fail "[$tag] vẫn còn run_sync.bat" }
  $wantRun = '"' + [IO.Path]::GetFullPath($Exe) + '" --tray'
  if ((Get-RunValue) -ne $wantRun) { Fail "[$tag] mục Startup Run\$TaskName = '$(Get-RunValue)' ≠ '$wantRun'" }
}
# Nhãn bảng điều khiển: BẬT · <giờ> (kế tiếp dd/MM/yyyy <giờ>) — giờ "kế tiếp" phải đúng giờ cấu hình (không lệch +7h).
function Check-Label([string]$tag, [string]$time) {
  $rx = "Tự động hằng ngày: BẬT · $time\s+\(kế tiếp \d\d/\d\d/\d{4} $time\)"
  $l = Wait-Soft { $x = Find-Text 'Số nhóm theo dõi'; if ($x -and $x.Text -match $rx) { $x } } "nhãn lịch BẬT $time" 20
  if (-not $l) { Fail "[$tag] nhãn lịch không khớp /$rx/: '$((Find-Text 'Số nhóm theo dõi').Text -replace '\s+', ' ')'" }
  else { Write-Host "[$tag] OK nhãn: $(($l.Text -split "`n")[1].Trim())" }
}
function Check-LabelOff([string]$tag) {
  $l = Wait-Soft { $x = Find-Text 'Số nhóm theo dõi'; if ($x -and $x.Text -match 'Tự động hằng ngày: TẮT') { $x } } 'nhãn lịch TẮT' 20
  if (-not $l) { Fail "[$tag] nhãn lịch không là TẮT: '$((Find-Text 'Số nhóm theo dõi').Text -replace '\s+', ' ')'" }
}
# Hộp thoại MessageBox (#32770) của tiến trình app
function Get-Dialogs([int]$procId) { @([W]::Tops() | Where-Object { $_.Pid -eq $procId -and $_.Cls -eq '#32770' }) }
function Dialog-Text($d) { (@([W]::Kids($d.H) | Where-Object { $_.Kind -eq 'Static' -and $_.Text } | ForEach-Object { $_.Text }) -join "`n") }
function Close-Dialog($d) {
  $ok = [W]::Kids($d.H) | Where-Object { $_.Kind -eq 'Button' } | Select-Object -First 1
  if ($ok) { [W]::PostMessage($ok.H, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null } else { [W]::PostMessage($d.H, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
  Start-Sleep -Milliseconds 500
}
function Expect-NoDialog([string]$tag) {
  Start-Sleep -Milliseconds 1500
  foreach ($d in (Get-Dialogs $proc.Id)) { Save-Shot "$tag-hop-thoai" $d.H; Fail "[$tag] hộp thoại bất ngờ '$($d.Title)': $(Dialog-Text $d)"; Close-Dialog $d }
}
function Wait-Dashboard {
  Wait-For { $proc.Refresh(); $proc.MainWindowHandle -ne 0 } 'cửa sổ chính' 60 | Out-Null
  $script:h = $proc.MainWindowHandle
  Wait-For { Find-Text 'Số nhóm theo dõi' } 'bảng điều khiển' | Out-Null
  Wait-For { Get-Leaves @('BUTTON') | Where-Object { $_.Text -match '(Bật|Tắt) tự động$' } } 'nút lịch' | Out-Null
}
function Stop-App { Get-Process ZaloSync -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Milliseconds 800 }
# Khôi phục config/state nguyên byte + tác vụ, rồi mở lại app để tự đối soát tác vụ về giờ gốc (chạy trong finally).
function Restore-Schedule {
  Write-Host '[schedule] khôi phục config/state/tác vụ…'
  Stop-App
  Copy-Item (Join-Path $Backup 'config.json') $CfgFile -Force
  if ($hasState) { Copy-Item (Join-Path $Backup 'state.json') $StateFile -Force }
  foreach ($f in 'config.json', 'state.json') {
    if (($f -eq 'state.json') -and -not $hasState) { continue }
    if ((Get-FileHash (Join-Path $Backup $f)).Hash -ne (Get-FileHash (Join-Path $AppDir $f)).Hash) { Fail "[restore] $f chưa khớp bản sao lưu" }
  }
  $rk = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if ($null -ne $runData) { Set-ItemProperty $rk -Name $TaskName -Value $runData } else { Remove-ItemProperty $rk -Name $TaskName -ErrorAction SilentlyContinue }
  if (-not $hadTask) { if (Get-Task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }; return }
  if (-not (Get-Task)) { Register-ScheduledTask -Xml $taskXml -TaskName $TaskName -User $MeUser -Force | Out-Null; Write-Host '[restore] đăng ký lại tác vụ từ XML sao lưu' }
  $script:proc = Start-Process $Exe -PassThru
  Wait-Dashboard
  $want = Get-CfgTime
  Wait-Soft { (Get-DailyTime) -eq $want } "tác vụ về giờ $want" 30 | Out-Null
  Start-Sleep -Milliseconds 1000
  Stop-App
  Check-Task 'restore' $want
  Write-Host "[restore] mục Run: trước test '$runData' → sau khi app đối soát '$(Get-RunValue)'"
  Write-Host "[restore] tác vụ: $((Get-Task).Actions[0].Execute) $((Get-Task).Actions[0].Arguments), Daily $(Get-DailyTime)"
}

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

  if ($Schedule) {
    $cfgTime = Get-CfgTime
    # A. tác vụ thật + nhãn khớp định nghĩa
    Check-Task 'A' $cfgTime
    Check-Label 'A' $cfgTime
    Save-Shot 'A-dashboard'
    Write-Host "[A] tác vụ + nhãn khớp (giờ cấu hình $cfgTime)"

    # B. Tắt → tác vụ biến mất, nhãn TẮT; Bật → tạo lại đủ định nghĩa; cả hai không hiện hộp thoại
    Click '⏸ Tắt tự động'
    if (-not (Wait-Soft { Find-Button '⏰ Bật tự động' } 'nút đổi sang Bật' 30)) { Fail '[B] sau khi Tắt, nút không đổi thành "⏰ Bật tự động"' }
    if (-not (Wait-Soft { -not (Get-Task) } 'tác vụ bị xoá' 15)) { Fail '[B] bấm Tắt nhưng tác vụ vẫn còn' }
    Check-LabelOff 'B-tat'
    if (Get-RunValue) { Fail "[B] bấm Tắt nhưng mục Startup Run còn: $(Get-RunValue)" }
    Save-Shot 'B-tat'
    Expect-NoDialog 'B-tat'
    Click '⏰ Bật tự động'
    if (-not (Wait-Soft { Find-Button '⏸ Tắt tự động' } 'nút đổi sang Tắt' 30)) { Fail '[B] sau khi Bật, nút không đổi thành "⏸ Tắt tự động"' }
    Check-Task 'B-bat' $cfgTime
    Check-Label 'B-bat' $cfgTime
    Save-Shot 'B-bat'
    Expect-NoDialog 'B-bat'
    Write-Host '[B] Tắt/Bật tự động đúng'
  }

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

  if ($Schedule) {
    # C. đổi giờ ở Bước 4: DateTimePicker (UpDown, mặc định ô giờ) — bấm chuột vào ô giờ rồi gửi VK_UP tới control
    $dp = Get-Leaves @('SysDateTimePick32') | Select-Object -First 1
    if (-not $dp) { throw 'Bước 4 không có SysDateTimePick32' }
    $t0 = [datetime]::Parse($dp.Text).ToString('HH:mm')
    $want = [datetime]::Parse($dp.Text).AddHours(1).ToString('HH:mm')
    [W]::SetForegroundWindow($h) | Out-Null
    [W]::PostMessage($dp.H, 0x0201, [IntPtr]1, [IntPtr](8 * 65536 + 10)) | Out-Null   # WM_LBUTTONDOWN (10,8) → chọn ô giờ
    [W]::PostMessage($dp.H, 0x0202, [IntPtr]::Zero, [IntPtr](8 * 65536 + 10)) | Out-Null
    Start-Sleep -Milliseconds 300
    [W]::PostMessage($dp.H, 0x0100, [IntPtr]0x26, [IntPtr]1) | Out-Null               # WM_KEYDOWN VK_UP
    [W]::PostMessage($dp.H, 0x0101, [IntPtr]0x26, [IntPtr]0xC0000001) | Out-Null      # WM_KEYUP
    Start-Sleep -Milliseconds 400
    $now = [datetime]::Parse((Get-Leaves @('SysDateTimePick32') | Select-Object -First 1).Text).ToString('HH:mm')
    if ($now -ne $want) { Fail "[C] DateTimePicker: '$t0' → '$now', mong đợi '$want'" }
    Write-Host "[C] DateTimePicker $t0 → $now"
    Save-Shot 'C-step4-doi-gio'
    Click '✔ Hoàn tất & lưu'
    $newTime = $now
    if (-not (Wait-Soft { Find-Text 'Số nhóm theo dõi' } 'bảng điều khiển sau khi lưu' 60)) { Fail '[C] không về bảng điều khiển sau Hoàn tất' }
    Check-Label 'C' $newTime
    Expect-NoDialog 'C'
    if ((Get-CfgTime) -ne $newTime) { Fail "[C] config _app.scheduleTime = '$(Get-CfgTime)' ≠ '$newTime'" }
    Check-Task 'C' $newTime
    Save-Shot 'C-dashboard'
    Write-Host "[C] đổi giờ ${t0} → ${newTime}: config + tác vụ + nhãn đều theo giờ mới"

    # D. đường lỗi: PATH không có WindowsPowerShell → mọi lệnh Task Scheduler của CLI phải hỏng và app phải báo ra
    Stop-App
    $xmlBefore = Export-ScheduledTask -TaskName $TaskName
    $psi = New-Object System.Diagnostics.ProcessStartInfo $Exe
    $psi.UseShellExecute = $false
    $psi.EnvironmentVariables['PATH'] = 'C:\Windows\System32;C:\Windows'
    $proc = [System.Diagnostics.Process]::Start($psi)
    Wait-Dashboard
    # nút Bật/Tắt hiện ra TRƯỚC khi handler Click được gắn (ShowDashboard gắn sau khi nạp log) → chờ log nạp xong kẻo mất cú bấm
    Wait-Soft { Get-Leaves @('EDIT') | Where-Object { $_.Text.Length -gt 0 } } 'log' 20 | Out-Null; Start-Sleep -Milliseconds 700
    if (-not (Find-Button '⏰ Bật tự động')) { Fail '[D] khi truy vấn lịch hỏng, nút phải là "⏰ Bật tự động"' }
    Click '⏰ Bật tự động'
    $dlg = Wait-Soft { Get-Dialogs $proc.Id | Select-Object -First 1 } 'hộp thoại lỗi' 30
    if (-not $dlg) {
      Fail '[D] bấm Bật khi đăng ký hỏng nhưng KHÔNG hiện hộp thoại'
      Save-Shot 'D-khong-co-hop-thoai'
      Write-Host "  [D-chẩn đoán] nút: $((Get-Leaves @('BUTTON') | ForEach-Object { $_.Text }) -join ' | ')"
      Write-Host "  [D-chẩn đoán] nhãn: $((Find-Text 'Số nhóm theo dõi').Text -replace 's+', ' ')"
      Write-Host "  [D-chẩn đoán] cửa sổ: $(([W]::Tops($true) | Where-Object { $_.Pid -eq $proc.Id } | ForEach-Object { "[$($_.Cls)] '$($_.Title)'" }) -join '; ')"
    }
    else {
      $dt = Dialog-Text $dlg
      Save-Shot 'D-hop-thoai-loi' $dlg.H
      if (-not $dt.Contains('Không bật được lịch chạy tự động')) { Fail "[D] hộp thoại sai nội dung: '$($dlg.Title)' / $dt" }
      else { Write-Host "[D] OK hộp thoại '$($dlg.Title)': $(($dt -split "`n")[0..1] -join ' | ')" }
      Close-Dialog $dlg
    }
    if ((Export-ScheduledTask -TaskName $TaskName) -ne $xmlBefore) { Fail '[D] tác vụ thật bị đổi dù đăng ký lỗi' }
    Stop-App

    # E. tác vụ chạy ẨN, nhánh bỏ qua (lastSuccessAt = bây giờ → không đến hạn → KHÔNG đồng bộ thật)
    if (-not (Get-Task)) { Fail '[E] không có tác vụ để chạy' }
    else {
      $st = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
      $st | Add-Member -NotePropertyName lastSuccessAt -NotePropertyValue $stamp -Force
      [IO.File]::WriteAllText($StateFile, ($st | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
      $logLen0 = if (Test-Path $LogFile) { (Get-Item $LogFile).Length } else { 0 }
      function Read-NewLog { if (-not (Test-Path $LogFile)) { return '' }
        $fs = [IO.File]::Open($LogFile, 'Open', 'Read', 'ReadWrite'); try { [void]$fs.Seek($logLen0, 'Begin'); $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8); $sr.ReadToEnd() } finally { $fs.Dispose() } }
      $seen = @{}; foreach ($w in [W]::Tops()) { $seen[[string]$w.H] = 1 }
      $badProcs = 'ZaloSync', 'node', 'cmd', 'conhost', 'OpenConsole', 'WindowsTerminal', 'powershell'
      $startAt = Get-Date
      $ti0 = Get-ScheduledTaskInfo -TaskName $TaskName; Write-Host "[E] trước khi chạy: state=$((Get-Task).State) LastRunTime=$($ti0.LastRunTime.ToString("HH:mm:ss")) result=$($ti0.LastTaskResult)"
      Start-ScheduledTask -TaskName $TaskName
      $sw = [Diagnostics.Stopwatch]::StartNew(); $sawRun = $false; $newLog = ''
      while ($sw.Elapsed.TotalSeconds -lt 60) {
        foreach ($w in [W]::Tops()) {
          if ($seen.ContainsKey([string]$w.H)) { continue }
          $seen[[string]$w.H] = 1
          $pn = (Get-Process -Id $w.Pid -ErrorAction SilentlyContinue).ProcessName
          if ($badProcs -contains $pn) { Fail "[E] lượt chạy tự động hiện cửa sổ: $pn '$($w.Title)' [$($w.Cls)]" }
        }
        $newLog = Read-NewLog
        if ($newLog -match 'chạy \(') {   # khẩn cấp: sắp đồng bộ thật
          Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
          Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'daily_sync_568\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
          Fail '[E] log báo "chạy (" dù lastSuccessAt = bây giờ → đã dừng tác vụ + giết engine'
          break
        }
        $state = "$((Get-Task).State)"
        if ($state -ne 'Ready') { $sawRun = $true }
        if ($state -eq 'Ready' -and ($sawRun -or $newLog.Contains('bỏ qua'))) { break }
        Start-Sleep -Milliseconds 100
      }
      if ($sw.Elapsed.TotalSeconds -ge 60) { Fail '[E] hết 60s mà tác vụ chưa về Ready' }
      $newLog = Read-NewLog
      if ($newLog -notmatch '\[TỰ ĐỘNG\].*bỏ qua — vừa đồng bộ thành công') { Fail "[E] log không có dòng '[TỰ ĐỘNG] … bỏ qua': '$($newLog.Trim())'" }
      # LastTaskResult trước lượt này là 267011 (chưa chạy) nên "= 0" nghĩa là lượt vừa rồi đã kết thúc OK (không dựa LastRunTime: thấy lệch giờ thất thường)
      $r = Wait-Soft { $i = Get-ScheduledTaskInfo -TaskName $TaskName; if ($i.LastTaskResult -eq 0) { $i } } 'LastTaskResult = 0' 15
      if (-not $r) { Fail "[E] LastTaskResult = $((Get-ScheduledTaskInfo -TaskName $TaskName).LastTaskResult), mong đợi 0" }
      $st2 = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($st2.lastSuccessAt -ne $stamp) { Fail "[E] lastSuccessAt đổi: $stamp → $($st2.lastSuccessAt)" }
      if (Get-Process ZaloSync -ErrorAction SilentlyContinue) { Fail '[E] còn tiến trình ZaloSync sau khi tác vụ xong' }
      Write-Host "[E] chạy ẩn trong $([int]$sw.Elapsed.TotalMilliseconds) ms, exit $($r.LastTaskResult); log: $(($newLog.Trim() -split "`n")[-1])"
    }

    # F. khởi động --tray: chạy ẩn (không cửa sổ/nút taskbar); mở lại exe → bản đang chạy hiện cửa sổ, tiến trình mới tự thoát (1 instance)
    $appTitle = 'Zalo Sync — Trình thu thập dữ liệu nhóm'
    function Get-Vis([int]$procId) { @([W]::Tops() | Where-Object { $_.Pid -eq $procId }) }
    function Start-Probe([string]$argLine) {
      $p = if ($argLine) { Start-Process $Exe -ArgumentList $argLine -PassThru } else { Start-Process $Exe -PassThru }
      $null = $p.Handle   # giữ handle để đọc được ExitCode
      $p
    }
    Stop-App
    $p1 = Start-Probe '--tray'
    Start-Sleep -Seconds 9
    if ($p1.HasExited) { Fail "[F] --tray: tiến trình thoát sớm (exit $($p1.ExitCode))" }
    $vis = Get-Vis $p1.Id
    if ($vis) { Fail "[F] --tray: có cửa sổ hiện: $(($vis | ForEach-Object { "'$($_.Title)' [$($_.Cls)]" }) -join ', ')" }
    else { Write-Host '[F] --tray: sống, không có cửa sổ cấp cao nào đang hiện' }

    $p2 = Start-Probe $null
    if (-not $p2.WaitForExit(10000)) { Fail '[F] mở exe lần 2 (không tham số): tiến trình mới không tự thoát trong 10s'; $p2.Kill() }
    elseif ($p2.ExitCode -ne 0) { Fail "[F] mở exe lần 2: exit $($p2.ExitCode) ≠ 0" }
    $win = Wait-Soft { Get-Vis $p1.Id | Where-Object { $_.Cls -notmatch '^#32770$' -and $_.Title -eq $appTitle } | Select-Object -First 1 } 'cửa sổ của bản đầu hiện ra' 10
    if (-not $win) { Fail "[F] bản đang chạy không hiện cửa sổ '$appTitle' sau khi mở lại exe" }
    else { Save-Shot 'F-hien-tu-tray' $win.H; Write-Host "[F] cửa sổ hiện: '$($win.Title)'" }

    $p3 = Start-Probe '--tray'
    if (-not $p3.WaitForExit(10000)) { Fail '[F] --tray lần 2: không tự thoát trong 10s'; $p3.Kill() }
    elseif ($p3.ExitCode -ne 0) { Fail "[F] --tray lần 2: exit $($p3.ExitCode) ≠ 0" }
    $all = @(Get-Process ZaloSync -ErrorAction SilentlyContinue)
    if ($all.Count -ne 1 -or $all[0].Id -ne $p1.Id) { Fail "[F] phải còn đúng 1 tiến trình ZaloSync (pid $($p1.Id)); đang có: $(($all | ForEach-Object { $_.Id }) -join ',')" }
    else { Write-Host '[F] 1 instance: exe lần 2 + --tray lần 2 đều tự thoát (exit 0)' }

    # G. tắt máy/đăng xuất không bị chặn; đóng bằng người dùng (WM_CLOSE) chỉ ẩn xuống tray
    if (-not $win) { Fail '[G] không kiểm được: F không hiện được cửa sổ' }
    if ($win) {
      # bấm X (SC_CLOSE) TRƯỚC: WinForms ghi nhớ CloseReason.WindowsShutDown sau WM_QUERYENDSESSION nên đảo thứ tự sẽ cho kết quả sai
      [W]::PostMessage($win.H, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero) | Out-Null   # WM_SYSCOMMAND SC_CLOSE = bấm X (WM_CLOSE trần bị WinForms coi là TaskManagerClosing → thoát, đúng thiết kế)
      Start-Sleep -Milliseconds 2000
      if ($p1.HasExited) { Fail '[G] bấm X (SC_CLOSE) làm app thoát thay vì ẩn xuống tray' }
      elseif (Get-Vis $p1.Id) { Fail '[G] sau SC_CLOSE cửa sổ vẫn hiện' }
      else { Write-Host '[G] SC_CLOSE: app sống, cửa sổ đã ẩn xuống tray' }
      $hw = [W]::Tops($true) | Where-Object { $_.Pid -eq $p1.Id -and $_.Title -eq $appTitle } | Select-Object -First 1   # ShowInTaskbar đổi → HWND bị tạo lại, phải dò lại
      if (-not $hw) { Fail "[G] không tìm thấy cửa sổ chính (ẩn) của app" }
      $rv = [W]::SendMsg($hw.H, 0x0011, [IntPtr]::Zero, [IntPtr]2147483648L)   # WM_QUERYENDSESSION, ENDSESSION_LOGOFF
      Write-Host "[G] WM_QUERYENDSESSION trả về $rv"
      if ([long]$rv -eq 0) { Fail '[G] WM_QUERYENDSESSION trả về 0 → app CHẶN tắt máy/đăng xuất' }
    }
    Stop-App
    if (Get-Process ZaloSync -ErrorAction SilentlyContinue) { Fail '[F/G] còn tiến trình ZaloSync sau khi dọn' }
  }
}
finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  if ($Schedule) { try { Restore-Schedule } catch { Fail "[restore] $($_.Exception.Message)" } }
}

Write-Host "`nẢnh chụp: $ShotDir"
if ($failures.Count -gt 0) { Write-Host "FAIL: $($failures.Count) lỗi" -ForegroundColor Red; exit 1 }
Write-Host 'PASS: bố cục + mở thư mục + xuất log + thiết lập lại đều đúng' -ForegroundColor Green
if ($Schedule) { Write-Host 'PASS (-Schedule): A tác vụ+nhãn khớp · B tắt/bật · C đổi giờ qua thiết lập lại · D lỗi báo rõ · E chạy ẩn bỏ qua · F --tray + 1 instance · G tắt máy không bị chặn (đã khôi phục config/state/tác vụ)' -ForegroundColor Green }
