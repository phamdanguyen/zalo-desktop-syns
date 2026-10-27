'use strict';
// Chạy (từ app/): node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { migrate, LEGACY_TASK } = require('../lib/legacy_migrate');
const { withFakeAppData } = require('./_helpers');

const OLD_LABEL = 'Zalo Sync 568 — dữ liệu nhóm công trường';

/** Dựng bản cài cũ %LOCALAPPDATA%\ZaloSync568 giống máy thật: config + tiến độ + log + runtime (+ bat nếu đã bật lịch). */
function seedLegacy(tmp, { cfg = {}, bat = true } = {}) {
  const old = path.join(tmp, 'ZaloSync568');
  const fwd = (f) => path.join(old, f).replace(/\\/g, '/');
  fs.mkdirSync(path.join(old, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(old, 'runtime', '639286737999218015', 'node'), { recursive: true });
  fs.writeFileSync(path.join(old, 'config.json'), JSON.stringify({
    key: 'k', projectLabel: OLD_LABEL, targetGroups: ['g1', 'g2'],
    downloadDir: 'C:/Users/u/Desktop/New folder', reportDir: 'C:/Users/u/Documents/ZaloSync568/baocao',
    cursorFile: fwd('cursor.json'), manifestFile: fwd('manifest.json'),
    _app: { uid: '1', scheduleTime: '05:30' }, ...cfg,
  }));
  fs.writeFileSync(path.join(old, 'cursor.json'), '{"g1":42}');
  fs.writeFileSync(path.join(old, 'manifest.json'), '{"files":{"a":1}}');
  fs.writeFileSync(path.join(old, 'state.json'), '{"lastRunExit":0}');
  fs.writeFileSync(path.join(old, 'logs', 'daily_sync.log'), 'log bản cũ\n');
  if (bat) fs.writeFileSync(path.join(old, 'run_sync.bat'), '@echo off\r\n');
  return old;
}

/** Task Scheduler giả: ghi lại lời gọi, không đụng Windows thật. */
function fakeScheduler(legacyTask = { exists: true }) {
  const calls = [];
  return {
    calls,
    query: (name) => { calls.push(['query', name]); return legacyTask; },
    uninstall: (name) => { calls.push(['uninstall', name]); return { exists: false }; },
    install: (time) => { calls.push(['install', time]); return { exists: true }; },
  };
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('không có bản cũ → không làm gì, không gọi Task Scheduler', () => {
  withFakeAppData((tmp, root) => {
    const s = fakeScheduler();
    assert.deepEqual(migrate(s), { ok: true, migrated: false });
    assert.ok(!fs.existsSync(root));
    assert.deepEqual(s.calls, []);
  });
});

test('chuyển cấu hình + tiến độ đồng bộ sang thư mục mới, rồi xoá thư mục cũ (cả runtime cũ)', () => {
  withFakeAppData((tmp, root) => {
    const old = seedLegacy(tmp);
    const r = migrate(fakeScheduler());
    assert.equal(r.ok, true);
    assert.equal(r.migrated, true);

    const cfg = readJson(path.join(root, 'config.json'));
    assert.deepEqual(cfg.targetGroups, ['g1', 'g2'], 'giữ nhóm đang đồng bộ');
    assert.equal(cfg.key, 'k');
    assert.equal(cfg.downloadDir, 'C:/Users/u/Desktop/New folder', 'thư mục dữ liệu người dùng KHÔNG bị di chuyển');
    assert.equal(cfg.reportDir, 'C:/Users/u/Documents/ZaloSync568/baocao');
    assert.equal(cfg.cursorFile, path.join(root, 'cursor.json').replace(/\\/g, '/'), 'con trỏ trỏ sang thư mục mới');
    assert.equal(cfg.manifestFile, path.join(root, 'manifest.json').replace(/\\/g, '/'));
    assert.equal(cfg.projectLabel, 'Zalo Sync — dữ liệu nhóm công trường', 'nhãn mặc định cũ → nhãn mới');

    assert.equal(fs.readFileSync(path.join(root, 'cursor.json'), 'utf8'), '{"g1":42}');
    assert.equal(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'), '{"files":{"a":1}}');
    assert.equal(fs.readFileSync(path.join(root, 'state.json'), 'utf8'), '{"lastRunExit":0}');
    // log bản cũ (banner/đường dẫn tên cũ) cất riêng → ô log của app bắt đầu sạch, lịch sử vẫn còn
    assert.equal(fs.readFileSync(path.join(root, 'logs', 'daily_sync_ban_cu.log'), 'utf8'), 'log bản cũ\n');
    assert.ok(!fs.existsSync(path.join(root, 'logs', 'daily_sync.log')));
    assert.ok(!fs.existsSync(path.join(root, 'runtime')), 'runtime cũ không chép sang (exe mới tự giải nén)');
    assert.ok(!fs.existsSync(old), 'thư mục cũ đã dọn');
  });
});

test('nhãn dự án người dùng tự đặt được giữ nguyên', () => {
  withFakeAppData((tmp, root) => {
    seedLegacy(tmp, { cfg: { projectLabel: 'Dự án của tôi' } });
    migrate(fakeScheduler());
    assert.equal(readJson(path.join(root, 'config.json')).projectLabel, 'Dự án của tôi');
  });
});

test('đã bật lịch ở bản cũ → cài tác vụ mới cùng giờ RỒI mới gỡ tác vụ cũ (không chạy trùng, không lúc nào mất lịch)', () => {
  withFakeAppData((tmp) => {
    seedLegacy(tmp);
    const s = fakeScheduler({ exists: true });
    migrate(s);
    assert.deepEqual(s.calls, [['query', 'ZaloSync568_Daily'], ['install', '05:30'], ['uninstall', 'ZaloSync568_Daily']]);
    assert.equal(LEGACY_TASK, 'ZaloSync568_Daily');
  });
});

test('có run_sync.bat nhưng tác vụ cũ đã bị gỡ → không cài tác vụ mới', () => {
  withFakeAppData((tmp) => {
    seedLegacy(tmp);
    const s = fakeScheduler({ exists: false });
    migrate(s);
    assert.deepEqual(s.calls, [['query', 'ZaloSync568_Daily']]);
  });
});

test('bản cũ chưa từng bật lịch (không có run_sync.bat) → không gọi Task Scheduler', () => {
  withFakeAppData((tmp) => {
    seedLegacy(tmp, { bat: false });
    const s = fakeScheduler();
    assert.equal(migrate(s).migrated, true);
    assert.deepEqual(s.calls, []);
  });
});

test('không hỏi được Task Scheduler → báo lỗi, GIỮ thư mục cũ; lần sau thử lại thì hoàn tất', () => {
  withFakeAppData((tmp, root) => {
    const old = seedLegacy(tmp);
    const r1 = migrate(fakeScheduler({ exists: false, error: 'Access denied' }));
    assert.equal(r1.ok, false);
    assert.match(r1.error, /Access denied/);
    assert.ok(fs.existsSync(path.join(old, 'run_sync.bat')), 'giữ bat cũ để lần sau còn nhận ra tác vụ cũ');
    assert.ok(fs.existsSync(path.join(root, 'config.json')), 'cấu hình đã chuyển vẫn dùng được ngay');

    const s = fakeScheduler({ exists: true });
    const r2 = migrate(s);
    assert.equal(r2.ok, true);
    assert.deepEqual(s.calls.map((c) => c[0]), ['query', 'install', 'uninstall']);
    assert.ok(!fs.existsSync(old));
  });
});

test('đã có cấu hình bản mới → không ghi đè, chỉ dọn bản cũ', () => {
  withFakeAppData((tmp, root) => {
    const old = seedLegacy(tmp, { bat: false });
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ projectLabel: 'mới', targetGroups: ['x'] }));
    migrate(fakeScheduler());
    assert.deepEqual(readJson(path.join(root, 'config.json')), { projectLabel: 'mới', targetGroups: ['x'] });
    assert.ok(!fs.existsSync(path.join(root, 'cursor.json')), 'không trộn tiến độ cũ vào cấu hình mới');
    assert.ok(!fs.existsSync(old));
  });
});

