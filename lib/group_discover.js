'use strict';
/**
 * group_discover.js — Liệt kê các nhóm Zalo mà tài khoản đang là thành viên, để người dùng
 * tích chọn nhóm cần đồng bộ. CHỈ ĐỌC (giải mã bản chụp tạm của Index.db, không ghi vào kho Zalo).
 *
 * Thuật toán giải mã SQLCipher v4 sao đúng theo engine (scripts/discover_568_groups.js) để nhất
 * quán. Dùng lib_snapshot của engine để chụp DB + WAL an toàn khi Zalo đang chạy.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { engineFile } = require('./engine_path');

const { snapshotDbWithWal } = require(engineFile('lib_snapshot'));

/** Giải mã SQLCipher v4 (+WAL) sang SQLite chuẩn. Mirror của engine. */
function decryptSqlcipherWithWal(dbPath, outPath, key) {
  const dbData = fs.readFileSync(dbPath);
  if (dbData.length < 4096 || dbData.length % 4096 !== 0) return false;
  const salt = dbData.subarray(0, 16);
  const ek = crypto.pbkdf2Sync(key, salt, 256000, 32, 'sha512');
  const pageMap = new Map();
  const numMainPages = Math.floor(dbData.length / 4096);
  for (let p = 1; p <= numMainPages; p++) pageMap.set(p, dbData.subarray((p - 1) * 4096, p * 4096));
  const walPath = dbPath + '-wal';
  if (fs.existsSync(walPath)) {
    const walData = fs.readFileSync(walPath);
    if (walData.length >= 32 + 24 + 4096) {
      const hdrSalt1 = walData.readUInt32BE(16);
      const hdrSalt2 = walData.readUInt32BE(20);
      const numFrames = Math.floor((walData.length - 32) / (24 + 4096));
      const pending = new Map();
      for (let f = 0; f < numFrames; f++) {
        const offset = 32 + f * (24 + 4096);
        const pgNo = walData.readUInt32BE(offset);
        const nTruncate = walData.readUInt32BE(offset + 4);
        const fSalt1 = walData.readUInt32BE(offset + 8);
        const fSalt2 = walData.readUInt32BE(offset + 12);
        if (fSalt1 !== hdrSalt1 || fSalt2 !== hdrSalt2) break;
        pending.set(pgNo, walData.subarray(offset + 24, offset + 24 + 4096));
        if (nTruncate > 0) { for (const [pg, data] of pending) pageMap.set(pg, data); pending.clear(); }
      }
    }
  }
  const maxPg = Math.max(...pageMap.keys());
  const out = [];
  for (let p = 1; p <= maxPg; p++) {
    const pageData = pageMap.get(p);
    if (!pageData) { out.push(Buffer.alloc(4096)); continue; }
    const ctStart = p === 1 ? 16 : 0;
    const ct = pageData.subarray(ctStart, 4096 - 80);
    const iv = pageData.subarray(4096 - 80, 4096 - 64);
    const d = crypto.createDecipheriv('aes-256-cbc', ek, iv);
    d.setAutoPadding(false);
    if (p === 1) out.push(Buffer.from('SQLite format 3\0'));
    out.push(Buffer.concat([d.update(ct), d.final()]));
    out.push(Buffer.alloc(80));
  }
  fs.writeFileSync(outPath, Buffer.concat(out));
  return true;
}

/**
 * @param {{zaloDataDir:string, key:string}} opt
 * @returns {{ok:boolean, error?:string, groups?:Array<{id,name,totalMember,messageDbCount,lastActivity}>}}
 */
function discoverGroups(opt) {
  const { zaloDataDir, key } = opt;
  if (!zaloDataDir || !key) return { ok: false, error: 'Thiếu zaloDataDir hoặc key.' };
  const idxSrc = path.join(zaloDataDir, 'Index.db');
  if (!fs.existsSync(idxSrc)) return { ok: false, error: `Không thấy Index.db tại ${idxSrc}` };

  const tmp = path.join(os.tmpdir(), 'zalosync_discover');
  fs.mkdirSync(tmp, { recursive: true });
  const enc = path.join(tmp, 'Index.enc.db');
  const dec = path.join(tmp, 'Index.dec.sqlite');

  try {
    snapshotDbWithWal(idxSrc, enc);
    if (!decryptSqlcipherWithWal(enc, dec, key)) {
      return { ok: false, error: 'Giải mã Index.db thất bại (kích thước bất thường).' };
    }
    let db;
    try {
      db = new DatabaseSync(dec, { readOnly: true });
    } catch (e) {
      // sai key → file giải mã không phải SQLite hợp lệ
      return { ok: false, error: 'Khóa không đúng hoặc Index.db hỏng (không mở được SQLite).' };
    }

    // mtime các Message DB để biết nhóm nào còn hoạt động
    const msgDir = path.join(zaloDataDir, 'Message');
    const onDisk = {};
    try {
      for (const f of fs.readdirSync(msgDir)) {
        const m = f.match(/^(g?\d+)\.db$/);
        if (m) onDisk[m[1]] = fs.statSync(path.join(msgDir, f)).mtimeMs;
      }
    } catch { /* ignore */ }

    let rows = [];
    try {
      rows = db.prepare('SELECT userId, displayName, totalMember FROM "group"').all();
    } catch (e) {
      db.close();
      return { ok: false, error: `Không đọc được bảng group: ${e.message}` };
    }
    const groups = rows.map(g => {
      const rawId = String(g.userId);
      const gid = rawId.startsWith('g') ? rawId : 'g' + rawId;
      const mtime = onDisk[gid] || onDisk[rawId] || 0;
      return {
        id: gid,
        name: g.displayName || '(không tên)',
        totalMember: g.totalMember || 0,
        messageDbCount: (onDisk[gid] || onDisk[rawId]) ? 1 : 0,
        lastActivity: mtime ? new Date(mtime).toISOString() : null,
        lastActivityMs: mtime,
      };
    }).sort((a, b) => b.lastActivityMs - a.lastActivityMs);

    db.close();
    return { ok: true, groups };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.rmSync(dec, { force: true }); } catch {}
    try { fs.rmSync(enc, { force: true }); } catch {}
    try { fs.rmSync(enc + '-wal', { force: true }); } catch {}
  }
}

module.exports = { discoverGroups };

if (require.main === module) {
  // test: node group_discover.js <zaloDataDir> <key>
  const [, , dir, key] = process.argv;
  console.log(JSON.stringify(discoverGroups({ zaloDataDir: dir, key }), null, 2));
}
