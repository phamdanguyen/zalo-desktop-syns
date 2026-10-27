'use strict';
// Chạy (từ app/): node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const runner = require('../lib/runner');
const configStore = require('../lib/config_store');
const { withFakeAppData } = require('./_helpers');

/** Engine giả: in vài dòng, ghi argv vào FAKE_ENGINE_MARK, exit theo FAKE_ENGINE_EXIT. */
function makeFakeEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-engine-'));
  fs.writeFileSync(path.join(dir, 'daily_sync_568.js'), `
const fs = require('fs');
console.log('engine start');
console.log('engine argv ' + process.argv.slice(2).join(' '));
if (process.env.FAKE_ENGINE_MARK) fs.appendFileSync(process.env.FAKE_ENGINE_MARK, process.argv.slice(2).join(' ') + '\\n');
setTimeout(() => process.exit(Number(process.env.FAKE_ENGINE_EXIT || 0)), Number(process.env.FAKE_ENGINE_SLEEP || 0));
`);
  return dir;
}

/** Dựng môi trường: appdata giả + engine giả + config tối thiểu. fn(ctx) */
async function withRig(fn, { time = '04:15' } = {}) {
  const engineDir = makeFakeEngine();
  const mark = path.join(engineDir, 'mark.txt');
  const keys = ['ZALOSYNC_ENGINE_DIR', 'FAKE_ENGINE_MARK', 'FAKE_ENGINE_EXIT', 'FAKE_ENGINE_SLEEP'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  process.env.ZALOSYNC_ENGINE_DIR = engineDir;
  process.env.FAKE_ENGINE_MARK = mark;
  delete process.env.FAKE_ENGINE_EXIT; delete process.env.FAKE_ENGINE_SLEEP;
  try {
    await withFakeAppDataAsync(async () => {
      configStore.save({ _app: { scheduleTime: time } });
      const runs = () => (fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim().split('\n').filter(Boolean) : []);
      await fn({ runs, lockFile: path.join(configStore.paths().root, 'run.lock'), log: () => fs.readFileSync(configStore.paths().logFile, 'utf8') });
    });
  } finally {
    for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
    fs.rmSync(engineDir, { recursive: true, force: true });
  }
}

// withFakeAppData chỉ hỗ trợ đồng bộ → bản async tại chỗ (cùng cơ chế redirect).
async function withFakeAppDataAsync(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zalosync-'));
  const old = { lad: process.env.LOCALAPPDATA, home: process.env.USERPROFILE };
  process.env.LOCALAPPDATA = tmp; process.env.USERPROFILE = tmp;
  try { await fn(tmp); } finally {
    process.env.LOCALAPPDATA = old.lad; process.env.USERPROFILE = old.home;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function deadPid() {
  // PID của tiến trình vừa thoát
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
  return Number(r.stdout.toString());
}
const writeLock = (file, pid, startedAt) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid, startedAt }));
};

test('runSync thành công: ghi lastSuccessAt = giờ BẮT ĐẦU lượt chạy (<= lastRunAt), nhả khóa', async () => {
  await withRig(async ({ runs, lockFile }) => {
    const before = Date.now();
    const res = await runner.runSync({ all: true });
    assert.equal(res.code, 0);
    const st = configStore.readState();
    assert.ok(st.lastSuccessAt, 'phải có lastSuccessAt');
    assert.ok(+new Date(st.lastSuccessAt) >= before - 1);
    assert.ok(+new Date(st.lastSuccessAt) <= +new Date(st.lastRunAt));
    assert.equal(st.lastRunExit, 0);
    assert.ok(!fs.existsSync(lockFile), 'khóa phải được nhả');
    assert.match(runs()[0], /--all/);
  });
});

test('runSync exit khác 0: giữ nguyên lastSuccessAt cũ, ghi lastRunExit', async () => {
  await withRig(async ({ lockFile }) => {
    configStore.writeState({ lastSuccessAt: '2026-01-01T00:00:00.000Z' });
    process.env.FAKE_ENGINE_EXIT = '3';
    const res = await runner.runSync({ all: true });
    assert.equal(res.code, 3);
    const st = configStore.readState();
    assert.equal(st.lastSuccessAt, '2026-01-01T00:00:00.000Z');
    assert.equal(st.lastRunExit, 3);
    assert.ok(!fs.existsSync(lockFile));
  });
});

test('runSync --dry-run thành công: KHÔNG cập nhật lastSuccessAt', async () => {
  await withRig(async () => {
    const res = await runner.runSync({ dryRun: true });
    assert.equal(res.code, 0);
    assert.equal(configStore.readState().lastSuccessAt, undefined);
  });
});

test('khóa do pid ĐANG SỐNG giữ → BUSY, engine không chạy, khóa không bị đụng', async () => {
  await withRig(async ({ runs, lockFile }) => {
    writeLock(lockFile, process.pid, new Date().toISOString());
    await assert.rejects(runner.runSync({ all: true }), (e) => e.code === 'BUSY' && /PID/.test(e.message));
    assert.equal(runs().length, 0);
    assert.ok(fs.existsSync(lockFile));
  });
});