// ---------------------------------------------------------------------------
// Cấu hình do bản cũ tạo (kể cả khi thư mục %LOCALAPPDATA%\ZaloSync568 đã chuyển xong từ trước)
// ---------------------------------------------------------------------------
/** Ghi config bản mới (đã chuyển) với các trường cho trước; _app có nghĩa là do app sinh ra. */
function seedConfig(root, cfg) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ key: 'k', targetGroups: ['g1'], _app: { scheduleTime: '04:15' }, ...cfg }));
}
const fwd = (p) => p.replace(/\\/g, '/');

test('cấu hình app cũ thiếu projectCode/scheduledTaskName → bổ sung (engine bỏ "568", kiểm định đúng tác vụ của app)', () => {
  withFakeAppData((tmp, root) => {
    seedConfig(root, { downloadDir: fwd(path.join(tmp, 'X')), reportDir: fwd(path.join(tmp, 'Y')) });
    assert.deepEqual(migrate(fakeScheduler()), { ok: true, migrated: true });
    assert.equal(readJson(path.join(root, 'config.json')).projectCode, '');
    assert.equal(readJson(path.join(root, 'config.json')).scheduledTaskName, 'ZaloSync_Daily');
    assert.deepEqual(migrate(fakeScheduler()), { ok: true, migrated: false }, 'lần sau không còn gì để làm');
  });
});

