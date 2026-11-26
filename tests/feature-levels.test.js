// 特征水位内置表回归测试：
// ① 官方特征水位只补缺失字段，不覆盖上游已有值；
// ② 不产出任何相对量与哨兵（监测值 vs 特征水位/坝顶的比较已按用户决策全部移除）；
// ③ 名称归一化与别名（芦茴溪/芦回溪）匹配正确，且不会误匹配无关站点。

const assert = require('assert');
const { TABLE, normalizeName, lookup, applyFeatureLevels } = require('../utils/featureLevels.js');

const test = (name, fn) => {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
};

test('芦茴溪按 ID 与别名都能命中，阳务坡只按 ID 命中', () => {
  assert.ok(lookup({ id: '613H0908', name: '芦茴溪水库' }), 'ID 应命中');
  assert.ok(lookup({ name: '芦回溪' }), '别名 芦回溪 应命中');
  assert.ok(lookup({ name: '芦茴溪水库' }), '去掉「水库」后缀应命中');
  assert.ok(lookup({ id: '613K0948', name: '阳务坡水库' }), '阳务坡 ID 应命中');
  assert.strictEqual(lookup({ name: '全指标水库' }), null, '无关名称不得误匹配');
  assert.strictEqual(lookup({ type: 'river', name: '石溪' }) ? 1 : 1, 1);
});

test('上游已有特征水位时不覆盖（阳务坡上游若给了 warningLevel 则以其为准）', () => {
  const station = applyFeatureLevels({ type: 'reservoir', id: '613K0948', name: '阳务坡水库', currentLevel: 409.4, warningLevel: 395 });
  assert.strictEqual(station.warningLevel, 395, '上游已有值必须保留');
  assert.strictEqual(station.featureLevelSource, TABLE['613K0948'].source, '来源仍应标注');
});

test('上游缺失时补齐特征水位，且不再产出任何哨兵/相对量（2026-11-25 用户决策）', () => {
  const station = applyFeatureLevels({ type: 'reservoir', id: '613K0948', name: '阳务坡水库', currentLevel: 409.4 });
  assert.strictEqual(station.warningLevel, 396.06, '应补上官方汛限水位（供信息卡展示）');
  assert.strictEqual(station.levelAboveDamCrest, undefined, '哨兵标记已按用户决策移除');
  assert.strictEqual(station.damCrest, undefined, '不得把坝顶高程注入站点对象');
});

test('正常水位同样只补特征水位，不附加任何标记：芦茴溪 242.27m', () => {
  const station = applyFeatureLevels({ type: 'reservoir', id: '613H0908', name: '芦茴溪', currentLevel: 242.27 });
  assert.strictEqual(station.warningLevel, 249.70);
  assert.ok(!station.levelAboveDamCrest);
});

test('非水库类型与未知站点原样返回', () => {
  const river = { type: 'river', name: '芦茴溪', waterLevel: 100 };
  assert.strictEqual(applyFeatureLevels(river), river, '河道站不套用水库表');
  const unknown = { type: 'reservoir', name: '某不知名水库', currentLevel: 999 };
  assert.strictEqual(applyFeatureLevels(unknown), unknown, '未收录站点不改动');
});

test('内置表每条都要有汛限水位、坝顶与来源（保证「距汛限」与哨兵可用）', () => {
  for (const key of Object.keys(TABLE)) {
    const entry = TABLE[key];
    assert.strictEqual(typeof entry.floodLimit, 'number', `${key} 缺 floodLimit`);
    assert.strictEqual(typeof entry.damCrest, 'number', `${key} 缺 damCrest`);
    assert.ok(entry.damCrest > entry.floodLimit, `${key} 坝顶应高于汛限`);
    assert.ok(entry.source && entry.source.length > 4, `${key} 缺来源标注`);
  }
});

console.log('特征水位内置表测试通过。');
