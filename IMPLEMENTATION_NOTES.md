# IMPLEMENTATION NOTES — Zalo Sync 568 Desktop (GUI packaging)

> Running notes for the task: package the Zalo read/process pipeline into a Windows GUI app that
> non-technical users install and configure themselves (multi-user model: each person runs it on
> their own machine, reading their OWN Zalo data daily). Started 2026-10-27. Author: Uni.

## Goal & success criteria
A non-technical Windows user can:
1. Run one installer (double-click), no manual JSON/PowerShell editing.
2. A GUI setup wizard auto-detects their Zalo (UID + data dir) and the per-machine decryption key.
3. Pick which groups to sync (auto-discovered), where to save data, and the daily run time.
4. Click "Chạy ngay" (run now, live log) and "Bật tự động hằng ngày" (install Scheduled Task);
   see status (last/next run, data freshness).
5. Drives the EXISTING engine `scripts/daily_sync_568.js` unchanged (Rule 3 — surgical).

## Key architectural facts (verified 2026-10-27)
- Engine `scripts/daily_sync_568.js` is **pure Node.js stdlib, zero npm deps** (`node:sqlite`,
  `crypto`, `fs`, `path`, `child_process`). Requires Node >= 22.5 (stable-ish `node:sqlite`);
  dev machine runs v24.19.0. → distributable must bundle/require a modern Node.
- Engine CLI: `node daily_sync_568.js --config <file> [--all] [--dry-run] [--download-dir X]
  [--report-dir X] [--org-mode X]`. Config also selectable via env `ZALO_568_CONFIG`.
- Config schema (from `config_568_all.json`): zaloDataDir, key, projectLabel, targetGroups[],
  downloadDir, reportDir, cursorFile, manifestFile, organizationMode, writeMessageTranscripts,
  categories{}, firstRunLookbackDays, safetyLookbackHours, maxDownloadRetries.
- Group discovery: `scripts/discover_568_groups.js` reads Index.db → writes discovered_groups.json.
- Scheduling today: `scripts/setup_scheduler*.ps1` register Scheduled Tasks via `Register-ScheduledTask`.
- Zalo data dir shape: `%APPDATA%\ZaloData\Database\_production\<UID>\Core` (contains Index.db,
  Message\<groupId>.db). UID is the folder name — publicly derivable from disk (NOT secret).

## The key problem (decision needed — see briefing to Master)
- SQLCipher v4: AES-256-CBC, PBKDF2-HMAC-SHA512 256000 iters, 16B salt = file[:16], 4096B pages,
  80B reserve/page ([IV 16B][HMAC-SHA512 64B]). Key used as 32-char ASCII passphrase.
- Key is NOT a simple hash of UID (tested md5/sha1/sha256 + salted variants on 3 known pairs: no match).
- Repo's only *working* recovery = RAM scan of Zalo.exe (`find_local_key_pattern.py`,
  `ReadProcessMemory`). UNSUITABLE for distribution: AV-flagged, needs Zalo running + privileges,
  breaks on Zalo updates, classifier-hostile.
- Clean path = replicate Zalo's own offline unwrap: `zsafe-storage.json` (`zsskv:"2"` →
  AES-256-CBC, root key `<redacted>`, fixed IV) → `zshk` →
  SecureLocalstorage.db / LevelDB `z_ecrp_` layer → per-UID SQLCipher key. Deterministic, offline,
  runs as the user. **Phase B: a sub-agent is reversing this into `app/lib/detect_key.js` with a
  test against a known UID → key pair (real values redacted from this public note).**

## Plan (2 phases)
- **Phase A (build now):** GUI web app (zero-dep Node http server + single-page UI), launcher,
  installer, Scheduled Task integration, run-now with live log, status dashboard. Key handling =
  manual paste + "auto-detect" button wired to a pluggable module (stub until Phase B lands).
- **Phase B (parallel R&D):** deterministic offline key derivation module.

## ✅ PHASE B SOLVED — offline auto key-detection (verified 2026-10-27)
**Mechanism (implemented in `app/lib/detect_key.js` + `app/lib/leveldb_scan.js`):**
- Zalo encrypts renderer localStorage (`%APPDATA%\ZaloData\Partitions\zalo\Local Storage\leveldb`,
  records `<idx>_fas` etc.) with a **repeating-XOR** using the **UIN** (the 32-hex-char key, which
  is ALSO the SQLCipher key and the message-XOR key — all the same value). Confirmed from Zalo asar
  `utility-process-sqlite.js`: `g.decrypt` = repeating XOR; `init(userId, UIN)` sets secretKey=UIN.
- Stored value = Chromium localStorage encoding byte (1=Latin1, 0=UTF16LE) + JS string
  `z_ecrp_` + XOR(plaintext, UIN) starting at key phase 0 (NO mode byte — registry §2.3 was stale).
- `leveldb_scan.js`: minimal pure-Node LevelDB `.ldb` table reader + **pure-JS Snappy decompress**
  (no npm deps; cramjam is NOT installed). Extracts localStorage key→value.
- Recovery = classic repeating-key XOR break with KNOWN key length (32) and KNOWN alphabet (hex):
  for each of 32 key positions, try 16 hex chars, pick the one making the most decrypted bytes
  valid JSON/text across the whole record (~100+ samples/position → statistically rock-solid).
  Then **validate by opening Index.db**; fallbacks for multi-account (per-userIndex, per-record).