test('thư mục MẶC ĐỊNH cũ Documents\\ZaloSync568 → đổi tên thành Documents\\ZaloSync, cấu hình trỏ theo', () => {
  withFakeAppData((tmp, root) => {
    const oldDocs = path.join(tmp, 'Documents', 'ZaloSync568');
    fs.mkdirSync(path.join(oldDocs, 'data', 'g1'), { recursive: true });
    fs.mkdirSync(path.join(oldDocs, 'baocao'), { recursive: true });
    fs.writeFileSync(path.join(oldDocs, 'data', 'g1', 'a.pdf'), 'A');
    fs.writeFileSync(path.join(oldDocs, 'baocao', 'r.md'), 'R');
    seedConfig(root, { downloadDir: fwd(path.join(oldDocs, 'data')), reportDir: fwd(path.join(oldDocs, 'baocao')) });

    migrate(fakeScheduler());
    const newDocs = path.join(tmp, 'Documents', 'ZaloSync');
    const cfg = readJson(path.join(root, 'config.json'));
    assert.equal(cfg.downloadDir, fwd(path.join(newDocs, 'data')));
    assert.equal(cfg.reportDir, fwd(path.join(newDocs, 'baocao')));
    assert.equal(fs.readFileSync(path.join(newDocs, 'data', 'g1', 'a.pdf'), 'utf8'), 'A', 'dữ liệu đi theo');
    assert.equal(fs.readFileSync(path.join(newDocs, 'baocao', 'r.md'), 'utf8'), 'R');
    assert.ok(!fs.existsSync(oldDocs));
  });
});

test('thư mục dữ liệu NGƯỜI DÙNG TỰ CHỌN giữ nguyên; chỉ thư mục mặc định cũ được đổi tên', () => {
  withFakeAppData((tmp, root) => {
    const own = fwd(path.join(tmp, 'Desktop', 'New folder'));
    const oldDocs = path.join(tmp, 'Documents', 'ZaloSync568');
    fs.mkdirSync(path.join(oldDocs, 'baocao'), { recursive: true });
    seedConfig(root, { downloadDir: own, reportDir: fwd(path.join(oldDocs, 'baocao')) });

    migrate(fakeScheduler());
    const cfg = readJson(path.join(root, 'config.json'));
    assert.equal(cfg.downloadDir, own);
    assert.equal(cfg.reportDir, fwd(path.join(tmp, 'Documents', 'ZaloSync', 'baocao')));
  });
});

test('đổi tên thư mục lỗi (đang mở tệp) → báo lỗi rõ, cấu hình vẫn trỏ chỗ cũ, projectCode vẫn được lưu', (t) => {
  withFakeAppData((tmp, root) => {
    const oldDocs = path.join(tmp, 'Documents', 'ZaloSync568');
    fs.mkdirSync(path.join(oldDocs, 'baocao'), { recursive: true });
    const reportDir = fwd(path.join(oldDocs, 'baocao'));
    seedConfig(root, { downloadDir: fwd(path.join(tmp, 'X')), reportDir });
    t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); });

    assert.throws(() => migrate(fakeScheduler()), /Chưa đổi tên được thư mục .*EPERM/);
    const cfg = readJson(path.join(root, 'config.json'));
    assert.equal(cfg.reportDir, reportDir, 'không trỏ sang thư mục chưa tồn tại');
    assert.equal(cfg.projectCode, '');
  });
});

test('đã có Documents\\ZaloSync → KHÔNG gộp 2 thư mục, cấu hình vẫn trỏ chỗ cũ (còn dùng được)', () => {
  withFakeAppData((tmp, root) => {
    const oldDocs = path.join(tmp, 'Documents', 'ZaloSync568');
    fs.mkdirSync(path.join(oldDocs, 'baocao'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'Documents', 'ZaloSync'), { recursive: true });
    const reportDir = fwd(path.join(oldDocs, 'baocao'));
    seedConfig(root, { downloadDir: fwd(path.join(tmp, 'X')), reportDir, projectCode: '', scheduledTaskName: 'ZaloSync_Daily' });

    assert.equal(migrate(fakeScheduler()).migrated, false);
    assert.equal(readJson(path.join(root, 'config.json')).reportDir, reportDir);
    assert.ok(fs.existsSync(oldDocs));
  });
});
