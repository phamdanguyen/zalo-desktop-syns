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

// ---------- lastSlot / isRunDue ----------
const D = (d, hh, mm, ss = 0) => new Date(2026, 9, d, hh, mm, ss); // tháng 10, giờ địa phương

test('lastSlot: sau mốc → mốc hôm nay; trước mốc → mốc hôm qua', () => {
  assert.equal(+scheduler.lastSlot(D(27, 10, 0), '04:15'), +D(27, 4, 15));
  assert.equal(+scheduler.lastSlot(D(27, 3, 0), '04:15'), +D(26, 4, 15));
});

test('lastSlot: trong 2 phút đệm trước mốc vẫn tính là mốc hôm nay, 3 phút trước thì không', () => {
  assert.equal(+scheduler.lastSlot(D(27, 4, 13, 30), '04:15'), +D(27, 4, 15));
  assert.equal(+scheduler.lastSlot(D(27, 4, 12), '04:15'), +D(26, 4, 15));
});

test('lastSlot: giờ sai → dùng mặc định', () => {
  assert.equal(+scheduler.lastSlot(D(27, 10, 0), 'rac'), +D(27, 4, 15));
});

test('isRunDue: bỏ lỡ hôm nay (thành công gần nhất hôm qua) → đến hạn', () => {
  assert.equal(scheduler.isRunDue({ now: D(27, 9, 0), time: '04:15', lastSuccessAt: D(26, 4, 16).toISOString() }), true);
});

test('isRunDue: đã thành công sau mốc hôm nay → không đến hạn', () => {
  assert.equal(scheduler.isRunDue({ now: D(27, 9, 0), time: '04:15', lastSuccessAt: D(27, 4, 16).toISOString() }), false);
});

test('isRunDue: chưa tới mốc hôm nay mà đã thành công sau mốc hôm qua → không đến hạn', () => {
  assert.equal(scheduler.isRunDue({ now: D(27, 3, 0), time: '04:15', lastSuccessAt: D(26, 5, 0).toISOString() }), false);
});

test('isRunDue: máy tắt nhiều ngày → đến hạn; chạy bù xong ngay sau đó → không đến hạn nữa (đúng 1 lần)', () => {
  const last = D(22, 4, 16).toISOString();
  assert.equal(scheduler.isRunDue({ now: D(27, 9, 0), time: '04:15', lastSuccessAt: last }), true);
  const afterCatchUp = D(27, 9, 0, 40).toISOString();
  assert.equal(scheduler.isRunDue({ now: D(27, 9, 5), time: '04:15', lastSuccessAt: afterCatchUp }), false);
});

test('isRunDue: lastSuccessAt thiếu/rác → đến hạn', () => {
  for (const bad of [undefined, null, '', 'khong-phai-ngay'])
    assert.equal(scheduler.isRunDue({ now: D(27, 9, 0), time: '04:15', lastSuccessAt: bad }), true, String(bad));
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
  ...over,
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

      assert.ok(!fs.existsSync(path.join(root, 'run_sync.bat')), 'run_sync.bat cũ phải bị xoá');
      assert.equal(configStore.load()._app.scheduleTime, '07:30');

      const info2 = scheduler.install('08:45', { name, exe: EXE });
      assert.equal(info2.time, '08:45');
      const q2 = independentQuery(name);
      assert.equal(q2.daily.length, 1);
      assert.match(q2.daily[0], /T08:45:00/);
      assert.equal(q2.logon.length, 1);
      assert.equal(configStore.load()._app.scheduleTime, '08:45');

      assert.deepEqual(scheduler.uninstall(name), { ok: true, exists: false });
      assert.equal(scheduler.query(name).exists, false);
      assert.deepEqual(scheduler.uninstall(name), { ok: true, exists: false }); // idempotent
    } finally {
      try { ps(`Unregister-ScheduledTask -TaskName '${name}' -Confirm:$false -ErrorAction SilentlyContinue`); } catch { /* đã dọn */ }
    }
  });
});
