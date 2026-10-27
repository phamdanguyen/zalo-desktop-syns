'use strict';
/**
 * cli.js — Cầu nối giữa giao diện WinForm (C#) và toàn bộ logic Node.
 * Mỗi lệnh in JSON 1 dòng ra stdout (trừ `run` stream log theo dòng). Thoát mã 0 nếu OK.
 *
 *   node cli.js migrate                     (1 lần: chuyển bản cài cũ sang tên mới — GUI gọi đầu tiên)
 *   node cli.js env
 *   node cli.js detect-key --dir <coreDir>
 *   node cli.js verify --dir <coreDir> --key <hex32>
 *   node cli.js discover --dir <coreDir> --key <hex32>
 *   node cli.js get-config
 *   node cli.js save-config --payload <file.json>
 *   node cli.js status
 *   node cli.js schedule-get | schedule-set --time HH:MM | schedule-del | schedule-refresh
 *       (set/refresh cần env ZALOSYNC_EXE = đường dẫn ZaloSync.exe, GUI tự truyền; trả {ok:true,...}, lỗi → {ok:false,error} + exit 1)
 *   node cli.js run [--all] [--dry-run]
 *   node cli.js run --scheduled             (Task Scheduler qua `ZaloSync.exe --scheduled`: chỉ chạy nếu đã bỏ lỡ mốc lịch)
 *   node cli.js log --tail 300
 *   node cli.js export-log [--out <file>]
 *   node cli.js open-folder --path <p>
 */
const fs = require('fs');
const path = require('path');
const env = require('./lib/env_detect');
const configStore = require('./lib/config_store');
const groupDiscover = require('./lib/group_discover');
const detectKey = require('./lib/detect_key');
const scheduler = require('./lib/task_scheduler');
const runner = require('./lib/runner');
const logExport = require('./lib/log_export');
const legacy = require('./lib/legacy_migrate');

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) o[key] = true;
      else { o[key] = next; i++; }
    }
  }
  return o;
}

function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function fail(msg) { out({ ok: false, error: msg }); process.exit(1); }

function buildStatus() {
  const state = configStore.readState();
  let sched = { exists: false };
  try { sched = scheduler.query(); } catch (e) { sched = { exists: false, error: e.message }; }
  let cfg = null, dataFresh = null;
  if (configStore.exists()) {
    try {
      cfg = configStore.load();
      try { const st = fs.statSync(cfg.downloadDir); dataFresh = new Date(st.mtimeMs).toISOString(); } catch {}
    } catch {}
  }
  return {
    configured: configStore.exists(),
    schedule: sched,
    lastRunAt: state.lastRunAt || null,
    lastRunExit: state.lastRunExit !== undefined ? state.lastRunExit : null,
    lastRunMode: state.lastRunMode || null,
    dataDir: cfg ? path.normalize(cfg.downloadDir) : null, // config lưu 'C:/…' (schema engine) → hiển thị dạng Windows
    dataFresh,
    scheduleTime: cfg && cfg._app ? cfg._app.scheduleTime : null,
    projectLabel: cfg ? cfg.projectLabel : null,
    groupCount: cfg && cfg.targetGroups ? cfg.targetGroups.length : 0,
  };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  switch (cmd) {
    case 'migrate': return out(legacy.migrate());
    case 'env': return out(env.detectAll());
    case 'detect-key': {
      if (!a.dir) return fail('thiếu --dir');
      return out(detectKey.autoDetect({ zaloDataDir: a.dir }));
    }
    case 'verify': {
      if (!a.dir || !a.key) return fail('thiếu --dir/--key');
      return out(detectKey.verifyKey({ zaloDataDir: a.dir, key: a.key }));
    }
    case 'discover': {
      if (!a.dir || !a.key) return fail('thiếu --dir/--key');
      return out(groupDiscover.discoverGroups({ zaloDataDir: a.dir, key: a.key }));
    }
    case 'get-config':
      return out(configStore.exists() ? { exists: true, config: configStore.load() } : { exists: false });
    case 'save-config': {
      if (!a.payload) return fail('thiếu --payload');
      // bỏ BOM nếu có (file do .NET ghi bằng Encoding.UTF8 có BOM → JSON.parse vỡ)
      const body = JSON.parse(fs.readFileSync(a.payload, 'utf8').replace(/^﻿/, ''));
      const cfg = configStore.buildConfig(body);
      const file = configStore.save(cfg);
      return out({ ok: true, file });
    }
    case 'status': return out(buildStatus());
    case 'schedule-get': return out(scheduler.query());
    case 'schedule-set': return out(scheduler.install(a.time));
    case 'schedule-del': return out(scheduler.uninstall());
    case 'schedule-refresh': return out(scheduler.refresh());
    case 'log': {
      const p = configStore.paths();
      let text = ''; try { text = fs.readFileSync(p.logFile, 'utf8'); } catch {}
      const tail = parseInt(a.tail, 10) || 300;
      return out({ lines: text.split(/\r?\n/).slice(-tail) });
    }
    case 'export-log':
      // log lượt chạy gần nhất + trạng thái + cấu hình (đã che khóa) → 1 file để gửi AI debug
      return out({ ok: true, file: logExport.exportLog({ out: a.out, status: buildStatus() }) });
    case 'open-folder': {
      // mặc định mở THƯ MỤC DỮ LIỆU (downloadDir), không phải dataRoot (chứa logs/config)
      let target = a.path;
      if (!target) { try { target = configStore.load().downloadDir; } catch { target = configStore.dataRoot(); } }
      // explorer.exe không hiểu '/' (config lưu 'C:/…') → mở nhầm thư mục mặc định. Chuẩn hoá về '\'.
      target = path.normalize(target);
      try { fs.mkdirSync(target, { recursive: true }); } catch {} // tạo nếu chưa chạy lần nào
      try { require('child_process').spawn('explorer.exe', [target], { detached: true }); } catch {}
      return out({ ok: true });
    }
    case 'run': {
      if (a.scheduled) {
        const r = await runner.runScheduled({}, (line) => process.stdout.write(line + '\n'));
        process.exit(r.code || 0);
        return;
      }
      // Stream từng dòng ra stdout để WinForm đọc trực tiếp.
      const res = await runner.runSync({ all: !!a.all, dryRun: !!a['dry-run'] }, (line) => {
        process.stdout.write(line + '\n');
      });
      process.exit(res.code || 0);
      return;
    }
    default:
      return fail(`lệnh không hợp lệ: ${cmd}`);
  }
}

main().catch((e) => fail(e.message));
