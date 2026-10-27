'use strict';
/**
 * runner.js — Chạy engine daily_sync_568.js với file config của người dùng, phát từng dòng log
 * theo thời gian thực (để GUI stream qua SSE) và ghi vào log file. Chỉ cho phép 1 lần chạy đồng thời.
 */
const fs = require('fs');
const { spawn } = require('child_process');
const { engineFile } = require('./engine_path');
const configStore = require('./config_store');

let current = null; // { child, startedAt }

function isRunning() { return !!current; }

/**
 * @param {object} opt { all?:boolean, dryRun?:boolean }
 * @param {(line:string)=>void} onLine
 * @returns {Promise<{code:number}>}
 */
function runSync(opt, onLine) {
  if (current) return Promise.reject(new Error('Đang có một lượt đồng bộ chạy. Vui lòng đợi.'));
  const p = configStore.ensureDirs();
  if (!configStore.exists()) return Promise.reject(new Error('Chưa có cấu hình. Hãy hoàn tất Thiết lập trước.'));

  const engine = engineFile('daily_sync_568.js');
  const args = [engine, '--config', p.configFile];
  if (opt && opt.all) args.push('--all');
  if (opt && opt.dryRun) args.push('--dry-run');

  const logStream = fs.createWriteStream(p.logFile, { flags: 'a' });
  const banner = `\n====== KHỞI CHẠY ${new Date().toISOString()} ${args.slice(1).join(' ')} ======\n`;
  logStream.write(banner);
  if (onLine) onLine(banner.trim());

  const child = spawn(process.execPath, args, {
    cwd: engineFileDir(engine),
    env: { ...process.env, ZALO_568_CONFIG: p.configFile },
    windowsHide: true,
  });
  current = { child, startedAt: Date.now() };

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
      configStore.writeState({
        lastRunAt: new Date().toISOString(),
        lastRunExit: code,
        lastRunMode: (opt && opt.all) ? 'all' : 'incremental',
      });
      resolve({ code });
    });
  });
}

function engineFileDir(engineAbs) {
  const path = require('path');
  return path.dirname(engineAbs);
}

function cancel() {
  if (current && current.child) {
    try { current.child.kill(); } catch {}
  }
}

module.exports = { runSync, isRunning, cancel };
