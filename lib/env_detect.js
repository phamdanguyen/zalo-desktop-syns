'use strict';
/**
 * env_detect.js — Dò môi trường Zalo trên máy hiện tại (CHỈ ĐỌC).
 *
 * Trả về các tài khoản Zalo đã đăng nhập (mỗi tài khoản = 1 UID = 1 thư mục trong _production),
 * đường dẫn Core/Index.db/Message, mốc hoạt động gần nhất, và thông tin runtime Node.
 *
 * Không ghi gì vào kho Zalo; không đụng tới tiến trình nào. Dùng cho bước "Thiết lập" của GUI.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

/** Thư mục gốc dữ liệu Zalo PC trên Windows. */
function zaloRoot() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'ZaloData');
}

/** Đường dẫn _production (chứa các thư mục UID + SecureLocalstorage.db). */
function productionDir() {
  return path.join(zaloRoot(), 'Database', '_production');
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

/**
 * Dò các tài khoản Zalo đã đăng nhập trên máy.
 * @returns {Array<{uid, coreDir, indexDb, messageDir, hasIndex, messageDbCount, lastActivity}>}
 */
function detectZaloAccounts() {
  const prod = productionDir();
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(prod, { withFileTypes: true });
  } catch {
    return out; // Zalo chưa cài / chưa đăng nhập bao giờ
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (!/^\d{5,}$/.test(ent.name)) continue; // UID là chuỗi số dài
    const uid = ent.name;
    const coreDir = path.join(prod, uid, 'Core');
    const indexDb = path.join(coreDir, 'Index.db');
    const messageDir = path.join(coreDir, 'Message');
    const hasIndex = !!statSafe(indexDb);
    if (!hasIndex && !statSafe(coreDir)) continue; // không phải tài khoản thật

    let messageDbCount = 0;
    let lastActivityMs = 0;
    const msgStat = statSafe(messageDir);
    if (msgStat && msgStat.isDirectory()) {
      try {
        for (const f of fs.readdirSync(messageDir)) {
          if (/^g?\d+\.db$/.test(f)) {
            messageDbCount++;
            const st = statSafe(path.join(messageDir, f));
            if (st && st.mtimeMs > lastActivityMs) lastActivityMs = st.mtimeMs;
          }
        }
      } catch { /* ignore */ }
    }
    const idxStat = statSafe(indexDb);
    if (idxStat && idxStat.mtimeMs > lastActivityMs) lastActivityMs = idxStat.mtimeMs;

    out.push({
      uid,
      coreDir,
      indexDb,
      messageDir,
      hasIndex,
      messageDbCount,
      lastActivity: lastActivityMs ? new Date(lastActivityMs).toISOString() : null,
      lastActivityMs,
    });
  }
  // tài khoản hoạt động gần nhất lên đầu
  out.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  return out;
}

/** Thông tin runtime Node đang chạy GUI (để cảnh báo nếu quá cũ cho node:sqlite). */
function nodeInfo() {
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0], 10);
  let sqliteOk = false;
  try { require('node:sqlite'); sqliteOk = true; } catch { sqliteOk = false; }
  return {
    version: v,
    major,
    execPath: process.execPath,
    sqliteOk, // node:sqlite dùng được hay không (engine bắt buộc cần)
    minRequired: '22.5.0',
  };
}

/** Các tệp liên quan tới lớp bảo mật (để module dò key dùng ở Pha B). */
function secureStoragePaths() {
  const root = zaloRoot();
  return {
    secureLocalStorageDb: path.join(productionDir(), 'SecureLocalstorage.db'),
    leveldbDir: path.join(root, 'Partitions', 'zalo', 'Local Storage', 'leveldb'),
    zsafeStorage: path.join(root, 'zsafe-storage.json'), // vị trí dự kiến; xác minh ở Pha B
  };
}

function detectAll() {
  return {
    zaloRoot: zaloRoot(),
    productionDir: productionDir(),
    zaloInstalled: !!statSafe(productionDir()),
    accounts: detectZaloAccounts(),
    node: nodeInfo(),
    secure: secureStoragePaths(),
    host: os.hostname(),
    user: os.userInfo().username,
  };
}

module.exports = {
  zaloRoot,
  productionDir,
  detectZaloAccounts,
  nodeInfo,
  secureStoragePaths,
  detectAll,
};

// Chạy trực tiếp để test nhanh: node env_detect.js
if (require.main === module) {
  console.log(JSON.stringify(detectAll(), null, 2));
}
