'use strict';
// Chạy (từ app/): node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const scheduler = require('../lib/task_scheduler');
const configStore = require('../lib/config_store');
const { withFakeAppData } = require('./_helpers');

const EXE = process.execPath; // một file có thật để giả làm ZaloSync.exe

function withExeEnv(value, fn) {
  const old = process.env.ZALOSYNC_EXE;
  if (value === undefined) delete process.env.ZALOSYNC_EXE; else process.env.ZALOSYNC_EXE = value;
  try { return fn(); } finally {
    if (old === undefined) delete process.env.ZALOSYNC_EXE; else process.env.ZALOSYNC_EXE = old;
  }
}

// ---------- normTime ----------
test('normTime: giờ hợp lệ giữ nguyên, sai định dạng/ngoài miền → mặc định 04:15', () => {
  assert.equal(scheduler.normTime('07:30'), '07:30');
  assert.equal(scheduler.normTime('00:00'), '00:00');
  assert.equal(scheduler.normTime('23:59'), '23:59');
  for (const bad of ['25:00', '7:30', '12:60', '07:3', undefined, null, '', 'abc'])
    assert.equal(scheduler.normTime(bad), '04:15', String(bad));
});

// ---------- shouldRun ----------
const NOW = new Date(2026, 9, 27, 9, 0, 0);
const ago = (min) => new Date(NOW.getTime() - min * 60000).toISOString();

test('shouldRun: chưa từng thành công / giá trị rác → chạy', () => {
  for (const bad of [undefined, null, '', 'khong-phai-ngay'])
    assert.equal(scheduler.shouldRun({ now: NOW, lastSuccessAt: bad }), true, String(bad));
});

test('shouldRun: vừa thành công 10 hoặc 29 phút trước → bỏ qua (các trigger kích sát nhau chỉ 1 lượt)', () => {
  assert.equal(scheduler.shouldRun({ now: NOW, lastSuccessAt: ago(10) }), false);
  assert.equal(scheduler.shouldRun({ now: NOW, lastSuccessAt: ago(29) }), false);
});

test('shouldRun: 31 phút, hôm qua, nhiều ngày trước → chạy (mỗi lần đăng nhập đều đồng bộ)', () => {
  for (const m of [31, 24 * 60, 5 * 24 * 60])
    assert.equal(scheduler.shouldRun({ now: NOW, lastSuccessAt: ago(m) }), true, m + ' phút');
});

test('shouldRun: lastSuccessAt ở tương lai (đồng hồ bị chỉnh lùi) → chạy', () => {
  assert.equal(scheduler.shouldRun({ now: NOW, lastSuccessAt: ago(-60) }), true);
});

// ---------- buildInstallScript ----------
test('buildInstallScript: trigger hằng ngày + đăng nhập của CHÍNH user (trễ PT10M), bù lịch, không chạy trùng, action = exe --scheduled', () => {
  const s = scheduler.buildInstallScript({ name: 'T1', time: '07:30', exe: 'C:\\App\\ZaloSync.exe', workDir: 'C:\\W' });
  assert.match(s, /\$ErrorActionPreference='Stop'/);
  assert.match(s, /New-ScheduledTaskAction -Execute 'C:\\App\\ZaloSync\.exe' -Argument '--scheduled' -WorkingDirectory 'C:\\W'/);
  assert.match(s, /New-ScheduledTaskTrigger -Daily -At '07:30'/);
  assert.match(s, /New-ScheduledTaskTrigger -AtLogOn -User \$me/);
  assert.match(s, /\.Delay\s*=\s*'PT10M'/);
  assert.match(s, /-StartWhenAvailable/);
  assert.match(s, /-MultipleInstances IgnoreNew/);
  assert.match(s, /Register-ScheduledTask -TaskName 'T1'.*-User \$me -Force/);
  assert.match(s, /-Trigger @\(\$daily,\$logon\)/);
  assert.doesNotMatch(s, /-Password/);
  assert.doesNotMatch(s, /RunLevel/);
});

test('buildInstallScript: dấu nháy đơn trong đường dẫn được escape', () => {
  const s = scheduler.buildInstallScript({ name: 'T', time: '04:15', exe: "C:\\O'Neil\\ZaloSync.exe", workDir: "C:\\O'Neil" });
  assert.ok(s.includes("-Execute 'C:\\O''Neil\\ZaloSync.exe'"));
  assert.ok(s.includes("-WorkingDirectory 'C:\\O''Neil'"));
});

