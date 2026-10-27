'use strict';
// Chạy (từ app/): node --test test/*.test.js
// Để ngoài lib/ vì build.ps1 nhúng mọi lib/*.js vào exe.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lastRun, redactConfig, buildReport, exportLog } = require('../lib/log_export');
const { withFakeAppData } = require('./_helpers');

const KEY = '3cc80a2d0000000000000000deadbeef';
const LOG = [
  '',
  '====== KHỞI CHẠY 2026-10-26T04:00:00.000Z --config c.json --all ======',
  'lượt cũ',
  '====== KẾT THÚC exit=1 2026-10-26T04:01:00.000Z ======',
  '',
  '====== KHỞI CHẠY 2026-10-27T04:00:00.000Z --config c.json --all ======',
  'lượt mới',
  '====== KẾT THÚC exit=0 2026-10-27T04:01:00.000Z ======',
  '',
].join('\r\n');

test('lastRun chỉ lấy lượt chạy cuối cùng', () => {
  const r = lastRun(LOG);
  assert.match(r, /^====== KHỞI CHẠY 2026-10-27/);
  assert.match(r, /lượt mới/);
  assert.match(r, /KẾT THÚC exit=0/);
  assert.doesNotMatch(r, /lượt cũ/);
});

test('lastRun nhận banner của tác vụ chạy theo lịch (run_sync.bat)', () => {
  const r = lastRun(LOG + '====== TASK KHOI CHAY Tue 10/28/2026  4:15:00.12 ====== \r\nlượt theo lịch\r\n');
  assert.match(r, /^====== TASK KHOI CHAY/);
  assert.match(r, /lượt theo lịch/);
  assert.doesNotMatch(r, /lượt mới/);
});

test('lastRun khi chưa có banner → trả toàn bộ log', () => {
  assert.equal(lastRun('a\nb\n'), 'a\nb');
  assert.equal(lastRun(''), '');
});

test('redactConfig che khóa giải mã, giữ trường khác, không sửa object gốc', () => {
  const cfg = { key: KEY, downloadDir: 'D:/x' };
  const r = redactConfig(cfg);
  assert.equal(r.key, '***');
  assert.equal(r.downloadDir, 'D:/x');
  assert.equal(cfg.key, KEY);
});

test('buildReport gồm môi trường + trạng thái + cấu hình + log lượt cuối, không lộ khóa (kể cả trong log)', () => {
  const txt = buildReport({
    logText: LOG + 'debug key=' + KEY + '\n',
    status: { lastRunExit: 0 },
    config: { key: KEY, downloadDir: 'D:/x' },
    runtime: 'Node vX',
    now: new Date('2026-10-27T05:00:00Z'),
  });
  assert.ok(!txt.includes(KEY), 'khóa không được xuất hiện trong file xuất');
  assert.match(txt, /Node vX/);
  assert.match(txt, /"lastRunExit": 0/);
  assert.match(txt, /"downloadDir": "D:\/x"/);
  assert.match(txt, /lượt mới/);
  assert.doesNotMatch(txt, /lượt cũ/);
});

test('exportLog mặc định ghi vào thư mục báo cáo của cấu hình, tên có dấu thời gian', () => {
  withFakeAppData((tmp, root) => {
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    const reportDir = path.join(tmp, 'baocao').replace(/\\/g, '/'); // config lưu dạng '/'
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ key: KEY, reportDir }));
    fs.writeFileSync(path.join(root, 'logs', 'daily_sync.log'), LOG);

    const file = exportLog({ status: { groupCount: 1 } });
    assert.equal(path.dirname(file), path.resolve(reportDir));
    assert.match(path.basename(file), /^ZaloSync_log_\d{8}_\d{6}\.txt$/);
    const txt = fs.readFileSync(file, 'utf8');
    assert.match(txt, /^# Zalo Sync — log lượt chạy/);
    assert.match(txt, /lượt mới/);
    assert.match(txt, /"groupCount": 1/);
    assert.ok(!txt.includes(KEY));
  });
});

test('exportLog khi chưa có cấu hình/log vẫn xuất được, ghi đúng --out', () => {
  withFakeAppData((tmp) => {
    const out = path.join(tmp, 'sub', 'x.txt');
    const file = exportLog({ out, status: {} });
    assert.equal(file, path.resolve(out));
    const txt = fs.readFileSync(file, 'utf8');
    assert.match(txt, /\(chưa có cấu hình\)/);
    assert.match(txt, /\(chưa có log\)/);
  });
});