test('khóa của pid đã chết → tiếp quản và chạy', async () => {
  await withRig(async ({ runs, lockFile }) => {
    writeLock(lockFile, deadPid(), new Date().toISOString());
    const res = await runner.runSync({ all: true });
    assert.equal(res.code, 0);
    assert.equal(runs().length, 1);
    assert.ok(!fs.existsSync(lockFile));
  });
});

test('khóa quá 6 giờ dù pid còn sống (PID bị tái dùng) → coi là bỏ lại, chạy tiếp', async () => {
  await withRig(async ({ runs, lockFile }) => {
    writeLock(lockFile, process.pid, new Date(Date.now() - 7 * 3600 * 1000).toISOString());
    const res = await runner.runSync({ all: true });
    assert.equal(res.code, 0);
    assert.equal(runs().length, 1);
  });
});

test('khóa hỏng (không phải JSON) → coi là bỏ lại, chạy tiếp', async () => {
  await withRig(async ({ runs, lockFile }) => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, 'rac');
    const res = await runner.runSync({ all: true });
    assert.equal(res.code, 0);
    assert.equal(runs().length, 1);
  });
});

test('runScheduled chưa đến hạn: engine không chạy, {code:0, skipped:true}, log ghi [TỰ ĐỘNG] bỏ qua', async () => {
  await withRig(async ({ runs, log }) => {
    const now = new Date(2026, 9, 27, 9, 0);
    configStore.writeState({ lastSuccessAt: new Date(2026, 9, 27, 4, 20).toISOString() });
    const res = await runner.runScheduled({ now });
    assert.deepEqual(res, { code: 0, skipped: true });
    assert.equal(runs().length, 0);
    assert.match(log(), /\[TỰ ĐỘNG\].*bỏ qua/);
  });
});

test('runScheduled đến hạn: chạy engine với --all; gọi lại ngay → bỏ qua (bù đúng 1 lần)', async () => {
  await withRig(async ({ runs, log }) => {
    const now = new Date();
    // mốc lịch = 1 giờ trước → lần thành công gần nhất (hôm kia) đã bỏ lỡ
    const t = new Date(now.getTime() - 3600 * 1000);
    const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const cfg = configStore.load(); cfg._app.scheduleTime = time; configStore.save(cfg);
    configStore.writeState({ lastSuccessAt: new Date(now.getTime() - 48 * 3600 * 1000).toISOString() });

    const lines = [];
    const r1 = await runner.runScheduled({ now }, (l) => lines.push(l));
    assert.equal(r1.code, 0);
    assert.ok(!r1.skipped);
    assert.equal(runs().length, 1);
    assert.match(runs()[0], /--all/);
    assert.match(log(), /\[TỰ ĐỘNG\].*đến hạn/);

    const r2 = await runner.runScheduled({ now: new Date() });
    assert.deepEqual(r2, { code: 0, skipped: true });
    assert.equal(runs().length, 1, 'không chạy lần 2');
  });
});

test('runScheduled khi engine lỗi: trả mã lỗi và lần sau vẫn đến hạn (thử lại)', async () => {
  await withRig(async ({ runs }) => {
    const now = new Date();
    const t = new Date(now.getTime() - 3600 * 1000);
    const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const cfg = configStore.load(); cfg._app.scheduleTime = time; configStore.save(cfg);

    process.env.FAKE_ENGINE_EXIT = '2';
    const r1 = await runner.runScheduled({ now });
    assert.equal(r1.code, 2);
    assert.equal(configStore.readState().lastSuccessAt, undefined);

    process.env.FAKE_ENGINE_EXIT = '0';
    const r2 = await runner.runScheduled({ now: new Date() });
    assert.equal(r2.code, 0);
    assert.ok(!r2.skipped);
    assert.equal(runs().length, 2);
  });
});

// (Không thử "thiếu engine" bằng ZALOSYNC_ENGINE_DIR sai: engine_path lùi về ../scripts → chạy engine THẬT.)
test('runScheduled lỗi TRƯỚC khi chạy engine (mất cấu hình): ném lỗi VÀ để lại dòng [TỰ ĐỘNG] LỖI trong log', async () => {
  // lượt chạy ngầm: exe bỏ stdout → lỗi chỉ in ra stdout là mất dấu vết
  await withRig(async ({ runs, log }) => {
    fs.rmSync(configStore.paths().configFile);
    await assert.rejects(runner.runScheduled({ now: new Date() }));
    assert.equal(runs().length, 0);
    assert.match(log(), /\[TỰ ĐỘNG\].*LỖI.*config\.json/);
  });
});

test('runScheduled khi khóa đang bận: bỏ qua với code 0, engine không chạy', async () => {
  await withRig(async ({ runs, lockFile, log }) => {
    writeLock(lockFile, process.pid, new Date().toISOString());
    const res = await runner.runScheduled({ now: new Date() }); // chưa có lastSuccessAt → đến hạn
    assert.deepEqual(res, { code: 0, skipped: true });
    assert.equal(runs().length, 0);
    assert.match(log(), /\[TỰ ĐỘNG\].*bỏ qua/);
  });
});