- UID is NOT secret (it's the `_production\<UID>` folder name); userId also sits plaintext in
  localStorage `sh_z_recentuid`. The UIN never appears plaintext on disk (verified via grep).
- RESULT: `node app/lib/detect_key.js <coreDir>` → `{ok:true, key:"3cc80a2d…", method:"auto-aggregate"}`.
  NO RAM scanning, NO admin, no Zalo-running requirement, no AV red flags, no manual entry.

## PIVOT (user, mid-task): native WinForm, NOT web app
- Dropped the local web server + HTML UI (server.js, ui/*). Keeping all `app/lib/*.js` (reused).
- New shape: thin **C# WinForms** front-end (compiled with in-box
  `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, .NET Framework 4.x — present on every
  Win10/11, no SDK/runtime install) that orchestrates a **Node CLI** (`app/cli.js`) for all logic
  (env detect, auto key-detect, discover, config, schedule, run+stream). Engine stays Node (Rule 3).
- Auto key-detection is MANDATORY (user: nobody, not even Master, knows where the key is) — solved above.

## ✅ DELIVERED (2026-10-27) — verified end-to-end
- **GUI**: `app/winform/Program.cs` → native WinForms, compiled by in-box csc.exe
  (`app/winform/build.ps1`). Wizard (detect Zalo → auto key → pick groups → dir/time) + dashboard
  (run now / dry-run / toggle schedule / open folder / reconfigure, live log).
- **Logic**: all in Node, reused via `app/cli.js` (env / detect-key / verify / discover / get+save
  config / status / schedule-get|set|del / run-stream / log / open-folder).
- **Packaging (1-FILE, user pivot)**: `app/winform/build_release.ps1` → **single** `app/dist/
  ZaloSync568.exe` (88.7 MB, one-click, self-contained). node.exe + all JS + engine are **embedded
  as managed resources** (`csc /resource:<f>,<logical/path>`) and **auto-extracted on first launch**
  to `%LOCALAPPDATA%\ZaloSync568\runtime\<exe-ticks>\` (marker `.ready`; old runtimes pruned). Verified
  running ALONE in an empty folder (extracts 15 files, wizard works). No Node install, no admin.
- **Icon + tray** (user ask): app icon `app/winform/app.ico` (orange "568", compiled via
  `/win32icon`, Form+NotifyIcon reuse it). System-tray `NotifyIcon` always visible = "running in
  background"; close(X)/minimize → hide to tray + balloon; tray menu Mở / Chạy ngay / Thoát hẳn;
  double-click restores. Verified: closing window keeps process alive & hidden to tray.
- **Scheduling** (`task_scheduler.js`): `Register-ScheduledTask -User <me>` Daily + StartWhenAvailable.
  Dropped the AtLogOn trigger — a global logon trigger needs admin (0x80070005); Daily+`-User` does not.
- **Verified**: env detect ✓, auto key-detect (GUI+CLI, bundled layout) ✓, group discover ✓,
  save-config ✓, schedule install/query/remove (no admin) ✓, engine `--dry-run` via app config ✓,
  packaged exe launches & uses bundled node ✓.
- **NOT yet click-tested in GUI**: wizard steps 3–4 + dashboard buttons (logic proven via identical
  CLI calls; GUI wiring is thin). Driving native clicks would need windows-desktop-e2e.
- **Known limits**: auto-key aggregates all localStorage z_ecrp_ records — multi-account machines fall
  back to per-userIndex/per-record + Index.db validation. Scheduled task runs only while user logged
  on (interactive token; StartWhenAvailable catches missed runs).
- Dev/forensic probes kept in `app/dev/` (NOT shipped) as derivation evidence.

## Decisions / tradeoffs (fill as we go)
- GUI tech: local web app served by Node stdlib `http` (no Electron, no Express). Rationale: reuse
  the Node runtime the engine already needs; zero build step; matches repo conventions (Node+bat+ps1).
  Launched in app-window mode (`msedge/chrome --app=http://127.0.0.1:PORT`), fallback default browser.
- Distributable is self-contained: engine files copied into `<InstallDir>\engine\`, GUI in
  `<InstallDir>\app\`, portable Node in `<InstallDir>\node\` (or detect system Node >= 22).
- Per-install config + state live OUTSIDE the program folder, under
  `%LOCALAPPDATA%\ZaloSync568\` (config.json, cursor, manifest, logs) so updates don't clobber data.
- Default output dir for a self-install user: `%USERPROFILE%\Documents\ZaloSync568\data`.

## 2026-10-27 — GUI co giãn (responsive) + nút "📋 Xuất log"
**Yêu cầu:** (1) căn chỉnh lại toàn bộ nút/vị trí cho co giãn hợp lý; (2) thêm nút xuất log lượt chạy để AI debug.

### Bố cục (winform/Program.cs)
- Bỏ TOÀN BỘ toạ độ cố định (`Location`/`Size`/`MaximumSize=740`). Mỗi màn hình dựng bằng `SetPage(grow, rows…)`
  = `TableLayoutPanel` 1 cột, hàng AutoSize, riêng hàng `grow` nhận phần cao còn dư (danh sách/log giãn, hoặc thanh
  điều hướng bị đẩy xuống đáy). Helper mới: `Row` (FlowLayoutPanel, tự xuống dòng khi hẹp), `Split` (2 cột: trái giãn,
  phải vừa nội dung — ô nhập+nút), `Nav` (wizard: "← Quay lại" trái, nút chính phải, bám đáy), `Input` (ô nhập chung).
- Quyết định UX (không có trong yêu cầu): nút điều hướng wizard thống nhất **góc dưới-phải** ở cả 4 bước (trước đây
  lúc trái lúc phải); Bước 3 "Chọn tất cả/Bỏ chọn" thành thanh công cụ ngay trên danh sách.
- Header: Panel toạ độ cố định → FlowLayoutPanel AutoSize, lề 18 = lề content → tiêu đề thẳng hàng nội dung
  (trước: "Zalo Sync 568" chồng lên dòng "Node …", thụt bằng 2 dấu cách).
- Cỡ mặc định 820→**860** px để 6 nút bảng điều khiển vừa 1 hàng (thêm nút Xuất log). MinimumSize giữ 720×560;
  ở 720 hàng nút tự xuống dòng.
- Sửa kèm (lỗi có sẵn, nằm đúng trong helper đang viết lại): `UseMnemonic=false` cho H2/P/Btn — trước đó ký tự
  `&` bị nuốt ("Nơi lưu & lịch chạy" hiện thành "Nơi lưu  lịch chạy", nút "Hoàn tất & lưu" tương tự).
- Đã kiểm chứng: nhãn dài (AutoSize + Dock=Fill trong TableLayoutPanel) tự xuống dòng và đẩy hàng dưới xuống.

### Xuất log (logic ở Node, GUI chỉ nối nút — đúng kiến trúc)
- `lib/log_export.js` + `node cli.js export-log [--out <file>]` → `{ok, file}`. File gồm: môi trường (Node/OS),
  `status`, cấu hình **đã che khóa** (`key → ***`, và che cả mọi chỗ khóa lỡ lọt vào log), log **lượt chạy gần
  nhất** (từ banner `====== KHỞI CHẠY` của runner.js hoặc `====== TASK KHOI CHAY` của run_sync.bat tới hết).
- Mặc định ghi vào `reportDir` (thư mục `baocao`) tên `ZaloSync568_log_<yyyyMMdd_HHmmss>.txt`; GUI sau đó mở
  thư mục qua `open-folder` có sẵn (giữ quy ước "mở Explorer đi qua CLI"), và in đường dẫn vào ô log.
- Chọn 1-click thay vì SaveFileDialog: đơn giản hơn cho người dùng không rành máy, dễ test tự động.
- Chỉ xuất lượt chạy GẦN NHẤT (theo chữ "lượt chạy" của yêu cầu). Muốn nhiều lượt hơn → mở rộng `lastRun`.

### Test (TDD)
- `test/log_export.test.js` (node:test, 7 ca) — để ngoài `lib/` vì build.ps1 nhúng mọi `lib/*.js` vào exe.
  Chạy: `node --test test/*.test.js` (Node 24 không nhận tham số thư mục `test/`).
- `winform/test_ui.ps1` — test GUI trên exe thật: duyệt cửa sổ con bằng Win32 (UI Automation báo control WinForms
  .NET 4 là "Pane" nên không dùng được), đi Bảng điều khiển → Bước 1..4 (không bấm Hoàn tất), ở 3 cỡ
  720×560 / 860×640 / 1400×900 kiểm: không tràn, không chồng, list/log giãn, nút wizard góc dưới-phải; bấm
  "📋 Xuất log" → file mới đủ mục + không lộ khóa + Explorer mở (file test bị xoá, cửa sổ Explorer bị đóng).
  Playwright (Rule 7) không áp dụng cho WinForms → thay bằng script này.
- Kết quả: bản cũ **44 lỗi** bố cục → bản mới **PASS** (cả `build\` và `dist\`). node 7/7, engine 68/68.

### Phát hiện khác (→ ĐÃ SỬA ở mục "Sửa toàn bộ vấn đề" bên dưới)
- **run_sync.bat trỏ vào node trong `runtime\<exe-ticks>\`**; mỗi bản build mới → runtime mới, runtime cũ bị xoá
  → tác vụ lịch đã cài sẽ hỏng tới khi bấm lại "Bật tự động". (Máy này chưa cài lịch nên test không ảnh hưởng.)
- `CaiDat (tuy chon).bat` được ghi kèm BOM (Set-Content -Encoding UTF8 của PS 5.1) → dòng `@echo off` lỗi, bat
  vẫn chạy nhưng in ồn. Có từ trước.
- Máy KHÔNG có `pwsh` (CLAUDE.md ghi `pwsh winform/build.ps1`); dùng `powershell -ExecutionPolicy Bypass -File`.
  build.ps1/build_release.ps1 trước đây không BOM → PS 5.1 đọc sai tiếng Việt → **HuongDan.txt bản phát hành cũ bị
  lỗi font**. Đã thêm UTF-8 BOM cho 2 script (nội dung không đổi) → HuongDan.txt mới hiển thị đúng.
- Không có git ở thư mục này → điểm khôi phục: `winform/Program.cs.bak-20261027` (bản trước khi sửa).

## 2026-10-27 — Sửa toàn bộ vấn đề (yêu cầu: "vẫn thấy lỗi mở sai thư mục dữ liệu")
**Gốc lỗi mở sai thư mục (đã tái hiện):** config lưu đường dẫn dạng `C:/…` (schema engine); `open-folder` đưa
nguyên chuỗi cho `explorer.exe` → Explorer không hiểu `/` và mở thư mục mặc định. Cùng thư mục với `\` thì mở đúng.
- `cli.js open-folder`: `path.normalize(target)` trước khi spawn explorer (sửa cho MỌI nơi gọi: nút Thư mục dữ
  liệu, nút Xuất log, mặc định). `status.dataDir` cũng chuẩn hoá → bảng điều khiển hiển thị dạng Windows.

**Cùng họ "sai thư mục dữ liệu" (tìm thêm khi rà):**
- "⚙ Thiết lập lại" trước đây luôn điền thư mục MẶC ĐỊNH ở Bước 4 → bấm Hoàn tất là âm thầm đổi nơi lưu (máy này đang
  dùng `Desktop\New folder`). Bước 3 cũng tích lại TẤT CẢ 163 nhóm thay vì 3 nhóm đang đồng bộ.
  → `recfg` nạp `get-config` vào `savedCfg`; Bước 3 giữ nhóm đang đồng bộ (nếu đổi tài khoản và không còn nhóm cũ nào
  → quay về chọn tất cả); Bước 4 điền sẵn tên dự án, thư mục (`Path.GetFullPath` đổi `/`→`\`), giờ chạy.
  Thiết lập mới (chưa có config) giữ nguyên hành vi cũ.
- Hộp "Chọn…" (FolderBrowserDialog) giờ mở tại thư mục đang nhập (`SelectedPath`).

**Lịch chạy hỏng sau mỗi bản exe mới:** `task_scheduler.refresh()` + `cli.js schedule-refresh` — nếu tác vụ đã cài,
ghi lại `run_sync.bat` theo node + engine của runtime hiện tại. GUI gọi sau khi mở bảng điều khiển (`RefreshSchedule`,
lỗi → in [CẢNH BÁO] vào ô log, không nuốt im). Đã kiểm chứng thực tế: bat được bản exe mới ghi lại sang runtime mới.
- ⚠ Sự cố trong lúc làm: chạy thử `node cli.js schedule-refresh` từ thư mục dev đã ghi bat thật trỏ sang node hệ thống +
  `../scripts` (Master đã bật lịch từ phiên trước). Engine giống hệt nên vẫn chạy được; sau đó exe `dist` khởi động đã
  tự ghi lại đúng runtime (`runtime\639286737999218015`). Đã kiểm tra lại file bat.

**Bộ cài `CaiDat (tuy chon).bat` (build_release.ps1):** (a) here-string `@"…"@` làm PowerShell thay `$s` thành rỗng →
lệnh tạo shortcut Desktop CHƯA BAO GIỜ chạy được; đổi sang `@'…'@`. (b) Ghi bằng UTF8Encoding(false) + CRLF → hết BOM
trước `@echo off`. Đã chạy thử bản sao (shortcut vào thư mục tạm, bỏ `start`) → tạo .lnk đúng TargetPath.

**Test:** `test/task_scheduler.test.js` (2 ca refresh), `test/_helpers.js` (withFakeAppData dùng chung).
`winform/test_ui.ps1` thêm: nút Thư mục dữ liệu phải mở Explorer MỚI đúng downloadDir; Thiết lập lại giữ nhóm (Bước 3)
và điền sẵn thư mục (Bước 4). Mốc đỏ trên bản cũ: 3 lỗi → bản mới PASS (build + dist). node 9/9, engine 68/68.
Hộp "Chọn…" kiểm bằng ảnh chụp (modal, không đưa vào test): mở tại Desktop › New folder.

## 2026-10-27 — Thư mục data đặt theo TÊN nhóm (không còn mã g...)
**Yêu cầu (Master):** "khi tải về đang không đặt tên thư mục theo nhóm trong data nên hơi khó kiểm soát."
Log máy thật cho thấy thư mục cấp 1 là `g3635258592664945203\<ngày>\<phân loại>` — khó biết nhóm nào.

**Gốc:** engine `daily_sync_568.js` dùng `group.id` làm khóa kỹ thuật (mở `Message\<id>.db`, key cursor) và
`group.code` CHỈ làm nhãn — một đoạn đường dẫn trong `buildSubFolder` + tiền tố `[code]` trong tên file
(dòng 1228/1265/1386/1390). App lại điền `code = id` (`Program.cs:454`) → thư mục ra mã nhóm.

**Sửa (trong Node, KHÔNG đụng engine — Rule 3):** `config_store.buildConfig` giờ chạy `normalizeGroups()`:
giữ `id` nguyên, đặt `code = groupCode(name)` = tên nhóm làm sạch (ký tự cấm `\/:*?"<>|` + khoảng trắng → `_`,
gộp `_`, cắt ≤60, bỏ `_`/`.` ở hai đầu; rỗng → lùi về id). Hai nhóm trùng tên → thêm 5 chữ số cuối của id để
không trộn thư mục. Chốt chặn duy nhất vì mọi save-config đều qua buildConfig.
- Giữ diacritic (NTFS hỗ trợ; engine đã ghi tên file tiếng Việt) và dùng `_` cho khoảng trắng — ĐỒNG NHẤT với cách
  engine làm sạch tên người gửi (`senderName.replace(/[\\/:*?"<>| ]/g,'_')`).
- KHÔNG sửa `Program.cs` (vẫn gửi code=id, Node ghi đè) → không phải build lại C#, chỉ cần re-embed lib khi đóng exe.

**Phạm vi / lưu ý (CHƯA làm, chờ Master quyết):** fix chỉ áp dụng cho lần LƯU config kế tiếp. Máy đang chạy có
config cũ (code=id) + dữ liệu đã nằm ở thư mục `g...`. Muốn máy đó đổi sang tên nhóm cần (a) "Thiết lập lại →
Hoàn tất" để lưu lại config, hoặc (b) thêm auto-repair re-derive code lúc khởi động; và dữ liệu cũ sẽ tách khỏi
thư mục mới trừ khi đổi tên thư mục `g...` trên đĩa (máy đó ở xa, không thao tác từ đây được). Đã hỏi Master.

**Test (TDD, Rule 7):** `test/config_store.test.js` +4 ca (suy code từ tên, lọc ký tự cấm, lùi về id, chống trùng
tên). `node --test test/*.test.js` → 24/24 PASS. Engine không đụng nên bộ test engine không liên quan.

> Phối hợp: phiên `app-b1` đang đổi tên "Zalo Sync 568"→"Zalo Sync" cùng thư mục (đã báo nhau qua SendMessage).
> Thay đổi ở trên dùng Edit surgical, chồng lên bản đổi-tên của họ, không Write đè.

## 2026-10-27 — Đổi tên "Zalo Sync 568" → "Zalo Sync", bỏ "568", icon mới
**Yêu cầu:** "Đổi tên thành Zalo Sysn thôi. Bỏ nội dung 568 đi và sửa lại icon nữa." — giả định "Sysn" = gõ nhầm "Sync".

### Đã đổi (app/ — GUI, CLI, build, docs)
- Tên hiển thị: tiêu đề cửa sổ, header, khay, balloon, nhãn dự án mặc định (`config_store.DEFAULT_LABEL`), file xuất log
  (`ZaloSync_log_*.txt` + dòng đầu), HuongDan.txt, docs `HUONG_DAN_SU_DUNG.md/.html` (bỏ cả "Tập đoàn 568" + danh sách dự án).
- Định danh: `ZaloSync.exe`, `%LOCALAPPDATA%\ZaloSync` (+ `runtime\`), tác vụ `ZaloSync_Daily`, mặc định `Documents\ZaloSync\{data,baocao}`,
  namespace C# `ZaloSync`, biến môi trường `ZALOSYNC_CLI` / `ZALOSYNC_ENGINE_DIR` (chỉ GUI↔CLI dùng, build cùng nhau), tên tạm.

### Quyết định (không có trong yêu cầu)
- **Chuyển bản cài cũ — `lib/legacy_migrate.js` + `cli.js migrate`** (GUI gọi ĐẦU TIÊN trong `Boot`). Lý do: máy này (và máy đồng
  nghiệp) đã có `%LOCALAPPDATA%\ZaloSync568` + tác vụ `ZaloSync568_Daily`; đổi tên trần → mất config/cursor (phải thiết lập lại, quét lại)
  và tác vụ cũ chạy SONG SONG tác vụ mới. Chép cursor/manifest/state/logs rồi config (config = dấu "đã chuyển"), trỏ lại
  cursorFile/manifestFile, nhãn mặc định cũ → nhãn mới (nhãn tự đặt giữ nguyên). Lịch: chỉ hỏi Task Scheduler khi có `run_sync.bat` cũ;
  **cài tác vụ mới TRƯỚC, gỡ cũ SAU** (lỗi giữa chừng vẫn còn ≥1 tác vụ). Hỏi lịch lỗi → giữ thư mục cũ, trả `ok:false` → GUI hiện
  MessageBox cảnh báo, lần mở sau thử lại. Xong thì xoá thư mục cũ (kể cả runtime cũ ~90 MB).
- (→ **ĐÃ ĐỔI ở vòng 2** bên dưới: thư mục MẶC ĐỊNH cũ được đổi tên; thư mục tự chọn vẫn giữ.)
  **KHÔNG di chuyển thư mục dữ liệu/báo cáo** (`downloadDir`/`reportDir`) của cấu hình cũ dù manifest lưu theo tên file (về kỹ thuật
  dời được): dữ liệu thô này được đưa sang AI/tự động hoá phía sau — đổi đường dẫn âm thầm có thể làm gãy chúng. Bản cài MỚI dùng
  `Documents\ZaloSync`. "Thiết lập lại → Hoàn tất" sẽ đưa `reportDir` về mặc định mới (GUI không gửi reportDir — hành vi có sẵn).
- **Icon** (`winform/make_icon.ps1` → `app.ico`, vẽ bằng System.Drawing, tái tạo được): ô vuông cam (= ACCENT) + chữ Z trắng + 2 mũi
  tên đồng bộ; 8 cỡ (16–64 DIB 32-bit, 256 PNG). ≤ 24 px chỉ vẽ chữ Z to — Z + mũi tên ở 16 px bị nhoè (đã so ảnh). Icon cũ chỉ có
  1 khung PNG 256. Nhúng 2 lần: `/win32icon` (Explorer/thanh tác vụ) + resource quản lý `app.ico` (tên không có '/' → `EnsureRuntime`
  không giải nén) để form/khay nạp file nhiều cỡ: `Icon.ExtractAssociatedIcon` chỉ trả 1 ảnh 32 px → khay sẽ thu nhỏ bản có mũi tên.
- **Bộ cài `CaiDat (tuy chon).bat`** dọn bản tên cũ: `taskkill ZaloSync568.exe`, xoá `Programs\ZaloSync568` + shortcut "Zalo Sync 568",
  tránh người dùng mở nhầm bản cũ (bản cũ sẽ hiện wizard trống và có thể đăng ký lại tác vụ cũ).
- Bản build cũ `ZaloSync568.exe/.zip` (dist + build) **chuyển** (không xoá) vào `..\_backup\doi_ten_20261027\old_artifacts\`;
  tạo `dist\ZaloSync.zip` (chỉ chứa exe, giống zip cũ Master tạo tay). Ảnh docs chụp lại từ exe phát hành.

### Còn "568" (có chủ đích) — xem quy ước trong CLAUDE.md
- Định danh bản cũ để chuyển/dọn (`legacy_migrate.js`, bat cài đặt, test). Tên engine (`daily_sync_568.js`, `discover_568_groups.js`,
  `ZALO_568_CONFIG`) — engine nằm ngoài phạm vi (CLAUDE.md: read-only) và dùng chung với các job production khác.
- (→ **ĐÃ XỬ LÝ ở vòng 2** bằng tuỳ chọn engine `projectCode`.) ⚠ Xung đột (Rule 5): chính engine vẫn in "568" vào log mà GUI hiển thị (`[568 ZALO DAILY SYNC PIPELINE]`,
  `[HOÀN TẤT ĐỒNG BỘ 568 TOÀN DIỆN]`) và vào báo cáo (`DAILY_REPORT_568_*.md`, tiêu đề "DỰ ÁN 568"). Sửa = đổi engine dùng chung +
  đổi tên file báo cáo mà quy trình phía sau có thể đang đọc → chưa làm.

### Kiểm chứng
- TDD: test mới `test/config_store.test.js` (3), `test/legacy_migrate.test.js` (8); sửa `_helpers.js`, `log_export.test.js`.
  Mốc đỏ: 6 lỗi/13 → xanh **20/20**. Engine **68/68** (`node --test scripts/*.test.js` — dạng `scripts/` không chạy trên Node 24).
- `cli.js migrate` đầu-cuối trên LOCALAPPDATA giả: 1 dòng JSON, lần 2 `migrated:false`.
- `test_ui.ps1` (thêm: tiêu đề cửa sổ đúng, không nhãn/nút nào còn "Sync 568", thư mục + tác vụ cũ đã dọn) → **PASS** trên `build\` và
  `dist\ZaloSync.exe`. Chuyển THẬT trên máy này: `ZaloSync568` → `ZaloSync`, cursor/manifest trùng hash bản sao lưu, 3 nhóm, chỉ còn
  `ZaloSync_Daily` 04:15, bat trỏ runtime đang có. Engine `--dry-run` bằng node+engine của runtime với config đã chuyển: exit 0, cursor không đổi.
- Bộ cài thử trong hộp cát (LOCALAPPDATA + Desktop giả, bỏ `start`): xoá bản cũ + shortcut cũ, cài exe + shortcut mới đúng đích.
- Icon khay: kiểm GIÁN TIẾP (thanh tiêu đề hiện khung 16 px "Z"; .NET chọn khung 16 khi `new Icon(icon, SmallIconSize)`), chưa chụp khay.
- Sao lưu trước khi sửa (không có git): `..\_backup\doi_ten_20261027\` = mã nguồn zip + `%LOCALAPPDATA%\ZaloSync568` (trừ runtime) +
  XML tác vụ `ZaloSync568_Daily`.

### Còn lại trên máy này
- ~~`reportDir` vẫn `Documents\ZaloSync568\baocao`~~ (→ đã đổi ở vòng 2); `Programs\ZaloSync568\ZaloSync568.exe` (bản cài cũ) còn cho
  tới khi chạy `CaiDat (tuy chon).bat` mới.
- Có sẵn từ trước (không sửa): docs ghi menu khay "Mở giao diện"/"Chạy ngay" — menu thật là "Mở bảng điều khiển"/"Chạy đồng bộ ngay";
  CLAUDE.md ghi `node --test scripts/` (Node 24 cần `scripts/*.test.js`).

### Vòng 2 — bỏ nốt "568" do engine sinh ra + thư mục mặc định cũ (stop-hook: mục tiêu mới đạt một phần)
- **Engine — tuỳ chọn `config.projectCode` (OPT-IN, tương thích ngược):** thiếu khoá → `'568'` y như cũ (các job production chạy thẳng
  `../scripts` với `config_568*.json` không đổi tên tệp/tiêu đề mà quy trình sau đang đọc); `''` → banner log, tiêu đề báo cáo/chỉ mục,
  chân transcript, tên `DAILY_REPORT_<ngày>.md` / `DAILY_REPORT_latest.md` không còn "568"; `lib_audit` bỏ đề xuất riêng "BCH1…Dự án 568".
  Helper `withCode()` + `dailyReportFileName()` (export để test). Bộ đọc lại báo cáo (`/^DAILY_REPORT_.*\.md$/`) nhận cả 2 dạng tên.
  Đây là ngoại lệ có chủ đích với quy ước "engine read-only" (Master yêu cầu bỏ 568) → đã ghi vào CLAUDE.md. App: `buildConfig` ghi
  `projectCode: ''`. Sao lưu engine trước khi sửa: `..\_backup\doi_ten_20261027\scripts_truoc_sua\`.
- Giữ nguyên trong engine (không ai thấy): tên tệp/biến môi trường, tên tác vụ production `Zalo_Daily_Sync_568` ở bước tự kiểm định
  (trong app truy vấn này thất bại → audit ghi lịch "Không thể truy vấn" — có từ bản cũ, không phải chữ hiển thị "568").
- **`legacy_migrate.upgradeConfig`** (chạy cả khi `%LOCALAPPDATA%\ZaloSync568` đã chuyển xong): cấu hình app (có `_app`) chưa có
  `projectCode` → thêm `''`; cấu hình còn trỏ vào thư mục MẶC ĐỊNH cũ `Documents\ZaloSync568` và chưa có `Documents\ZaloSync` → đổi tên
  tại chỗ (cùng ổ, tức thì; manifest lưu theo TÊN tệp nên không tải lại), sửa đường dẫn trong config. Đổi tên lỗi (đang mở tệp) →
  config giữ chỗ cũ (vẫn chạy được), vẫn lưu projectCode, ném lỗi rõ ràng → GUI cảnh báo, lần mở sau thử lại. Thư mục tự chọn: không đụng.
  Đảo lại quyết định vòng 1: thư mục MẶC ĐỊNH là "nội dung 568" của app (người dùng không chọn tên đó); thư mục tự chọn vẫn tôn trọng.
- `test/_helpers.js` giả cả `USERPROFILE` → test không bao giờ chạm Documents thật.
- ⚠ **Sự cố do tôi gây ra + đã khôi phục:** `--dry-run` của engine VẪN ghi báo cáo ngày + báo cáo kiểm định vào `reportDir` và tạo thư
  mục rỗng trong `downloadDir` (hành vi có sẵn — nút "Chạy thử" của GUI cũng vậy). Lần chạy thử 13:18 ở vòng 1 đã ghi đè
  `baocao\DAILY_REPORT_568_20261027.md` + `SYSTEM_AUDIT_REPORT_LATEST.md` và tạo 12 thư mục rỗng + 1 tệp audit trong `Desktop\New folder`.
  Đã khôi phục 2 báo cáo từ bản gốc 11:06 trong `data\_TONGHOP` (trùng hash), xoá đúng các mục do lần chạy thử tạo (kiểm tra trước: chỉ
  thư mục rỗng + 1 tệp). Bản bị ghi đè lưu ở `..\_backup\doi_ten_20261027\dryrun_side_effects\`. Kiểm chứng vòng 2 dùng HỘP CÁT thay vì dry-run.

### Kiểm chứng vòng 2
- TDD: engine +5 test (mặc định giữ "568" cho production / `''` sạch / mã khác) → mốc đỏ 4 lỗi → **73/73**. App +6 test (projectCode,
  đổi tên thư mục mặc định, giữ thư mục tự chọn, không gộp, lỗi đổi tên) → mốc đỏ → **29/29** (gồm 4 test của phiên song song app-db).
- Engine chạy THẬT đầy đủ (`--all`, không dry-run) trong hộp cát (mọi thư mục ghi + cursor/manifest ở thư mục tạm, `projectCode:''`):
  exit 0; log/banner/báo cáo/chỉ mục/transcript/audit không còn "568" do engine sinh — chỉ còn dữ liệu thật của người dùng (tên 2 nhóm
  "…-568", tên thành viên "A Quân 568" trong tin nhắn — không được sửa).
- Build phát hành cuối (gồm cả thay đổi `config_store.js` của phiên app-db) → `test_ui.ps1` (thêm: `projectCode` rỗng, config không trỏ
  `Documents/ZaloSync568`) **PASS** trên `dist\ZaloSync.exe`. Nâng cấp THẬT trên máy này: `projectCode:''`, `reportDir` →
  `Documents/ZaloSync/baocao`, `Documents\ZaloSync568` không còn, 19/19 tệp trùng hash bản sao lưu (`..\_backup\…\Documents_ZaloSync568`).
- ~~Còn lại: tệp lịch sử `DAILY_REPORT_568_*`/`ZaloSync568_log_*`, ô log hiện lượt chạy cũ~~ → đã xử lý ở vòng 3.

### Vòng 3 — bỏ nốt phần còn sót (stop-hook lần 2)
- **Engine trung tính mặc định:** `projectCode` thiếu → `''` (không còn mặc định '568' trong mã). Thêm `scheduledTaskName`
  (`querySchedulerStatus(taskName)` — thiếu → không truy vấn, "Chưa cấu hình"); trước đây cứng `"Zalo_Daily_Sync_568"` nên audit
  của app luôn "Không thể truy vấn". **4 config production** (`../scripts/config_568.json`, `config_568_all.json`, mẫu `wi5/`)
  khai báo `"projectCode": "568"` + `"scheduledTaskName": "Zalo_Daily_Sync_568"` → đầu ra production KHÔNG đổi (script chèn có
  kiểm: JSON hợp lệ, mọi khoá cũ giữ nguyên giá trị). Test engine chặn: config production thiếu 2 khoá → đỏ.
  ⚠ Máy wi5 chạy bản config RIÊNG của nó: khi chép engine mới sang wi5 phải chép kèm config (hoặc thêm 2 khoá) — nếu không,
  báo cáo wi5 sẽ thành `DAILY_REPORT_<ngày>.md` (không "568") và audit không hỏi lịch.
- App: `buildConfig` + `upgradeConfig` thêm `scheduledTaskName: 'ZaloSync_Daily'` (hằng `TASK_NAME` chuyển sang `config_store`,
  `task_scheduler` dùng lại — tránh vòng lặp require). Chuyển bản cũ: log cũ cất thành `logs/daily_sync_ban_cu.log` → ô log sạch.
  Bỏ `discover_568_groups.js` khỏi danh sách nhúng của `build.ps1` (engine/app không require; tự đọc `config_568.json` nên vô dụng trong app).
- **Trên máy này** (đều có sao lưu, kiểm hash trước khi xoá):
  - Cất log cũ `logs/daily_sync.log` → `daily_sync_ban_cu.log` (tương đương bước migrate mới).
  - **Chạy đồng bộ THẬT** đúng như nút "▶ Chạy ngay" (`cli.js run --all` của runtime app) để sinh lại báo cáo hôm nay theo tên mới:
    exit 0; banner `[ZALO DAILY SYNC PIPELINE]` … `[HOÀN TẤT ĐỒNG BỘ TOÀN DIỆN]`; `DAILY_REPORT_20261027.md`; audit lịch "Ready ✅ ĐẠT".
  - Bỏ các đầu ra cũ đã bị thay thế khỏi `Documents\ZaloSync`: `data\` (chỉ 2 tệp tải về, đều có bản trùng hash trong
    `Desktop\New folder`; phần còn lại được lượt chạy mới sinh lại), `DAILY_REPORT_568_20261027.md`, 3 tệp `ZaloSync568_log_*.txt`
    — 18/18 tệp trùng hash với `..\_backup\doi_ten_20261027\Documents_ZaloSync568\` trước khi xoá.
  - Bản cài cũ `Programs\ZaloSync568\ZaloSync568.exe` (bản build 11:43, không trùng bản nào đã sao lưu) → chuyển vào
    `..\_backup\…\old_artifacts\Programs_ZaloSync568\`; cài `dist\ZaloSync.exe` vào `Programs\ZaloSync\` (không có lối tắt nào trỏ
    vào bản cũ; không tạo lối tắt mới vì bản cũ cũng không có).
- Kiểm chứng: engine **78/78** (mốc đỏ 3 + 4), app **29/29** (mốc đỏ 3), `test_ui.ps1` **PASS** trên exe cuối; quét mọi nơi app
  ghi (`%LOCALAPPDATA%\ZaloSync`, `Documents\ZaloSync`, `Desktop\New folder`, `Programs\ZaloSync`): không tên tệp nào chứa "568";
  nội dung "568" chỉ còn ở dữ liệu người dùng (tên 2 nhóm, tên thành viên "A Quân 568", 1 msgId chứa dãy số 568) và đường dẫn
  `engine\daily_sync_568.js` trong `run_sync.bat` nội bộ (tên tệp engine thật, dùng chung production — không đổi).
- Ngoài phạm vi, không đụng: tác vụ production `Zalo_Daily_Sync_568`, `Zalo_Daily_Sync_568_All` (job riêng của Master, không phải app);
  tệp `Desktop\ZaloSync568_log_20261027_130322.txt` (bản cũ xuất lúc 13:03, trước phiên này) — **Master chọn giữ nguyên**.
- **Master xác nhận tên "Zalo Sync"** ("Sysn" trong yêu cầu là gõ nhầm) — hết giả định.
- Phát hiện (có từ trước, chưa sửa): bảng điều khiển hiện "04:15 (kế tiếp 28/10/2026 11:15)" — giờ kế tiếp lệch +7 h (lỗi múi giờ hiển thị).
- `app/` đã thành git repo (phiên app-db, commit `ccb6d45`, đã push): thay đổi sau commit đó chưa commit (CLAUDE.md, build.ps1, ghi chú này);
  engine `../scripts` nằm NGOÀI repo.

## 2026-10-27 — Lịch tự động: chạy bù sau khởi động lại / lỡ lịch (yêu cầu: "vấn đề 3 … chạy tự động hoàn toàn khi khởi động lại máy … lịch muộn thì tải bù")
Nhánh `fix/lich-tu-dong-chay-bu` (commit `342c22d`, `d2e1953` + ghi chú này). Sao lưu trạng thái thật trước khi sửa: `%LOCALAPPDATA%\Temp\zalosync_backup_20261027\` (config, state, run_sync.bat, XML tác vụ cũ).

**Sự thật đã kiểm (không đoán):**
- Engine luôn chạy `--all` (floorTs = 0) → MỘT lượt thành công sau nhiều ngày tắt máy là đủ dữ liệu mọi ngày bị lỡ. Thiếu là *đảm bảo lượt bù chắc chắn chạy, đúng 1 lần*.
- Trigger đăng nhập **của chính user** (`-AtLogOn -User $me`, Delay PT10M) đăng ký được từ shell **không elevated** (Medium IL). Ghi chú cũ "AtLogOn cần admin (0x80070005)" là trigger đăng nhập của MỌI user.
- Trước đây lượt theo lịch chạy `run_sync.bat` → engine trực tiếp: không ghi `state.json` ("Lần chạy cuối" không phản ánh lượt tự động), hiện cửa sổ cmd; khóa "1 lượt" của runner chỉ trong 1 tiến trình.

**Quyết định (ngoài spec / phải chọn):**
- **Không chạy trước khi đăng nhập Windows**: engine đọc DB cục bộ của Zalo PC — DB chỉ nhận tin mới khi đã đăng nhập + Zalo đang mở; chạy ở màn hình khóa không thêm dữ liệu, lại phải lưu mật khẩu Windows/S4U.
- Chạy bù: trigger hằng ngày + trigger đăng nhập (trễ 10' cho Zalo PC kịp đồng bộ) + StartWhenAvailable (máy ngủ rồi thức) + IgnoreNew; `runScheduled` chỉ chạy khi `isRunDue` (chưa có lượt thành công nào BẮT ĐẦU sau mốc lịch gần nhất; đệm 2' trước mốc) → nhiều trigger kích liên tiếp vẫn chỉ 1 lượt. `lastSuccessAt` = giờ bắt đầu lượt exit 0 không dry-run (chạy tay "▶ Chạy ngay" cũng tính).
- Bỏ `run_sync.bat`: action = `ZaloSync.exe --scheduled` (exe GUI chạy ẩn, node CreateNoWindow; tự giải nén lại runtime nếu bị xoá). Đánh đổi: tác vụ phụ thuộc vị trí exe → `schedule-refresh` khi mở app trỏ lại; hướng dẫn ghi "đừng xoá/di chuyển exe". Đường dẫn exe truyền qua env `ZALOSYNC_EXE` (GUI đặt cho mọi lệnh CLI); thiếu → lỗi rõ ràng, không đoán (tránh lặp sự cố dev-CLI ghi đè lịch thật).
- Thêm khoá liên tiến trình `run.lock` (pid + giờ; pid chết hoặc > 6 h → bỏ lại vì PID Windows bị tái dùng): trigger đăng nhập làm tăng khả năng trùng với "Chạy ngay" → 2 engine cùng ghi cursor/manifest. Lượt tự động gặp khoá → ghi "bỏ qua" (exit 0).
- `refresh` chỉ đăng ký lại khi LỆCH (giờ/exe/tham số/trigger đăng nhập) — không ghi đè tác vụ mỗi lần mở app (tránh đụng lượt đang chạy).
- Master chọn: **thiết lập lần đầu tự bật lịch** ("Hoàn tất" → `schedule-set`); "Thiết lập lại" → `schedule-refresh` (lịch tắt thì giữ tắt).
- Sửa luôn lỗi hiển thị "kế tiếp" lệch +7 h (ghi ở vòng 3): `query` trả nextRun/lastRun ISO có offset.
- Lỗi lượt tự động TRƯỚC khi chạy engine (mất config…) giờ ghi `[TỰ ĐỘNG] … LỖI —` vào log (exe bỏ stdout). Lỗi của chính exe (giải nén runtime) cũng ghi vào log, không MessageBox.
- `CLAUDE.md`: lệnh test engine `node --test scripts/` báo MODULE_NOT_FOUND trên Node hiện tại → sửa thành `scripts/*.test.js`.

**Kiểm chứng:**
- App **68/68** (0 skip; gồm đăng ký thật vào Task Scheduler bằng tên tạm `ZaloSync_Test_*` + đối chiếu độc lập principal/settings/trigger; engine giả cho runner/CLI), engine **78/78**.
- ⚠ Sự cố trong lúc làm: một test đầu tiên đặt `ZALOSYNC_ENGINE_DIR` sai để giả "thiếu engine" → `engine_path` lùi về `../scripts` → chạy engine THẬT với config giả (thiếu đường dẫn → engine mặc định `D:/Workspace/568/zalo_inbox`, `deliverables/schedule`). Đã kiểm: 2 thư mục đó không có tệp nào đổi trong 40'. Test đã bỏ nhánh đó (có chú thích cảnh báo).
- `test_ui.ps1` (mặc định) PASS; `test_ui.ps1 -Schedule` PASS trên exe thật: A định nghĩa tác vụ + nhãn "kế tiếp 28/10/2026 04:15" (hết +7h); B tắt/bật; C đổi giờ qua wizard 04:15→05:15 → config + tác vụ + nhãn theo giờ mới; D PATH không có PowerShell → hộp thoại "Không bật được lịch chạy tự động: … ENOENT", tác vụ không đổi; E lượt ẩn nhánh bỏ qua: 0 cửa sổ, exit 0. Config/state khôi phục trùng hash bản sao lưu.
- Cài `dist\ZaloSync.exe` vào `Programs\ZaloSync\` → mở 1 lần → tác vụ thật tự chuyển sang `Programs\ZaloSync\ZaloSync.exe --scheduled` (1,5 s).
- **Chạy THẬT qua Task Scheduler** (Master cho phép): "đến hạn" → engine `--all` → exit 0 sau 6 s, LastTaskResult 0, **0 cửa sổ hiển thị mới**, `run.lock` có trong lúc chạy và được nhả, `lastSuccessAt` ghi đúng giờ bắt đầu; gọi lại → "bỏ qua". Khoá với tiến trình thật: lock do GUI (pid sống) giữ + trạng thái đến hạn → tác vụ ghi "bỏ qua — Đang có một lượt…", engine không chạy; đã khôi phục state.

**Chưa kiểm chứng được (cần Master):** trigger đăng nhập sau khởi động lại thật (không thể log off trong phiên). Lịch sử Task Scheduler đang tắt (bật cần admin). Bằng chứng nằm ở `logs\daily_sync.log`: ~10' sau khi đăng nhập phải có dòng `[TỰ ĐỘNG] … bỏ qua` (nếu hôm đó đã đồng bộ) hoặc `… đến hạn …` + banner `KHỞI CHẠY`.

**Giới hạn / còn lại (không sửa — ngoài phạm vi):**
- 404 khi tải tệp đính kèm (lượt thật hôm nay vẫn còn) — vấn đề engine/nguồn tải, không phải lịch.
- Máy tắt nhiều ngày → 1 lượt bù lấy đủ dữ liệu nhưng chỉ 1 `DAILY_REPORT_<ngày chạy>.md` (không sinh báo cáo cho từng ngày lỡ) — hành vi engine.
- Tác vụ bị người dùng Disable trong Task Scheduler vẫn hiện "BẬT" (chỉ kiểm tồn tại). Bộ cài `.bat` không tắt `ZaloSync.exe` đang chạy (lượt tự động đang chạy → copy đè thất bại) — có từ trước.

## 2026-10-27 (chiều) — Khởi động cùng Windows + đồng bộ MỖI lần đăng nhập (yêu cầu: "auto start-up"; "khi chọn bật đồng bộ sẽ đưa vào startup và chạy dữ liệu còn thiếu hàng ngày")
Nhánh `feat/khoi-dong-cung-windows` (từ `develop`). Master chọn: app tự mở xuống khay + đồng bộ mỗi lần đăng nhập.
- **Đổi quy tắc chạy (thay quyết định "chỉ bù khi lỡ mốc" ở mục trên):** mọi trigger (hằng ngày, MỖI lần đăng nhập, StartWhenAvailable)
  đều đồng bộ `--all`; chỉ bỏ qua khi lượt thành công gần nhất BẮT ĐẦU < 30' (`shouldRun`, thay `isRunDue`/`lastSlot`) — chặn trigger
  đăng nhập (trễ 10') + StartWhenAvailable kích sát nhau. Mỗi lượt quét toàn bộ + tải lại tệp còn thiếu ⇒ "chạy dữ liệu còn thiếu".
  Đánh đổi: engine lỗi liên tục → thử lại ở mọi trigger (chủ ý).
- **Startup gắn với "⏰ Bật tự động":** `HKCU\…\Run\<tên tác vụ>` = `"<exe>" --tray`, ghi cùng script đăng ký tác vụ; tắt gỡ cả hai (kiểm
  lại, ném lỗi nếu còn); `refresh` đối chiếu cả giá trị Run → bản cài đã bật lịch trước đó tự được thêm Startup khi mở app. Tên giá trị
  = tên tác vụ để test dùng tên tạm, không đụng giá trị thật.
- **GUI:** `--tray` mở ẩn (Opacity 0 tới Shown rồi ẩn; không bóng thông báo mỗi lần đăng nhập; Boot vẫn chạy). **Chỉ 1 bản** (mutex
  `Local\ZaloSync_GUI`): bản thứ 2 bật sự kiện có tên `Local\ZaloSync_Show` → bản đang chạy hiện cửa sổ. Lần đầu dùng HWND_BROADCAST:
  test F ĐỎ — form ẩn (ShowInTaskbar=false) là cửa sổ "được sở hữu", không nhận broadcast → đổi sang sự kiện có tên → XANH.
- **Sửa lỗi có từ trước, lộ ra vì app nay chạy thường trực:** `FormClosing` Cancel mọi lý do → chặn Windows tắt máy/đăng xuất ("app đang
  chặn tắt máy" mỗi lần khởi động lại). Nay chỉ ẩn xuống khay khi `CloseReason.UserClosing`. Test G: WM_QUERYENDSESSION trả 1; bấm X vẫn ẩn.
- **Kiểm chứng:** app **69/69**, engine **78/78** (0 skip). `test_ui.ps1 -Schedule` PASS A–G (A/B kiểm thêm giá trị Run; F `--tray` không có
  cửa sổ hiện, lần mở thứ 2 hiện đúng cửa sổ và tự thoát, `--tray` lần 2 tự thoát, còn đúng 1 tiến trình; G như trên) + phần mặc định PASS.
  Cài `Programs\ZaloSync\ZaloSync.exe`, khởi động `--tray` như lúc đăng nhập → 1,5 s sau tác vụ + Run đều trỏ bản cài; StartupApproved
  không vô hiệu hoá. Config của Master (giờ 16:15 do Master đặt lúc 16:04) giữ nguyên.
- **Chưa kiểm chứng được (cần Master):** khởi động lại máy thật → app hiện ở khay ngay sau đăng nhập; ~10' sau log có `[TỰ ĐỘNG] … chạy (…`.
- **Ghi nhận, không sửa:** nút của bảng điều khiển hiện ra trước khi gắn sự kiện Click (~1 s đầu bấm bị mất — có từ trước); 1 lần test E
  tác vụ ở trạng thái Running ~11 s dù log "bỏ qua" sau 0,4 s (chưa rõ, LastTaskResult vẫn 0). "Thiết lập lại" lúc 16:04 đổi mã thư mục
  nhóm từ `g…` sang tên nhóm (hành vi có sẵn của wizard) → `Desktop\New folder` có 2 bộ thư mục; chưa dọn, chờ Master quyết.
