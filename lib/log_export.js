'use strict';
/**
 * log_export.js — Gom log của lượt chạy gần nhất + bối cảnh (môi trường, trạng thái, cấu hình) thành
 * 1 file văn bản để người dùng gửi cho AI / người hỗ trợ debug.
 *
 * KHÔNG BAO GIỜ ghi khóa giải mã ra file xuất: che trong cấu hình và cả chỗ lỡ lọt vào log.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const configStore = require('./config_store');

// Banner đầu lượt chạy: runner.js (chạy từ app) và run_sync.bat (tác vụ chạy theo lịch).
const RUN_START = /^====== (KHỞI CHẠY|TASK KHOI CHAY) /;

/** Đoạn log từ banner khởi chạy cuối cùng tới hết; chưa có banner → toàn bộ log. */
function lastRun(logText) {
  const lines = String(logText || '').split(/\r?\n/);
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) { if (RUN_START.test(lines[i])) { start = i; break; } }
  return lines.slice(start).join('\n').trim();
}

/** Bản sao cấu hình với khóa giải mã bị che (không sửa object gốc). */
function redactConfig(cfg) {
  return { ...cfg, key: cfg.key ? '***' : '' };
}

/** Nội dung file xuất. */
function buildReport({ logText, status, config, runtime, now }) {
  const text = [
    '# Zalo Sync — log lượt chạy (gửi kèm file này khi nhờ AI debug)',
    `Xuất lúc: ${now.toISOString()}`,
    `Môi trường: ${runtime}`,
    '',
    '## Trạng thái',
    JSON.stringify(status, null, 2),
    '',
    '## Cấu hình (đã che khóa giải mã)',
    config ? JSON.stringify(redactConfig(config), null, 2) : '(chưa có cấu hình)',
    '',
    '## Log lượt chạy gần nhất',
    lastRun(logText) || '(chưa có log)',
    '',
  ].join('\n');
  return config && config.key ? text.split(config.key).join('***') : text;
}

function stamp(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

/**
 * Ghi file xuất và trả đường dẫn tuyệt đối.
 * @param {{out?:string, status:object}} o  out mặc định: <reportDir>/ZaloSync_log_<yyyyMMdd_HHmmss>.txt
 */
function exportLog({ out, status }) {
  let config = null; try { config = configStore.load(); } catch {}
  let logText = ''; try { logText = fs.readFileSync(configStore.paths().logFile, 'utf8'); } catch {}
  const now = new Date();
  const dir = (config && config.reportDir) || configStore.defaultReportDir();
  const file = path.resolve(out || path.join(dir, `ZaloSync_log_${stamp(now)}.txt`));
  const runtime = `Node ${process.version} · ${os.platform()} ${os.release()} · ${os.arch()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buildReport({ logText, status, config, runtime, now }), 'utf8');
  return file;
}

module.exports = { lastRun, redactConfig, buildReport, exportLog };
