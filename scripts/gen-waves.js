// 生成 hero 水波纹背景 base64
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 140" preserveAspectRatio="none"><path d="M0 70 Q60 35 120 70 T240 70 T360 70 T480 70 T600 70 T720 70 T840 70 T960 70 T1080 70 T1200 70 V140 H0 Z" fill="rgba(255,255,255,0.09)"/><path d="M0 95 Q75 60 150 95 T300 95 T450 95 T600 95 T750 95 T900 95 T1050 95 T1200 95 V140 H0 Z" fill="rgba(255,255,255,0.06)"/></svg>';
console.log(Buffer.from(svg, 'utf8').toString('base64'));
