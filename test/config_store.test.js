'use strict';
// Chạy (từ app/): node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const configStore = require('../lib/config_store');
const scheduler = require('../lib/task_scheduler');
const { withFakeAppData } = require('./_helpers');

test('dữ liệu của app nằm ở %LOCALAPPDATA%\\ZaloSync (tên mới, không còn 568)', () => {
  withFakeAppData((tmp, root) => {
    assert.equal(configStore.dataRoot(), root);
    assert.equal(path.basename(root), 'ZaloSync');
  });
});

test('buildConfig mặc định: thư mục Documents\\ZaloSync + nhãn dự án "Zalo Sync"', () => {
  withFakeAppData((tmp, root) => {
    const cfg = configStore.buildConfig({ uid: '1', coreDir: 'C:\\x', key: 'k' });
    const docs = path.join(os.homedir(), 'Documents', 'ZaloSync').replace(/\\/g, '/');
    assert.equal(cfg.downloadDir, `${docs}/data`);
    assert.equal(cfg.reportDir, `${docs}/baocao`);
    assert.equal(cfg.projectLabel, 'Zalo Sync — dữ liệu nhóm công trường');
    assert.equal(cfg.projectLabel, configStore.DEFAULT_LABEL);
    assert.equal(cfg.projectCode, '', 'engine không gắn mã "568" vào tiêu đề/tên báo cáo');
    assert.equal(cfg.scheduledTaskName, scheduler.TASK_NAME, 'báo cáo kiểm định hỏi đúng tác vụ lịch của app');
    assert.equal(cfg.cursorFile, path.join(root, 'cursor.json').replace(/\\/g, '/'));
  });
});

test('tác vụ lịch hằng ngày mang tên mới ZaloSync_Daily', () => {
  assert.equal(scheduler.TASK_NAME, 'ZaloSync_Daily');
});

test('buildConfig: code thư mục suy từ TÊN nhóm, không dùng mã nhóm (id) nữa', () => {
  withFakeAppData(() => {
    const cfg = configStore.buildConfig({
      targetGroups: [{ id: 'g3635258592664945203', code: 'g3635258592664945203', name: 'Nội nghiệp ĐĐTL' }],
    });
    // id giữ nguyên (khóa kỹ thuật để mở DB/cursor); code thành tên đọc được, hợp lệ cho đường dẫn Windows
    assert.equal(cfg.targetGroups[0].id, 'g3635258592664945203');
    assert.equal(cfg.targetGroups[0].code, 'Nội_nghiệp_ĐĐTL');
    assert.equal(cfg.targetGroups[0].name, 'Nội nghiệp ĐĐTL');
  });
});

test('buildConfig: code loại ký tự cấm trong đường dẫn + gộp khoảng trắng', () => {
  withFakeAppData(() => {
    const cfg = configStore.buildConfig({
      targetGroups: [{ id: 'g1', name: '  Thầu phụ: A/B * "công" <trường>  ' }],
    });
    assert.equal(cfg.targetGroups[0].code, 'Thầu_phụ_A_B_công_trường');
  });
});

test('buildConfig: tên rỗng/toàn ký tự cấm → lùi về id', () => {
  withFakeAppData(() => {
    const cfg = configStore.buildConfig({ targetGroups: [{ id: 'g777', name: '  /// ' }] });
    assert.equal(cfg.targetGroups[0].code, 'g777');
  });
});

test('buildConfig: hai nhóm trùng tên → thêm đuôi id để code không đụng nhau (không trộn thư mục)', () => {
  withFakeAppData(() => {
    const cfg = configStore.buildConfig({
      targetGroups: [
        { id: 'g3635258592664945203', name: 'Công trường' },
        { id: 'g9000000000000012345', name: 'Công trường' },
      ],
    });
    const codes = cfg.targetGroups.map(g => g.code);
    assert.equal(new Set(codes).size, 2, 'code phải khác nhau');
    assert.equal(codes[0], 'Công_trường_45203');
    assert.equal(codes[1], 'Công_trường_12345');
  });
});
