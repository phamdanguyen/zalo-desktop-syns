'use strict';
/**
 * task_scheduler.js — Bật/tắt/kiểm tra lịch chạy tự động hằng ngày qua Windows Task Scheduler.
 *
 * Tác vụ chạy `<ZaloSync.exe> --scheduled` (chế độ ẩn của GUI → `cli.js run --scheduled`), nên lượt chạy
 * theo lịch đi qua runner (ghi state.json, khóa chống chạy trùng). Hai trigger: hằng ngày lúc HH:MM
 * + đăng nhập của CHÍNH người dùng (trễ 10 phút) — cùng StartWhenAvailable, đảm bảo bỏ lỡ lịch thì
 * được chạy bù; runner tự bỏ qua nếu đã đồng bộ thành công sau mốc lịch (isRunDue). Chạy dưới quyền
 * người dùng hiện tại, không cần admin.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const configStore = require('./config_store');

const { TASK_NAME } = configStore;
const DEFAULT_TIME = '04:15';
const TASK_ARGS = '--scheduled';
const LOGON_DELAY = 'PT10M'; // chờ Zalo PC mở + đồng bộ tin sau đăng nhập
const GRACE_MS = 2 * 60 * 1000; // Task Scheduler có thể kích sát trước mốc vài giây/phút → vẫn tính là mốc hôm nay

function psEscape(s) { return String(s).replace(/'/g, "''"); }

function runPowerShell(script) {
  return execFileSync('powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true });
}

/** HH:MM 24h hợp lệ (đúng 2 chữ số mỗi phần) → giữ nguyên, ngược lại giờ mặc định. */
function normTime(time) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time || '') ? time : DEFAULT_TIME;
}

/** Mốc lịch gần nhất (giờ địa phương) <= now + đệm: hôm nay nếu đã tới (kể cả sát trước), không thì hôm qua. */
function lastSlot(now, time) {
  const [h, m] = normTime(time).split(':').map(Number);
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (slot.getTime() > now.getTime() + GRACE_MS) slot.setDate(slot.getDate() - 1);
  return slot;
}

/** Đến hạn chạy bù? lastSuccessAt = ISO giờ BẮT ĐẦU lượt thành công (không dry-run) gần nhất. */
function isRunDue({ now, time, lastSuccessAt }) {
  const last = new Date(lastSuccessAt);
  if (!lastSuccessAt || isNaN(last)) return true;
  return last < lastSlot(now, time);
}

/** Đường dẫn ZaloSync.exe do GUI truyền qua ZALOSYNC_EXE; không có → lỗi rõ ràng (không đoán bừa). */
function taskExe() {
  const exe = process.env.ZALOSYNC_EXE;
  if (exe && fs.existsSync(exe)) return exe;
  throw new Error('Không xác định được ZaloSync.exe cho lịch chạy — hãy bật lịch từ ứng dụng Zalo Sync.');
}

/** Script PowerShell đăng ký tác vụ (thuần, để test). */
function buildInstallScript({ name, time, exe, workDir }) {
  return [
    `$ErrorActionPreference='Stop'`,
    `$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name`,
    `$action = New-ScheduledTaskAction -Execute '${psEscape(exe)}' -Argument '${TASK_ARGS}' ` +
      `-WorkingDirectory '${psEscape(workDir)}'`,
    `$daily = New-ScheduledTaskTrigger -Daily -At '${psEscape(time)}'`,
    // Trigger đăng nhập của CHÍNH user (-User $me) đăng ký được không cần admin;
    // chỉ trigger đăng nhập của MỌI user mới đòi admin.
    `$logon = New-ScheduledTaskTrigger -AtLogOn -User $me`,
    `$logon.Delay = '${LOGON_DELAY}'`,
    // StartWhenAvailable: nếu máy tắt lúc tới giờ, chạy bù ngay khi bật & đăng nhập lại.
    `$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries ` +
      `-StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) ` +
      `-RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew`,
    // -User (chính người dùng hiện tại) để đăng ký KHÔNG cần quyền admin; chạy khi đã đăng nhập.
    `Register-ScheduledTask -TaskName '${psEscape(name)}' -Action $action ` +
      `-Trigger @($daily,$logon) -Settings $set -User $me -Force | Out-Null`,
    `'OK'`,
  ].join('; ');
}

/** JSON do script query in ra → object (thêm `time` suy từ dailyStart). */
function parseQuery(text) {
  const o = JSON.parse(text);
  if (!o.exists) return o;
  const m = /T(\d{2}:\d{2})/.exec(o.dailyStart || '');
  return { ...o, time: m ? m[1] : null };
}

