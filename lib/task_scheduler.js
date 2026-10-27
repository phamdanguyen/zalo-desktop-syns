'use strict';
/**
 * task_scheduler.js — Bật/tắt/kiểm tra lịch chạy tự động hằng ngày qua Windows Task Scheduler.
 *
 * Tác vụ trỏ tới một file .bat trong %LOCALAPPDATA%\ZaloSync\run_sync.bat (app tự sinh), nên
 * đường dẫn tác vụ ổn định kể cả khi cập nhật/di chuyển chương trình. Mô phỏng thiết lập đã được
 * kiểm chứng của hệ thống (StartWhenAvailable + bù khi đăng nhập) nhưng chạy dưới quyền người
 * dùng hiện tại (không cần admin).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const configStore = require('./config_store');
const { resolveEngineDir } = require('./engine_path');

const { TASK_NAME } = configStore;

function psEscape(s) { return String(s).replace(/'/g, "''"); }

function runPowerShell(script) {
  return execFileSync('powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true });
}

/** Sinh/ghi đè run_sync.bat trỏ đúng node + engine + config hiện tại. */
function writeRunBat() {
  const p = configStore.ensureDirs();
  const nodeExe = process.execPath;
  const engineJs = path.join(resolveEngineDir(), 'daily_sync_568.js');
  const bat = [
    '@echo off',
    'chcp 65001 > nul',
    `set "LOG=${p.logFile}"`,
    `echo ====== TASK KHOI CHAY %date% %time% ====== >> "%LOG%"`,
    `"${nodeExe}" "${engineJs}" --config "${p.configFile}" --all >> "%LOG%" 2>&1`,
    'set EC=%ERRORLEVEL%',
    `echo ====== TASK KET THUC exit=%EC% %date% %time% ====== >> "%LOG%"`,
    'exit /b %EC%',
    '',
  ].join('\r\n');
  const batPath = path.join(p.root, 'run_sync.bat');
  fs.writeFileSync(batPath, bat, 'utf8');
  return batPath;
}

/** Trạng thái tác vụ hiện tại (name: mặc định tác vụ của app; legacy_migrate hỏi tên tác vụ bản cũ). */
function query(name = TASK_NAME) {
  const script =
    `$t = Get-ScheduledTask -TaskName '${psEscape(name)}' -ErrorAction SilentlyContinue; ` +
    `if ($null -eq $t) { '{"exists":false}' } else { ` +
    `$i = Get-ScheduledTaskInfo -TaskName '${psEscape(name)}'; ` +
    `$o = [ordered]@{ exists=$true; state=[string]$t.State; ` +
    `nextRun=[string]$i.NextRunTime; lastRun=[string]$i.LastRunTime; ` +
    `lastResult=$i.LastTaskResult }; $o | ConvertTo-Json -Compress }`;
  try {
    const out = runPowerShell(script).trim();
    return JSON.parse(out);
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

/**
 * Bật lịch chạy hằng ngày lúc HH:MM (mặc định 04:15) + bù khi đăng nhập.
 */
function install(time) {
  const t = /^\d{2}:\d{2}$/.test(time || '') ? time : '04:15';
  const batPath = writeRunBat();
  const script = [
    `$ErrorActionPreference='Stop'`,
    `$bat='${psEscape(batPath)}'`,
    `$wd='${psEscape(configStore.paths().root)}'`,
    `$action = New-ScheduledTaskAction -Execute $bat -WorkingDirectory $wd`,
    `$trgDaily = New-ScheduledTaskTrigger -Daily -At '${t}'`,
    // StartWhenAvailable: nếu máy tắt lúc tới giờ, chạy bù ngay khi bật & đăng nhập lại.
    `$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries ` +
      `-StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) ` +
      `-RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)`,
    // -User (chính người dùng hiện tại) để đăng ký KHÔNG cần quyền admin; chạy khi đã đăng nhập.
    // (KHÔNG dùng trigger AtLogOn vì trigger đăng-nhập mặc định đòi quyền admin.)
    `$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name`,
    `Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action ` +
      `-Trigger $trgDaily -Settings $set -User $me -Force | Out-Null`,
    `'OK'`,
  ].join('; ');
  runPowerShell(script);
  // lưu giờ vào config._app
  try {
    const cfg = configStore.load();
    cfg._app = cfg._app || {};
    cfg._app.scheduleTime = t;
    configStore.save(cfg);
  } catch { /* chưa có config thì bỏ qua */ }
  return query();
}

function uninstall(name = TASK_NAME) {
  const script = `Unregister-ScheduledTask -TaskName '${psEscape(name)}' -Confirm:$false -ErrorAction SilentlyContinue; 'OK'`;
  runPowerShell(script);
  return { exists: false };
}

/**
 * Lịch đã cài → ghi lại run_sync.bat theo node + engine của runtime HIỆN TẠI. App gọi mỗi lần khởi động:
 * bản exe mới giải nén runtime vào thư mục mới và xoá runtime cũ → bat cũ trỏ vào node.exe không còn tồn tại.
 * @param {{exists:boolean}} state trạng thái tác vụ (mặc định hỏi Task Scheduler)
 */
function refresh(state = query()) {
  if (!state.exists) return { ok: true, refreshed: false };
  return { ok: true, refreshed: true, bat: writeRunBat() };
}

module.exports = { TASK_NAME, query, install, uninstall, writeRunBat, refresh };
