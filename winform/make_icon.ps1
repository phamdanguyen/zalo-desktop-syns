# make_icon.ps1 — Vẽ lại biểu tượng app.ico của Zalo Sync (ô vuông cam + chữ Z + 2 mũi tên đồng bộ).
# Nhiều cỡ để khay hệ thống/Explorer/thanh tác vụ đều nét: 16–64 px dạng DIB 32-bit, 256 px dạng PNG.
# Chạy: powershell -NoProfile -ExecutionPolicy Bypass -File winform\make_icon.ps1 [-Preview <file.png>]
param(
  [string]$Out = (Join-Path $PSScriptRoot 'app.ico'),
  [string]$Preview
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$Sizes = 16, 20, 24, 32, 40, 48, 64, 256
$Orange = [System.Drawing.Color]::FromArgb(255, 122, 26)   # = ACCENT trong Program.cs
$White = [System.Drawing.Color]::White

function New-RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); $p
}

# Mũi tên ở cuối cung tròn (góc $deg, chiều kim đồng hồ), tâm ($c,$c) bán kính $R
function Add-ArrowHead($g, [single]$c, [single]$R, [single]$deg, [single]$w) {
  $t = $deg * [math]::PI / 180
  $px = $c + $R * [math]::Cos($t); $py = $c + $R * [math]::Sin($t)
  $tx = -[math]::Sin($t); $ty = [math]::Cos($t)     # tiếp tuyến (chiều quay)
  $nx = [math]::Cos($t); $ny = [math]::Sin($t)      # pháp tuyến (hướng ra ngoài)
  $len = 1.9 * $w; $half = 1.45 * $w
  $pts = @(
    (New-Object System.Drawing.PointF(($px + $tx * $len), ($py + $ty * $len))),
    (New-Object System.Drawing.PointF(($px + $nx * $half - $tx * 0.15 * $w), ($py + $ny * $half - $ty * 0.15 * $w))),
    (New-Object System.Drawing.PointF(($px - $nx * $half - $tx * 0.15 * $w), ($py - $ny * $half - $ty * 0.15 * $w)))
  )
  $b = New-Object System.Drawing.SolidBrush $White
  $g.FillPolygon($b, [System.Drawing.PointF[]]$pts); $b.Dispose()
}

function New-IconBitmap([int]$s) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([System.Drawing.Color]::Transparent)

  # nền: ô vuông bo góc màu cam (lề nhỏ như icon hệ thống)
  $m = [math]::Max(0.5, $s * 0.03)
  $bg = New-RoundRect $m $m ($s - 2 * $m) ($s - 2 * $m) ($s * 0.18)
  $ob = New-Object System.Drawing.SolidBrush $Orange; $g.FillPath($ob, $bg); $ob.Dispose()

  # 2 cung tròn đồng bộ + mũi tên. ≤ 24 px (khay hệ thống) không đủ chỗ → chỉ chữ Z to cho dễ nhận.
  $c = $s / 2.0
  $simple = $s -le 24
  if (-not $simple) {
    $R = $s * 0.305
    $w = $s * 0.085
    $pen = New-Object System.Drawing.Pen $White, $w
    $sweep = 118
    foreach ($start in 200, 20) {
      $g.DrawArc($pen, ($c - $R), ($c - $R), (2 * $R), (2 * $R), $start, $sweep)
      Add-ArrowHead $g $c $R ($start + $sweep) $w
    }
    $pen.Dispose()
  }

  # chữ Z ở giữa — căn theo khung thật của nét chữ (không theo hộp font)
  $zp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $ff = New-Object System.Drawing.FontFamily 'Segoe UI'
  $em = if ($simple) { $s * 0.92 } else { $s * 0.44 }
  $zp.AddString('Z', $ff, [int][System.Drawing.FontStyle]::Bold, $em, (New-Object System.Drawing.PointF(0, 0)), [System.Drawing.StringFormat]::GenericTypographic)
  $bb = $zp.GetBounds()
  $mx = New-Object System.Drawing.Drawing2D.Matrix
  $mx.Translate(($c - $bb.X - $bb.Width / 2), ($c - $bb.Y - $bb.Height / 2))
  $zp.Transform($mx)
  $wb = New-Object System.Drawing.SolidBrush $White; $g.FillPath($wb, $zp); $wb.Dispose()
  $zp.Dispose(); $ff.Dispose(); $bg.Dispose(); $g.Dispose()
  $bmp
}

