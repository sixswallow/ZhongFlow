// 一次性运行 tests/ 下全部 *.test.js，输出汇总结果
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const testsDir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.js')).sort();
let pass = 0;
const failed = [];

for (const f of files) {
  try {
    execFileSync(process.execPath, [path.join(testsDir, f)], { stdio: 'pipe', encoding: 'utf8' });
    pass++;
    console.log('PASS  ' + f);
  } catch (e) {
    failed.push(f);
    console.log('FAIL  ' + f);
    console.log('      ' + String(e.stderr || e.message).split('\n').slice(0, 8).join('\n      '));
  }
}

console.log(`\n合计 ${files.length} 个：通过 ${pass}，失败 ${failed.length}`);
if (failed.length) {
  console.log('失败列表: ' + failed.join(', '));
  process.exitCode = 1;
}