// ---------- parseQuery / isTaskCurrent ----------
const rawTask = (over = {}) => JSON.stringify({
  exists: true, state: 'Ready', nextRun: 'x', lastRun: 'y', lastResult: 0,
  execute: EXE, arguments: '--scheduled', logon: true, dailyStart: '2026-10-27T07:30:00',
  startup: `"${EXE}" --tray`,
  ...over,
});

test('startupCommand: exe trong ngoặc kép + --tray', () => {
  assert.equal(scheduler.TRAY_ARG, '--tray');
  assert.equal(scheduler.startupCommand('C:\\App Dir\\ZaloSync.exe'), '"C:\\App Dir\\ZaloSync.exe" --tray');
});

test('isTaskCurrent: thiếu/sai giá trị khởi động cùng Windows → không current; khác hoa/thường → vẫn current', () => {
  const want = { time: '07:30', exe: EXE };
  assert.equal(scheduler.isTaskCurrent(scheduler.parseQuery(rawTask({ startup: '' })), want), false);
  assert.equal(scheduler.isTaskCurrent(scheduler.parseQuery(rawTask({ startup: undefined })), want), false);
  assert.equal(scheduler.isTaskCurrent(scheduler.parseQuery(rawTask({ startup: `"C:\\cu\\ZaloSync.exe" --tray` })), want), false);
  assert.equal(scheduler.isTaskCurrent(scheduler.parseQuery(rawTask({ startup: `"${EXE}" --tray`.toUpperCase() })), want), true);
});

test('buildInstallScript: đặt giá trị HKCU Run tên = tên tác vụ, dữ liệu = "exe" --tray (sau Register)', () => {
  const s = scheduler.buildInstallScript({ name: "T'1", time: '07:30', exe: 'C:\\App\\ZaloSync.exe', workDir: 'C:\\W' });
  const set = "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'T''1' -Value '\"C:\\App\\ZaloSync.exe\" --tray'";
  assert.ok(s.includes(set), s);
  assert.ok(s.indexOf('Set-ItemProperty') > s.indexOf('Register-ScheduledTask'));
});

test('parseQuery: suy time từ dailyStart; không có trigger ngày → null', () => {
  const a = scheduler.parseQuery(rawTask());
  assert.equal(a.time, '07:30');
  assert.equal(a.exists, true);
  assert.equal(scheduler.parseQuery(rawTask({ dailyStart: '' })).time, null);
  assert.deepEqual(scheduler.parseQuery('{"exists":false}'), { exists: false });
});

test('isTaskCurrent: khớp giờ + exe + --scheduled + trigger đăng nhập', () => {
  const info = scheduler.parseQuery(rawTask());
  assert.equal(scheduler.isTaskCurrent(info, { time: '07:30', exe: EXE }), true);
});

test('isTaskCurrent: lệch giờ → không current', () => {
  assert.equal(scheduler.isTaskCurrent(scheduler.parseQuery(rawTask()), { time: '08:00', exe: EXE }), false);
});

test('isTaskCurrent: exe chỉ khác hoa/thường → vẫn current; khác đường dẫn → không', () => {
  const info = scheduler.parseQuery(rawTask({ execute: EXE.toUpperCase() }));
  assert.equal(scheduler.isTaskCurrent(info, { time: '07:30', exe: EXE.toLowerCase() }), true);
  assert.equal(scheduler.isTaskCurrent(info, { time: '07:30', exe: EXE + 'x' }), false);
});

test('isTaskCurrent: tác vụ cũ chạy run_sync.bat → không current (để tự migrate)', () => {
  const info = scheduler.parseQuery(rawTask({ execute: 'C:\\Users\\x\\ZaloSync\\run_sync.bat', arguments: '' }));
  assert.equal(scheduler.isTaskCurrent(info, { time: '07:30', exe: EXE }), false);
});

test('isTaskCurrent: thiếu trigger đăng nhập / không tồn tại → không current', () => {
  assert.equal(scheduler.isTaskCurrent(scheduler.parseQuery(rawTask({ logon: false })), { time: '07:30', exe: EXE }), false);
  assert.equal(scheduler.isTaskCurrent({ exists: false }, { time: '07:30', exe: EXE }), false);
});