/** Trạng thái tác vụ hiện tại (name: mặc định tác vụ của app; legacy_migrate hỏi tên tác vụ bản cũ). */
function query(name = TASK_NAME) {
  const n = psEscape(name);
  // nextRun/lastRun dạng ISO-8601 kèm offset (GUI parse AssumeUniversal — chuỗi locale không offset sẽ lệch múi giờ)
  const script =
    `$t = Get-ScheduledTask -TaskName '${n}' -ErrorAction SilentlyContinue; ` +
    `if ($null -eq $t) { '{"exists":false}' } else { ` +
    `$i = Get-ScheduledTaskInfo -TaskName '${n}'; ` +
    `$d = @($t.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger' }) | Select-Object -First 1; ` +
    `$lg = @($t.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }); ` +
    `$o = [ordered]@{ exists=$true; state=[string]$t.State; ` +
    `nextRun=$(if ($i.NextRunTime) { $i.NextRunTime.ToString('o') } else { '' }); ` +
    `lastRun=$(if ($i.LastRunTime) { $i.LastRunTime.ToString('o') } else { '' }); lastResult=$i.LastTaskResult; ` +
    `execute=[string]$t.Actions[0].Execute; arguments=[string]$t.Actions[0].Arguments; ` +
    `logon=($lg.Count -gt 0); dailyStart=$(if ($d) { [string]$d.StartBoundary } else { '' }) }; ` +
    `$o | ConvertTo-Json -Compress }`;
  try {
    return parseQuery(runPowerShell(script).trim());
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

/** Tác vụ đã đúng giờ + exe + tham số + có trigger đăng nhập? */
function isTaskCurrent(info, { time, exe }) {
  return !!(info && info.exists && info.time === time &&
    String(info.execute || '').toLowerCase() === String(exe).toLowerCase() &&
    info.arguments === TASK_ARGS && info.logon === true);
}

/**
 * Bật lịch chạy hằng ngày lúc HH:MM (mặc định 04:15) + bù khi đăng nhập. Kiểm tra lại sau khi đăng ký (fail loud).
 */
function install(time, { name = TASK_NAME, exe } = {}) {
  const t = normTime(time);
  exe = exe || taskExe(); // ném lỗi TRƯỚC khi đụng PowerShell
  runPowerShell(buildInstallScript({ name, time: t, exe, workDir: configStore.paths().root }));
  const info = query(name);
  if (!isTaskCurrent(info, { time: t, exe }))
    throw new Error('Đã đăng ký lịch nhưng kiểm tra lại không khớp: ' + JSON.stringify(info));
  // run_sync.bat là di sản của cách chạy cũ — không còn dùng
  fs.rmSync(path.join(configStore.paths().root, 'run_sync.bat'), { force: true });
  // lưu giờ vào config._app
  try {
    const cfg = configStore.load();
    cfg._app = cfg._app || {};
    cfg._app.scheduleTime = t;
    configStore.save(cfg);
  } catch { /* chưa có config thì bỏ qua */ }
  return { ok: true, ...info };
}

function uninstall(name = TASK_NAME) {
  const n = psEscape(name);
  runPowerShell(`$ErrorActionPreference='Stop'; ` +
    `if (Get-ScheduledTask -TaskName '${n}' -ErrorAction SilentlyContinue) { ` +
    `Unregister-ScheduledTask -TaskName '${n}' -Confirm:$false -ErrorAction Stop }; 'OK'`);
  const info = query(name);
  if (info.error || info.exists) throw new Error('Không gỡ được lịch chạy tự động: ' + (info.error || 'tác vụ vẫn còn tồn tại'));
  return { ok: true, exists: false };
}

/**
 * Đối chiếu tác vụ với config + exe HIỆN TẠI; lệch thì đăng ký lại. App gọi mỗi lần khởi động. Bao gồm:
 * đổi giờ ở wizard, exe bị di chuyển/cập nhật, và tác vụ kiểu cũ (chạy run_sync.bat) → tự chuyển sang kiểu mới.
 * Lịch đang tắt thì tôn trọng, không tự bật.
 */
function refresh(info = query(), reinstall = install) {
  if (info.error) return { ok: false, error: info.error };
  if (!info.exists) return { ok: true, refreshed: false };
  let cfgTime;
  try { cfgTime = (configStore.load()._app || {}).scheduleTime; } catch { /* chưa có config → mặc định */ }
  const want = { time: normTime(cfgTime), exe: taskExe() };
  if (isTaskCurrent(info, want)) return { ok: true, refreshed: false };
  return { ...reinstall(want.time, { exe: want.exe }), refreshed: true };
}

module.exports = {
  TASK_NAME, TASK_ARGS, normTime, lastSlot, isRunDue, taskExe,
  buildInstallScript, parseQuery, isTaskCurrent, query, install, uninstall, refresh,
};
