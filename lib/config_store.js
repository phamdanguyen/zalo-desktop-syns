'use strict';
/**
 * config_store.js — Quản lý cấu hình & trạng thái của bản cài trên MỖI máy.
 *
 * Mọi dữ liệu người dùng (config, cursor, manifest, log) đặt tại %LOCALAPPDATA%\ZaloSync
 * — TÁCH khỏi thư mục chương trình, để lần cập nhật app không ghi đè/làm mất dữ liệu.
 *
 * Config giữ nguyên schema mà engine daily_sync_568.js mong đợi (xem config_568_all.json),
 * cộng vài trường app (version, scheduleTime...). Engine được gọi với --config trỏ vào file này.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_LABEL = 'Zalo Sync — dữ liệu nhóm công trường';
// Tác vụ lịch hằng ngày (task_scheduler dùng lại; để ở đây vì task_scheduler require config_store — tránh vòng lặp).
const TASK_NAME = 'ZaloSync_Daily';

function dataRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'ZaloSync');
}

function paths() {
  const root = dataRoot();
  return {
    root,
    configFile: path.join(root, 'config.json'),
    cursorFile: path.join(root, 'cursor.json'),
    manifestFile: path.join(root, 'manifest.json'),
    logDir: path.join(root, 'logs'),
    logFile: path.join(root, 'logs', 'daily_sync.log'),
    stateFile: path.join(root, 'state.json'),
  };
}

function ensureDirs() {
  const p = paths();
  fs.mkdirSync(p.root, { recursive: true });
  fs.mkdirSync(p.logDir, { recursive: true });
  return p;
}

/** Thư mục lưu dữ liệu mặc định cho người dùng tự cài. */
function defaultDownloadDir() {
  return path.join(os.homedir(), 'Documents', 'ZaloSync', 'data');
}

function defaultReportDir() {
  return path.join(os.homedir(), 'Documents', 'ZaloSync', 'baocao');
}

/**
 * Suy `code` (nhãn đặt tên thư mục/tiền tố tên file của engine) từ TÊN nhóm cho dễ đọc.
 * Engine dùng group.code làm một đoạn đường dẫn (buildSubFolder) và trong tên file, nên code phải
 * là tên hợp lệ cho đường dẫn Windows. Bỏ ký tự cấm, khoảng trắng → '_' (đồng nhất với cách engine
 * xử lý tên người gửi), gộp '_' trùng, không để '_'/'.' ở hai đầu, chặn độ dài. Rỗng thì lùi về id.
 */
function groupCode(name, id) {
  const base = String(name == null ? '' : name)
    .replace(/[\\/:*?"<>| ]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 60)
    .replace(/[_.]+$/g, '');
  return base || String(id || 'Nhom');
}

/**
 * Chuẩn hoá targetGroups: giữ nguyên id (khóa kỹ thuật mở DB/cursor), đặt code = tên đọc được.
 * Hai nhóm trùng tên → thêm đuôi 5 chữ số cuối của id để code không đụng nhau (tránh trộn thư mục).
 */
function normalizeGroups(groups) {
  const list = (groups || []).map(g => ({ id: g.id, name: g.name, base: groupCode(g.name, g.id) }));
  const counts = {};
  for (const x of list) counts[x.base] = (counts[x.base] || 0) + 1;
  return list.map(x => {
    let code = x.base;
    if (counts[x.base] > 1) {
      const tail = String(x.id || '').replace(/\D/g, '').slice(-5);
      if (tail) code = `${x.base}_${tail}`;
    }
    return { id: x.id, code, name: x.name };
  });
}

/**
 * Sinh config mặc định từ thông tin đã dò được + lựa chọn của người dùng.
 * @param {{uid, coreDir, key, targetGroups, downloadDir, reportDir, projectLabel}} o
 */
function buildConfig(o) {
  const p = paths();
  return {
    // --- Trường engine bắt buộc ---
    zaloDataDir: (o.coreDir || '').replace(/\\/g, '/'),
    key: o.key || '',
    projectLabel: o.projectLabel || DEFAULT_LABEL,
    projectCode: '', // engine: không gắn mã dự án vào tiêu đề/tên báo cáo (chỉ config production khai báo "568")
    scheduledTaskName: TASK_NAME, // engine: báo cáo kiểm định hỏi trạng thái đúng tác vụ lịch của app
    targetGroups: normalizeGroups(o.targetGroups),
    downloadDir: (o.downloadDir || defaultDownloadDir()).replace(/\\/g, '/'),
    reportDir: (o.reportDir || defaultReportDir()).replace(/\\/g, '/'),
    cursorFile: p.cursorFile.replace(/\\/g, '/'),
    manifestFile: p.manifestFile.replace(/\\/g, '/'),
    organizationMode: 'by_group_date',
    writeMessageTranscripts: true,
    generateDriveIndex: false,
    syncReportToDrive: false,
    autoSynthesizeFieldProgress: false,
    firstRunLookbackDays: 14,
    safetyLookbackHours: 48,
    maxDownloadRetries: 3,
    categories: {
      '01_BanVe_CAD': ['.dwg', '.dxf', '.dgn'],
      '02_KhoiLuong_BOQ': ['.xlsx', '.xls', '.csv'],
      '03_BaoCao_TienDo': ['.docx', '.doc', '.pdf', '.xlsx', '.md'],
      '04_PhapLy_NghiemThu': ['.pdf', '.docx', '.doc'],
      '05_HienTruong_HinhAnh': ['.jpg', '.jpeg', '.png', '.jxl', '.mp4', '.mov'],
      '06_TaiLieuKhac': [],
    },
    // --- Trường app (engine bỏ qua) ---
    _app: {
      version: 1,
      uid: o.uid || '',
      scheduleTime: o.scheduleTime || '04:15',
      createdAt: new Date().toISOString(),
    },
  };
}

function exists() {
  try { return fs.existsSync(paths().configFile); } catch { return false; }
}

function load() {
  const p = paths();
  return JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
}

function save(config) {
  const p = ensureDirs();
  fs.writeFileSync(p.configFile, JSON.stringify(config, null, 2), 'utf8');
  return p.configFile;
}

/** Trạng thái vận hành nhẹ (lần chạy cuối, kết quả) do app tự ghi. */
function readState() {
  try { return JSON.parse(fs.readFileSync(paths().stateFile, 'utf8')); } catch { return {}; }
}
function writeState(patch) {
  const p = ensureDirs();
  const cur = readState();
  const next = { ...cur, ...patch };
  fs.writeFileSync(p.stateFile, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  DEFAULT_LABEL, TASK_NAME,
  dataRoot, paths, ensureDirs,
  defaultDownloadDir, defaultReportDir,
  groupCode, normalizeGroups,
  buildConfig, exists, load, save,
  readState, writeState,
};
