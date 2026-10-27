'use strict';
// Chạy (từ app/): node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const scheduler = require('../lib/task_scheduler');
const { withFakeAppData } = require('./_helpers');

test('refresh: chưa cài lịch → không đụng tới run_sync.bat', () => {
  withFakeAppData((tmp, root) => {
    const r = scheduler.refresh({ exists: false });
    assert.equal(r.refreshed, false);
    assert.ok(!fs.existsSync(path.join(root, 'run_sync.bat')));
  });
});

test('refresh: đã cài lịch → ghi lại run_sync.bat trỏ vào node + engine của runtime HIỆN TẠI', () => {
  withFakeAppData((tmp, root) => {
    // giả lập bat cũ của bản exe trước, trỏ vào runtime đã bị xoá
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'run_sync.bat'), '"C:\\runtime\\OLD\\node\\node.exe" engine.js\r\n');

    const r = scheduler.refresh({ exists: true });
    assert.equal(r.refreshed, true);
    const bat = fs.readFileSync(path.join(root, 'run_sync.bat'), 'utf8');
    assert.ok(!bat.includes('OLD'), 'bat cũ phải bị ghi đè');
    assert.ok(bat.includes(`"${process.execPath}"`), 'trỏ vào node đang chạy');
    assert.match(bat, /daily_sync_568\.js/);
    assert.ok(bat.includes(path.join(root, 'config.json')), 'trỏ vào config của máy này');
  });
});
