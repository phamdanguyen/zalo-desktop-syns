'use strict';
/**
 * runner.js — Chạy engine daily_sync_568.js với file config của người dùng, phát từng dòng log
 * theo thời gian thực (để GUI stream qua SSE) và ghi vào log file. Chỉ cho phép 1 lần chạy đồng thời
 * (trong tiến trình + khóa liên tiến trình run.lock). runScheduled: lượt chạy do Task Scheduler gọi.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { engineFile } = require('./engine_path');
const configStore = require('./config_store');
const { shouldRun } = require('./task_scheduler');

// PID trên Windows bị tái dùng → khóa quá cũ coi như bỏ lại
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

let current = null; // { child, startedAt }

function isRunning() { return !!current; }

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function busyError(msg) { return Object.assign(new Error(msg), { code: 'BUSY' }); }

/**
 * Khóa liên tiến trình: nút "Chạy ngay" của GUI và lượt chạy theo lịch là hai tiến trình node riêng;
 * hai engine cùng ghi cursor/manifest sẽ làm hỏng chúng. Ném lỗi code 'BUSY' nếu đang bị giữ.
 */
function acquireLock(file) {
  const body = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(file, body, { flag: 'wx' }); return; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let held = null;
    try { held = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* hỏng → bỏ lại */ }
    const age = held ? Date.now() - new Date(held.startedAt).getTime() : Infinity;
    const stale = !held || !pidAlive(held.pid) || !(age < LOCK_STALE_MS);
    if (!stale) throw busyError(`Đang có một lượt đồng bộ khác chạy (PID ${held.pid}, từ ${held.startedAt}). Vui lòng đợi.`);
    try { fs.unlinkSync(file); } catch { /* tiến trình khác đã gỡ */ }
  }
  throw busyError('Đang có một lượt đồng bộ khác chạy. Vui lòng đợi.');
}

function releaseLock(file) {
  try {
    const held = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (held.pid === process.pid) fs.unlinkSync(file);
  } catch { /* không còn / không phải của mình */ }
}

/**
 * @param {object} opt { all?:boolean, dryRun?:boolean }
 * @param {(line:string)=>void} onLine
 * @returns {Promise<{code:number}>}
 */
function runSync(opt, onLine) {
  if (current) return Promise.reject(busyError('Đang có một lượt đồng bộ chạy. Vui lòng đợi.'));
  const p = configStore.ensureDirs();
  if (!configStore.exists()) return Promise.reject(new Error('Chưa có cấu hình. Hãy hoàn tất Thiết lập trước.'));

  const engine = engineFile('daily_sync_568.js');
  const args = [engine, '--config', p.configFile];
  if (opt && opt.all) args.push('--all');
  if (opt && opt.dryRun) args.push('--dry-run');

  const lockFile = path.join(p.root, 'run.lock');
  try { acquireLock(lockFile); } catch (e) { return Promise.reject(e); }

  const startedAt = new Date();
  const logStream = fs.createWriteStream(p.logFile, { flags: 'a' });
  const banner = `\n====== KHỞI CHẠY ${startedAt.toISOString()} ${args.slice(1).join(' ')} ======\n`;
  logStream.write(banner);
  if (onLine) onLine(banner.trim());

  const child = spawn(process.execPath, args, {
    cwd: path.dirname(engine),
    env: { ...process.env, ZALO_568_CONFIG: p.configFile },
    windowsHide: true,
  });
  current = { child, startedAt: startedAt.getTime() };

  let buf = '';
  const pump = (data) => {
    const text = data.toString('utf8');
    logStream.write(text);
    buf += text;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (onLine) onLine(line);
    }
  };
  child.stdout.on('data', pump);
  child.stderr.on('data', pump);

  return new Promise((resolve) => {
    child.on('close', (code) => {
      if (buf.length && onLine) onLine(buf);
      const foot = `====== KẾT THÚC exit=${code} ${new Date().toISOString()} ======\n`;
      logStream.write(foot);
      logStream.end();
      if (onLine) onLine(foot.trim());
      current = null;
      releaseLock(lockFile);
      const patch = {
        lastRunAt: new Date().toISOString(),
        lastRunExit: code,
        lastRunMode: (opt && opt.all) ? 'all' : 'incremental',
      };
      if (code === 0 && !(opt && opt.dryRun)) patch.lastSuccessAt = startedAt.toISOString();
      configStore.writeState(patch);
      resolve({ code });
    });
  });
}

/**
 * Lượt chạy do Task Scheduler gọi (qua `ZaloSync.exe --scheduled`): mỗi trigger (hằng ngày, đăng nhập,
 * bù lịch) đều đồng bộ toàn bộ, trừ khi vừa thành công < 30 phút (shouldRun) → các trigger kích sát nhau chỉ 1 lượt.
 */
async function runScheduled({ now = new Date() } = {}, onLine) {
  const p = configStore.ensureDirs();
  const note = (msg) => {
    const line = `[TỰ ĐỘNG] ${now.toISOString()} ${msg}`;
    fs.appendFileSync(p.logFile, line + '\n');
    if (onLine) onLine(line);
  };
  try {
    configStore.load(); // thiếu config → ném lỗi (ghi LỖI vào log)
    const { lastSuccessAt } = configStore.readState();
    if (!shouldRun({ now, lastSuccessAt })) {
      note(`bỏ qua — vừa đồng bộ thành công lúc ${lastSuccessAt} (< 30 phút).`);
      return { code: 0, skipped: true };
    }
    note(`chạy (lần thành công gần nhất: ${lastSuccessAt || 'chưa có'}) → đồng bộ toàn bộ.`);
    return await runSync({ all: true }, onLine);
  } catch (e) {
    if (e.code === 'BUSY') { note(`bỏ qua — ${e.message}`); return { code: 0, skipped: true }; }
    note(`LỖI — ${e.message}`); // chạy ngầm: exe bỏ stdout → không ghi vào log là mất dấu vết
    throw e;
  }
}

function cancel() {
  if (current && current.child) {
    try { current.child.kill(); } catch {}
  }
}

module.exports = { runSync, runScheduled, isRunning, cancel };
