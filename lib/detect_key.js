'use strict';
/**
 * detect_key.js — Tự dò khóa giải mã (UIN) của CHÍNH máy/tài khoản người dùng — OFFLINE, TẤT ĐỊNH.
 *
 * Cơ chế (đã kiểm chứng ra đúng khóa thật):
 *  - Zalo mã hóa localStorage bằng XOR KHÓA-LẶP với UIN (32 ký tự hex), bản rõ là JSON (bản ghi
 *    `<idx>_fas`…). Ta đọc các bản ghi `z_ecrp_` từ LevelDB (thuần Node, tự giải nén snappy), rồi
 *    PHÁ XOR khóa-lặp: với mỗi vị trí khóa (0..31), thử 16 ký tự hex, chọn ký tự khiến nhiều byte
 *    giải ra là ký tự JSON/văn bản hợp lệ nhất qua toàn bộ chu kỳ (~100+ mẫu/vị trí → rất ổn định).
 *  - Sau khi ghép đủ 32 ký tự → KIỂM CHỨNG bằng cách mở thử Index.db. Nếu sai (hiếm, ví dụ nhiều
 *    tài khoản trộn lẫn), thử lại trên từng bản ghi riêng rồi kiểm chứng.
 *
 * KHÔNG đọc bộ nhớ tiến trình, KHÔNG cần Zalo đang chạy, chạy dưới quyền người dùng hiện tại.
 * Đây là công cụ để mỗi người tự lấy khóa dữ liệu CỦA CHÍNH MÌNH.
 */
const fs = require('fs');
const path = require('path');
const { readLocalStorage } = require('./leveldb_scan');
const { discoverGroups } = require('./group_discover');

const HEX = '0123456789abcdef';
const KEYLEN = 32;

/** Suy ra thư mục LevelDB localStorage từ zaloDataDir (…\_production\<UID>\Core). */
function leveldbDirFromCore(zaloDataDir) {
  const zaloRoot = path.resolve(zaloDataDir, '..', '..', '..', '..'); // Core→UID→_production→Database→ZaloData
  return path.join(zaloRoot, 'Partitions', 'zalo', 'Local Storage', 'leveldb');
}

function chromiumDecode(v) {
  const enc = v[0];
  if (enc === 1) return v.subarray(1).toString('latin1');     // Latin-1
  if (enc === 0) return v.subarray(1).toString('utf16le');    // UTF-16LE
  return v.toString('latin1');
}

/** Lấy danh sách payload (chuỗi sau 'z_ecrp_') của mọi bản ghi mã hóa; ưu tiên khớp userIndex. */
function collectPayloads(leveldbDir, preferIndex) {
  let all;
  try { all = readLocalStorage(leveldbDir); } catch { return { preferred: [], others: [] }; }
  const preferred = [], others = [];
  for (const [k, v] of all) {
    const s = chromiumDecode(v);
    const idx = s.indexOf('z_ecrp_');
    if (idx < 0) continue;
    const payload = s.slice(idx + 7);
    if (payload.length < KEYLEN) continue;
    // key localStorage dạng "_<origin>\0\1<idx>_<name>"; lấy tiền tố userIndex nếu có
    const m = k.match(/[\x00\x01]((\d+)_[A-Za-z0-9_-]+)$/);
    const uidx = m ? m[2] : null;
    if (preferIndex != null && uidx === String(preferIndex)) preferred.push(payload);
    else others.push(payload);
  }
  return { preferred, others };
}

function scoreByte(code) {
  if (code >= 0x30 && code <= 0x39) return 3; // 0-9
  if (code >= 0x61 && code <= 0x7a) return 3; // a-z
  if (code >= 0x41 && code <= 0x5a) return 2; // A-Z
  if ('{}[]":,/.-_ '.indexOf(String.fromCharCode(code)) >= 0) return 3; // JSON/URL
  if (code >= 0x20 && code <= 0x7e) return 1; // in được khác
  return -6; // không in được → phạt nặng
}

/** Phá XOR khóa-lặp trên tập payload → chuỗi 32 ký tự hex. */
function crackUIN(payloads) {
  if (!payloads.length) return null;
  let uin = '';
  for (let j = 0; j < KEYLEN; j++) {
    let best = null, bestScore = -Infinity;
    for (const c of HEX) {
      const cc = c.charCodeAt(0);
      let sc = 0;
      for (const p of payloads) for (let i = j; i < p.length; i += KEYLEN) sc += scoreByte(p.charCodeAt(i) ^ cc);
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    uin += best;
  }
  return uin;
}

function isValid(zaloDataDir, key) {
  try { return discoverGroups({ zaloDataDir, key }).ok; } catch { return false; }
}

/**
 * Kiểm chứng một khóa người dùng nhập tay (dự phòng).
 * @returns {{ok:boolean, error?:string, groupCount?:number}}
 */
function verifyKey({ zaloDataDir, key }) {
  if (!key || !/^[0-9a-fA-F]{32}$/.test(String(key).trim())) return { ok: false, error: 'Khóa phải là 32 ký tự hex.' };
  const r = discoverGroups({ zaloDataDir, key: String(key).trim() });
  return r.ok ? { ok: true, groupCount: r.groups.length } : { ok: false, error: r.error };
}

/**
 * Tự dò khóa. @param {{zaloDataDir:string, uid?:string, leveldbDir?:string}} o
 * @returns {{ok:boolean, key?:string, method?:string, needManual?:boolean, reason?:string}}
 */
function autoDetect(o) {
  const zaloDataDir = o.zaloDataDir;
  const leveldbDir = o.leveldbDir || leveldbDirFromCore(zaloDataDir);
  if (!fs.existsSync(leveldbDir)) {
    return { ok: false, needManual: true, reason: `Không thấy kho localStorage của Zalo (${leveldbDir}). Hãy mở Zalo PC & đăng nhập ít nhất một lần.` };
  }
  // userIndex thường là 0 cho tài khoản chính; vẫn gom cả bản ghi khác để đủ mẫu
  const { preferred, others } = collectPayloads(leveldbDir, 0);

  // 1) Gộp tất cả (ca 1 tài khoản — phổ biến nhất)
  const cand1 = crackUIN([...preferred, ...others]);
  if (cand1 && isValid(zaloDataDir, cand1)) return { ok: true, key: cand1, method: 'auto-aggregate' };

  // 2) Chỉ nhóm "preferred" (theo userIndex) — ca nhiều tài khoản trộn lẫn
  if (preferred.length) {
    const cand2 = crackUIN(preferred);
    if (cand2 && isValid(zaloDataDir, cand2)) return { ok: true, key: cand2, method: 'auto-preferred' };
  }

  // 3) Từng bản ghi riêng (payload dài nhất trước) + kiểm chứng
  const sorted = [...preferred, ...others].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    const cand = crackUIN([p]);
    if (cand && isValid(zaloDataDir, cand)) return { ok: true, key: cand, method: 'auto-single' };
  }

  return {
    ok: false, needManual: true,
    reason: 'Chưa tự dò được khóa (dữ liệu localStorage có thể chưa đủ). Hãy mở Zalo PC & đăng nhập, dùng vài phút rồi thử lại.',
  };
}

module.exports = { verifyKey, autoDetect, leveldbDirFromCore, crackUIN };

if (require.main === module) {
  // test: node detect_key.js <zaloDataDir>
  const dir = process.argv[2];
  console.log(JSON.stringify(autoDetect({ zaloDataDir: dir }), null, 2));
}
