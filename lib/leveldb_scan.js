'use strict';
/**
 * leveldb_scan.js — Bộ đọc LevelDB table (.ldb) TỐI GIẢN, THUẦN NODE (không phụ thuộc npm),
 * kèm giải nén Snappy raw. Chỉ dùng để trích các bản ghi localStorage của Zalo (phục vụ dò khóa).
 *
 * Tham chiếu format: footer 48B (metaindex handle, index handle, magic 0xdb4775248b80fb57),
 * block = entries (shared/non_shared/val_len varint + key delta + value) + restart array (uint32[]+count).
 * Khối dữ liệu có thể nén Snappy (comp byte == 1). CHỈ ĐỌC.
 */
const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);

function readVarint(buf, pos) {
  let res = 0, shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    res |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [res >>> 0, pos];
}

/** Snappy raw (block) decompression. */
function snappyDecompress(input) {
  let ip = 0;
  let [outLen, p] = readVarint(input, 0); ip = p;
  const out = Buffer.alloc(outLen);
  let op = 0;
  while (ip < input.length) {
    const tag = input[ip];
    const type = tag & 0x03;
    if (type === 0) { // literal
      let len = (tag >> 2) + 1;
      ip += 1;
      if (len > 60) {
        const n = len - 60;
        let l = 0;
        for (let i = 0; i < n; i++) l |= input[ip + i] << (8 * i);
        len = (l >>> 0) + 1;
        ip += n;
      }
      input.copy(out, op, ip, ip + len);
      ip += len; op += len;
    } else { // copy
      let len, offset;
      if (type === 1) {
        len = ((tag >> 2) & 0x07) + 4;
        offset = ((tag >> 5) << 8) | input[ip + 1];
        ip += 2;
      } else if (type === 2) {
        len = (tag >> 2) + 1;
        offset = input[ip + 1] | (input[ip + 2] << 8);
        ip += 3;
      } else {
        len = (tag >> 2) + 1;
        offset = (input[ip + 1] | (input[ip + 2] << 8) | (input[ip + 3] << 16) | (input[ip + 4] << 24)) >>> 0;
        ip += 5;
      }
      for (let i = 0; i < len; i++) { out[op] = out[op - offset]; op++; }
    }
  }
  return out;
}

/** Phân giải 1 block thành danh sách entry {key, value} (Buffer). */
function parseBlock(block) {
  const out = [];
  if (block.length < 4) return out;
  const nRestarts = block.readUInt32LE(block.length - 4);
  const rOffset = block.length - 4 - 4 * nRestarts;
  if (rOffset < 0 || rOffset > block.length) return out;
  let p = 0;
  let prevKey = Buffer.alloc(0);
  while (p < rOffset) {
    let shared, nonShared, valLen;
    [shared, p] = readVarint(block, p);
    [nonShared, p] = readVarint(block, p);
    [valLen, p] = readVarint(block, p);
    const key = Buffer.concat([prevKey.subarray(0, shared), block.subarray(p, p + nonShared)]);
    p += nonShared;
    const val = block.subarray(p, p + valLen);
    p += valLen;
    prevKey = key;
    out.push({ key, val });
  }
  return out;
}

/** Đọc 1 file .ldb → Map<userKeyString, valueBuffer> (chỉ entry TypeValue). */
function readTable(data) {
  const kvs = new Map();
  if (data.length < 48) return kvs;
  const footer = data.subarray(data.length - 48);
  if (!footer.subarray(footer.length - 8).equals(MAGIC)) return kvs;
  let p = 0, metaOff, metaLen, idxOff, idxLen;
  [metaOff, p] = readVarint(footer, p);
  [metaLen, p] = readVarint(footer, p);
  [idxOff, p] = readVarint(footer, p);
  [idxLen, p] = readVarint(footer, p);

  let idxBlock = data.subarray(idxOff, idxOff + idxLen);
  const idxComp = data[idxOff + idxLen];
  if (idxComp === 1) idxBlock = snappyDecompress(idxBlock);

  const handles = [];
  for (const { val } of parseBlock(idxBlock)) {
    let [bOff, vp] = readVarint(val, 0);
    let bLen; [bLen, vp] = readVarint(val, vp);
    handles.push([bOff, bLen]);
  }

  for (const [bOff, bLen] of handles) {
    let bData = data.subarray(bOff, bOff + bLen);
    const comp = data[bOff + bLen];
    if (comp === 1) { try { bData = snappyDecompress(bData); } catch { continue; } }
    else if (comp !== 0) continue;
    for (const { key, val } of parseBlock(bData)) {
      if (key.length >= 8) {
        const userKey = key.subarray(0, key.length - 8);
        const vType = key[key.length - 8] & 0xff;
        if (vType === 1) kvs.set(userKey.toString('latin1'), Buffer.from(val));
      }
    }
  }
  return kvs;
}

/** Đọc toàn bộ localStorage của Zalo (gộp mọi .ldb). */
function readLocalStorage(leveldbDir) {
  const all = new Map();
  let files = [];
  try { files = fs.readdirSync(leveldbDir).filter(f => f.endsWith('.ldb')).sort(); } catch { return all; }
  for (const f of files) {
    try {
      const kvs = readTable(fs.readFileSync(path.join(leveldbDir, f)));
      for (const [k, v] of kvs) all.set(k, v);
    } catch { /* bỏ qua file hỏng */ }
  }
  return all;
}

module.exports = { readVarint, snappyDecompress, parseBlock, readTable, readLocalStorage };
