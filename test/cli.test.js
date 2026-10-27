'use strict';
// Chạy (từ app/): node --test test/*.test.js
// Hợp đồng GUI <-> CLI: chạy `node cli.js` thật với LOCALAPPDATA/USERPROFILE giả.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'cli.js');

function rig() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zalosync-cli-'));
  const engine = path.join(tmp, 'engine');
  fs.mkdirSync(engine);
  fs.writeFileSync(path.join(engine, 'daily_sync_568.js'), `console.log('fake engine ok ' + process.argv.slice(2).join(' '));\n`);
  // cli.js nạp group_discover → require engine/lib_snapshot lúc khởi động; stub cho engine giả
  fs.writeFileSync(path.join(engine, 'lib_snapshot.js'), 'module.exports = { snapshotDbWithWal() {} };\n');
  const root = path.join(tmp, 'ZaloSync');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ _app: { scheduleTime: '04:15' } }));
  const env = { ...process.env, LOCALAPPDATA: tmp, USERPROFILE: tmp, ZALOSYNC_ENGINE_DIR: engine };
  delete env.ZALOSYNC_EXE;
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  const log = () => fs.readFileSync(path.join(root, 'logs', 'daily_sync.log'), 'utf8');
  return { tmp, cli, log };
}

test('cli run --scheduled: lần 1 chạy bù (có banner + [TỰ ĐỘNG]), lần 2 bị bỏ qua', () => {
  const r = rig();
  try {
    const a = r.cli('run', '--scheduled');
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /KHỞI CHẠY/);
    assert.match(a.stdout, /fake engine ok .*--all/);
    assert.match(r.log(), /\[TỰ ĐỘNG\].*chạy \(lần thành công/);

    const b = r.cli('run', '--scheduled');
    assert.equal(b.status, 0, b.stderr);
    assert.doesNotMatch(b.stdout, /fake engine ok/);
    assert.match(r.log(), /\[TỰ ĐỘNG\].*bỏ qua/);
  } finally { fs.rmSync(r.tmp, { recursive: true, force: true }); }
});

test('cli schedule-set thiếu ZALOSYNC_EXE: đúng 1 dòng JSON {ok:false,error} nhắc ZaloSync.exe, exit 1', () => {
  const r = rig();
  try {
    const res = r.cli('schedule-set', '--time', '07:30');
    assert.equal(res.status, 1);
    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const o = JSON.parse(lines[0]);
    assert.equal(o.ok, false);
    assert.match(o.error, /ZaloSync\.exe/);
  } finally { fs.rmSync(r.tmp, { recursive: true, force: true }); }
});
