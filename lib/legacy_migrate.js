'use strict';
/**
 * legacy_migrate.js — Chuyển 1 lần bản cài cũ (tên cũ "Zalo Sync 568") sang tên mới "Zalo Sync".
 *
 * Bản cũ để cấu hình + tiến độ ở %LOCALAPPDATA%\ZaloSync568 và lịch ở tác vụ ZaloSync568_Daily. Không chuyển thì
 * bản mới mất cấu hình + con trỏ đồng bộ (phải thiết lập lại) và tác vụ cũ vẫn chạy song song tác vụ mới.
 * Cấu hình do bản cũ sinh ra còn được nâng cấp (upgradeConfig): engine bỏ "568" khỏi báo cáo, thư mục MẶC ĐỊNH cũ
 * Documents\ZaloSync568 đổi tên thành Documents\ZaloSync. Thư mục người dùng tự chọn giữ NGUYÊN.
 * GUI gọi `cli.js migrate` khi khởi động, TRƯỚC mọi lệnh khác.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const configStore = require('./config_store');

const LEGACY_DIR = 'ZaloSync568';
const LEGACY_TASK = 'ZaloSync568_Daily';
const LEGACY_LABEL = 'Zalo Sync 568 — dữ liệu nhóm công trường';
// config.json chép SAU CÙNG: có nó = đã chuyển xong (lỡ dở thì lần sau chép lại từ đầu).
const CARRY = ['cursor.json', 'manifest.json', 'state.json', 'logs'];
const ARCHIVED_LOG = 'daily_sync_ban_cu.log';

/** Chép cấu hình + tiến độ của bản cũ sang thư mục mới (bỏ qua nếu bản mới đã có cấu hình). */
function carryData(oldDir) {
  const oldCfg = path.join(oldDir, 'config.json');
  if (configStore.exists() || !fs.existsSync(oldCfg)) return;
  const p = configStore.ensureDirs();
  for (const f of CARRY) {
    const src = path.join(oldDir, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(p.root, f), { recursive: true });
  }
  // log bản cũ (banner + đường dẫn tên cũ) cất riêng → ô log của app bắt đầu sạch, lịch sử vẫn giữ
  if (fs.existsSync(p.logFile)) fs.renameSync(p.logFile, path.join(p.logDir, ARCHIVED_LOG));
  const cfg = JSON.parse(fs.readFileSync(oldCfg, 'utf8'));
  cfg.cursorFile = p.cursorFile.replace(/\\/g, '/');
  cfg.manifestFile = p.manifestFile.replace(/\\/g, '/');
  if (cfg.projectLabel === LEGACY_LABEL) cfg.projectLabel = configStore.DEFAULT_LABEL;
  configStore.save(cfg);
}

/** Thư mục %LOCALAPPDATA%\ZaloSync568: chuyển dữ liệu + lịch chạy rồi xoá. Trả thông báo lỗi nếu phải để lần sau thử lại. */
function moveAppData(oldDir, scheduler) {
  carryData(oldDir);
  // run_sync.bat chỉ được sinh khi bật lịch → có bat mới hỏi Task Scheduler (đỡ ~1 s PowerShell).
  if (fs.existsSync(path.join(oldDir, 'run_sync.bat'))) {
    const t = scheduler.query(LEGACY_TASK);
    // giữ thư mục cũ (cả bat) để lần khởi động sau còn nhận ra tác vụ cũ và thử lại
    if (t.error) return `Không kiểm tra được lịch chạy cũ ${LEGACY_TASK}: ${t.error}`;
    if (t.exists) {
      // cài mới TRƯỚC, gỡ cũ SAU: lỗi giữa chừng thì vẫn còn ít nhất 1 tác vụ chạy được
      scheduler.install(configStore.exists() ? (configStore.load()._app || {}).scheduleTime : undefined);
      scheduler.uninstall(LEGACY_TASK);
    }
  }
  fs.rmSync(oldDir, { recursive: true, force: true });
  return null;
}

/** p (đường dẫn trong config, dạng 'C:/…') nằm trong thư mục dir? (Windows: không phân biệt hoa/thường) */
function isInside(p, dir) {
  if (typeof p !== 'string' || !p) return false;
  const rel = path.relative(dir, path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Cấu hình do app sinh (có _app) trước khi đổi tên: thêm projectCode '' (engine bỏ "568" khỏi tiêu đề/tên báo cáo) và
 * đổi tên thư mục MẶC ĐỊNH cũ Documents\ZaloSync568 → Documents\ZaloSync nếu cấu hình còn trỏ vào đó. Đổi tên tại chỗ
 * (cùng ổ → tức thì, manifest lưu theo TÊN tệp nên không phải tải lại); không gộp nếu Documents\ZaloSync đã có.
 * Đổi tên lỗi (đang mở tệp trong đó) → cấu hình vẫn trỏ chỗ cũ (dùng được), ném lỗi rõ ràng → lần mở sau thử lại.
 */
function upgradeConfig() {
  if (!configStore.exists()) return false;
  const cfg = configStore.load();
  if (!cfg._app) return false;
  let changed = false;
  if (!('projectCode' in cfg)) { cfg.projectCode = ''; changed = true; }
  if (!('scheduledTaskName' in cfg)) { cfg.scheduledTaskName = configStore.TASK_NAME; changed = true; }
  const oldDocs = path.join(os.homedir(), 'Documents', LEGACY_DIR);
  const newDocs = path.dirname(configStore.defaultDownloadDir());
  const keys = ['downloadDir', 'reportDir'].filter((k) => isInside(cfg[k], oldDocs));
  let renameError = null;
  if (keys.length && fs.existsSync(oldDocs) && !fs.existsSync(newDocs)) {
    try {
      fs.renameSync(oldDocs, newDocs);
      for (const k of keys) cfg[k] = path.join(newDocs, path.relative(oldDocs, path.resolve(cfg[k]))).replace(/\\/g, '/');
      changed = true;
    } catch (e) {
      renameError = new Error(`Chưa đổi tên được thư mục ${oldDocs} → ${newDocs} (đang mở tệp/cửa sổ trong đó?): ${e.message}`);
    }
  }
  if (changed) configStore.save(cfg);
  if (renameError) throw renameError;
  return changed;
}

/**
 * @param {{query, install, uninstall}} scheduler  mặc định task_scheduler (test truyền bản giả)
 * @returns {{ok:boolean, migrated:boolean, error?:string}}
 */
function migrate(scheduler = require('./task_scheduler')) {
  const oldDir = path.join(path.dirname(configStore.dataRoot()), LEGACY_DIR);
  let migrated = false;
  if (fs.existsSync(oldDir)) {
    const error = moveAppData(oldDir, scheduler);
    if (error) return { ok: false, migrated: true, error };
    migrated = true;
  }
  if (upgradeConfig()) migrated = true;
  return { ok: true, migrated };
}

module.exports = { migrate, LEGACY_TASK };