// ---------- taskExe / install (không cần PowerShell) ----------
test('taskExe: không có ZALOSYNC_EXE (hoặc file không tồn tại) → lỗi rõ ràng', () => {
  withExeEnv(undefined, () => assert.throws(() => scheduler.taskExe(), /ZaloSync\.exe/));
  withExeEnv(path.join(__dirname, 'khong-ton-tai.exe'), () => assert.throws(() => scheduler.taskExe(), /ZaloSync\.exe/));
  withExeEnv(EXE, () => assert.equal(scheduler.taskExe(), EXE));
});

test('install: thiếu ZALOSYNC_EXE → ném lỗi rõ ràng, không đăng ký gì', () => {
  withFakeAppData(() => withExeEnv(undefined, () => {
    assert.throws(() => scheduler.install('07:30', { name: 'ZaloSync_Test_never' }), /ZaloSync\.exe/);
  }));
});

// ---------- refresh ----------
function refreshWith(info, cfgTime, { exe = EXE } = {}) {
  return withFakeAppData(() => withExeEnv(exe, () => {
    if (cfgTime !== null) {
      configStore.save({ _app: cfgTime === undefined ? {} : { scheduleTime: cfgTime } });
    }
    const calls = [];
    const r = scheduler.refresh(info, (time, opt) => { calls.push({ time, opt }); return { ok: true, exists: true }; });
    return { r, calls };
  }));
}
const current = (time = '07:30') => scheduler.parseQuery(rawTask({ dailyStart: `2026-10-27T${time}:00` }));

test('refresh: lịch đang tắt → tôn trọng, không cài lại', () => {
  const { r, calls } = refreshWith({ exists: false }, '07:30');
  assert.deepEqual(r, { ok: true, refreshed: false });
  assert.equal(calls.length, 0);
});

test('refresh: tác vụ đã khớp config + exe → không cài lại', () => {
  const { r, calls } = refreshWith(current('07:30'), '07:30');
  assert.equal(r.refreshed, false);
  assert.equal(calls.length, 0);
});

test('refresh: tác vụ cũ chạy run_sync.bat → cài lại với giờ trong config + exe hiện tại', () => {
  const legacy = scheduler.parseQuery(rawTask({ execute: 'C:\\x\\run_sync.bat', arguments: '', logon: false }));
  const { r, calls } = refreshWith(legacy, '06:00');
  assert.equal(r.refreshed, true);
  assert.deepEqual(calls, [{ time: '06:00', opt: { exe: EXE } }]);
});

test('refresh: đổi giờ trong wizard (config khác tác vụ) → cài lại với giờ MỚI', () => {
  const { r, calls } = refreshWith(current('07:30'), '09:10');
  assert.equal(r.refreshed, true);
  assert.equal(calls[0].time, '09:10');
});

test('refresh: tác vụ đã có nhưng thiếu giá trị Run (bản cài trước khi có khởi động cùng Windows) → cài lại', () => {
  const { r, calls } = refreshWith(scheduler.parseQuery(rawTask({ startup: '' })), '07:30');
  assert.equal(r.refreshed, true);
  assert.deepEqual(calls, [{ time: '07:30', opt: { exe: EXE } }]);
});

test('refresh: không có config → dùng giờ mặc định 04:15', () => {
  const { calls } = refreshWith(current('07:30'), null);
  assert.equal(calls[0].time, '04:15');
});

test('refresh: info.error → ok:false, không cài lại', () => {
  const { r, calls } = refreshWith({ exists: false, error: 'boom' }, '07:30');
  assert.deepEqual(r, { ok: false, error: 'boom' });
  assert.equal(calls.length, 0);
});

test('refresh: thiếu ZALOSYNC_EXE khi tác vụ đang bật → ném lỗi, không cài lại', () => {
  withFakeAppData(() => withExeEnv(undefined, () => {
    let called = false;
    assert.throws(() => scheduler.refresh(current('07:30'), () => { called = true; }), /ZaloSync\.exe/);
    assert.equal(called, false);
  }));
});

