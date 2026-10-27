'use strict';
/**
 * engine_path.js — Xác định thư mục engine (chứa daily_sync_568.js + lib_*).
 *
 * Thứ tự ưu tiên:
 *   1. biến môi trường ZALOSYNC_ENGINE_DIR (bộ cài đặt sẵn khi phát hành),
 *   2. <gốc app>/../engine  (bố cục bản phát hành: InstallDir/app + InstallDir/engine),
 *   3. <gốc app>/../scripts (bố cục phát triển: repo/app + repo/scripts).
 */
const fs = require('fs');
const path = require('path');

function resolveEngineDir() {
  const candidates = [];
  if (process.env.ZALOSYNC_ENGINE_DIR) candidates.push(process.env.ZALOSYNC_ENGINE_DIR);
  candidates.push(path.join(__dirname, '..', '..', 'engine'));
  candidates.push(path.join(__dirname, '..', '..', 'scripts'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'daily_sync_568.js'))) return path.resolve(c);
    } catch { /* ignore */ }
  }
  throw new Error('Không tìm thấy thư mục engine (daily_sync_568.js). Đặt ZALOSYNC_ENGINE_DIR.');
}

function engineFile(name) {
  return path.join(resolveEngineDir(), name);
}

module.exports = { resolveEngineDir, engineFile };
