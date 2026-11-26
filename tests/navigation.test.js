const assert = require('assert');
const navigation = require('../utils/navigation.js');

const KEY = navigation.PENDING_STATION_TYPE_KEY;
const storage = {};

global.wx = {
  setStorageSync(key, value) {
    storage[key] = value;
  },
  getStorageSync(key) {
    return storage[key];
  },
  removeStorageSync(key) {
    delete storage[key];
  }
};

function resetStorage() {
  Object.keys(storage).forEach((key) => delete storage[key]);
}

function test(name, fn) {
  try {
    resetStorage();
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('保存水库类型，并在列表页读取后清除', () => {
  navigation.setPendingStationType('reservoir');
  assert.strictEqual(storage[KEY], 'reservoir');
  assert.strictEqual(navigation.consumePendingStationType(), 'reservoir');
  assert.strictEqual(storage[KEY], undefined);
});

test('支持河道和土壤墒情类型', () => {
  navigation.setPendingStationType('river');
  assert.strictEqual(navigation.consumePendingStationType(), 'river');

  navigation.setPendingStationType('soil');
  assert.strictEqual(navigation.consumePendingStationType(), 'soil');
});

test('非法类型或空类型不会覆盖当前待跳转类型', () => {
  navigation.setPendingStationType('reservoir');
  navigation.setPendingStationType('all');
  navigation.setPendingStationType('unknown');
  navigation.setPendingStationType('');
  assert.strictEqual(navigation.consumePendingStationType(), 'reservoir');
});

test('没有待跳转类型时返回空值', () => {
  assert.strictEqual(navigation.consumePendingStationType(), '');
});

console.log('全部导航状态测试通过。');