// ---------- TÍCH HỢP với Windows Task Scheduler thật (tên tác vụ ngẫu nhiên, luôn dọn) ----------
function ps(script) {
  return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true }).trim();
}
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
// đọc độc lập bằng reg.exe; không có → ''
function runValue(name) {
  try {
    const out = execFileSync('reg', ['query', RUN_KEY, '/v', name], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /REG_SZ\s+(.*)/.exec(out);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
function independentQuery(name) {
  return JSON.parse(ps(
    `$t = Get-ScheduledTask -TaskName '${name}'; ` +
    `$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name; ` +
    `[ordered]@{ me=$me; logonType=[string]$t.Principal.LogonType; runLevel=[string]$t.Principal.RunLevel; ` +
    `startWhenAvailable=[bool]$t.Settings.StartWhenAvailable; multi=[string]$t.Settings.MultipleInstances; ` +
    `execute=$t.Actions[0].Execute; arguments=$t.Actions[0].Arguments; ` +
    `logon=@($t.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' } | ForEach-Object { [ordered]@{ user=$_.UserId; delay=[string]$_.Delay } }); ` +
    `daily=@($t.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger' } | ForEach-Object { [string]$_.StartBoundary }) ` +
    `} | ConvertTo-Json -Compress -Depth 5`));
}

test('TÍCH HỢP: install/uninstall trên Task Scheduler thật', { skip: process.platform !== 'win32' && 'chỉ chạy trên Windows' }, () => {
  const name = 'ZaloSync_Test_' + Math.random().toString(36).slice(2, 10);
  assert.notEqual(name, 'ZaloSync_Daily');
  withFakeAppData((tmp, root) => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'run_sync.bat'), '@echo off\r\n');
    configStore.save({ _app: { scheduleTime: '01:00' } });
    try {
      const info = scheduler.install('07:30', { name, exe: EXE });
      assert.equal(info.ok, true);
      assert.equal(scheduler.isTaskCurrent(info, { time: '07:30', exe: EXE }), true);
      const next = new Date(info.nextRun);
      assert.ok(!isNaN(next), 'nextRun phải là ISO hợp lệ: ' + info.nextRun);
      assert.match(info.nextRun, /(Z|[+-]\d{2}:\d{2})$/, 'nextRun phải kèm offset');
      assert.equal(`${next.getHours()}:${next.getMinutes()}`, '7:30');
      assert.ok(next.getTime() > Date.now(), 'nextRun phải ở tương lai');

      const q =independentQuery(name);
      assert.equal(q.logonType, 'Interactive');
      assert.equal(q.runLevel, 'Limited');
      assert.equal(q.startWhenAvailable, true);
      assert.equal(q.multi, 'IgnoreNew');
      assert.equal(q.execute.toLowerCase(), EXE.toLowerCase());
      assert.equal(q.arguments, '--scheduled');
      assert.equal(q.logon.length, 1);
      assert.equal(q.logon[0].user.toLowerCase(), q.me.toLowerCase());
      assert.equal(q.logon[0].delay, 'PT10M');
      assert.equal(q.daily.length, 1);
      assert.match(q.daily[0], /T07:30:00/);

      assert.equal(runValue(name), `"${EXE}" --tray`);
      assert.equal(info.startup, `"${EXE}" --tray`);
      assert.ok(!fs.existsSync(path.join(root, 'run_sync.bat')), 'run_sync.bat cũ phải bị xoá');
      assert.equal(configStore.load()._app.scheduleTime, '07:30');

      const info2 = scheduler.install('08:45', { name, exe: EXE });
      assert.equal(info2.time, '08:45');
      const q2 = independentQuery(name);
      assert.equal(q2.daily.length, 1);
      assert.match(q2.daily[0], /T08:45:00/);
      assert.equal(q2.logon.length, 1);
      assert.equal(configStore.load()._app.scheduleTime, '08:45');
      assert.equal(runValue(name), `"${EXE}" --tray`);

      assert.deepEqual(scheduler.uninstall(name), { ok: true, exists: false });
      assert.equal(scheduler.query(name).exists, false);
      assert.equal(runValue(name), '', 'giá trị Run phải bị gỡ');
      assert.deepEqual(scheduler.uninstall(name), { ok: true, exists: false }); // idempotent
    } finally {
      try { ps(`Unregister-ScheduledTask -TaskName '${name}' -Confirm:$false -ErrorAction SilentlyContinue`); } catch { /* đã dọn */ }
      try { ps(`Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '${name}' -ErrorAction SilentlyContinue`); } catch { /* đã dọn */ }
    }
  });
});
