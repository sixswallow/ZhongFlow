const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'pages', 'index', 'index.js'), 'utf8');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('App 全局状态不再声明 stations', () => {
  assert.strictEqual(/\bstations\s*:/.test(appSource), false);
});

test('App 启动时不再恢复无效的 stations 本地缓存', () => {
  assert.strictEqual(/getStorageSync\(['"]stations['"]\)/.test(appSource), false);
});

test('首页不再将统计对象写入 globalData.stations', () => {
  assert.strictEqual(/globalData\.stations\s*=/.test(indexSource), false);
});

console.log('全局站点状态清理测试通过。');
