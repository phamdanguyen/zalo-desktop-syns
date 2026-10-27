'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Chạy fn(tmp, appRoot) với %LOCALAPPDATA% VÀ %USERPROFILE% (os.homedir → Documents) trỏ vào thư mục tạm,
 * để config_store/legacy_migrate đọc/ghi trong đó — không bao giờ đụng Documents thật.
 */
function withFakeAppData(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zalosync-'));
  const old = { lad: process.env.LOCALAPPDATA, home: process.env.USERPROFILE };
  process.env.LOCALAPPDATA = tmp;
  process.env.USERPROFILE = tmp;
  try { return fn(tmp, path.join(tmp, 'ZaloSync')); }
  finally {
    process.env.LOCALAPPDATA = old.lad; process.env.USERPROFILE = old.home;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { withFakeAppData };