# Ảnh 1 cỡ trong file .ico: 256 → PNG; nhỏ hơn → DIB 32-bit (BGRA từ dưới lên + mặt nạ AND 1-bit)
function Get-IconImageBytes($bmp) {
  $s = $bmp.Width
  $ms = New-Object System.IO.MemoryStream
  if ($s -ge 256) { $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); return , $ms.ToArray() }
  $rect = New-Object System.Drawing.Rectangle 0, 0, $s, $s
  $data = $bmp.LockBits($rect, 'ReadOnly', ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb))
  $px = New-Object byte[] ($s * $s * 4)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $px, 0, $px.Length)
  $bmp.UnlockBits($data)
  $maskStride = [int]([math]::Floor(($s + 31) / 32) * 4)
  $mask = New-Object byte[] ($maskStride * $s)
  $bw = New-Object System.IO.BinaryWriter $ms
  $bw.Write([int]40); $bw.Write([int]$s); $bw.Write([int](2 * $s)); $bw.Write([int16]1); $bw.Write([int16]32)
  $bw.Write([int]0); $bw.Write([int]($px.Length + $mask.Length)); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)
  for ($y = $s - 1; $y -ge 0; $y--) {
    $bw.Write($px, $y * $s * 4, $s * 4)
    $row = ($s - 1 - $y) * $maskStride
    for ($x = 0; $x -lt $s; $x++) { if ($px[($y * $s + $x) * 4 + 3] -eq 0) { $mask[$row + [math]::Floor($x / 8)] = $mask[$row + [math]::Floor($x / 8)] -bor (0x80 -shr ($x % 8)) } }
  }
  $bw.Write($mask); $bw.Flush()
  , $ms.ToArray()
}

$bitmaps = foreach ($s in $Sizes) { New-IconBitmap $s }
$images = foreach ($b in $bitmaps) { , (Get-IconImageBytes $b) }

$fs = [System.IO.File]::Create($Out)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([int16]0); $w.Write([int16]1); $w.Write([int16]$Sizes.Count)
$offset = 6 + 16 * $Sizes.Count
for ($i = 0; $i -lt $Sizes.Count; $i++) {
  $s = $Sizes[$i]; $len = $images[$i].Length
  $w.Write([byte]($s % 256)); $w.Write([byte]($s % 256)); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([int16]1); $w.Write([int16]32); $w.Write([int]$len); $w.Write([int]$offset)
  $offset += $len
}
foreach ($img in $images) { $w.Write($img) }
$w.Close()
Write-Host ("OK: {0}  ({1} cỡ: {2})" -f $Out, $Sizes.Count, ($Sizes -join ', ')) -ForegroundColor Green

# Ảnh xem trước: mọi cỡ phóng to x4 (pixel nguyên, thấy rõ độ nét) + bản 256 gốc
if ($Preview) {
  $small = $Sizes | Where-Object { $_ -lt 256 }
  $W = [int](20 + ($small | ForEach-Object { $_ * 4 + 20 } | Measure-Object -Sum).Sum + 276)
  $sheet = New-Object System.Drawing.Bitmap $W, 296
  $g = [System.Drawing.Graphics]::FromImage($sheet); $g.Clear([System.Drawing.Color]::FromArgb(15, 20, 25))
  $g.InterpolationMode = 'NearestNeighbor'; $g.PixelOffsetMode = 'Half'
  $x = 20
  for ($i = 0; $i -lt $Sizes.Count; $i++) {
    $s = $Sizes[$i]
    if ($s -ge 256) { $g.DrawImage($bitmaps[$i], $x, 20, 256, 256) } else { $g.DrawImage($bitmaps[$i], $x, 20, $s * 4, $s * 4); $x += $s * 4 + 20 }
  }
  $g.Dispose(); $sheet.Save($Preview, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "Xem trước: $Preview"
}
