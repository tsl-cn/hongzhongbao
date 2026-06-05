/**
 * 验证 4层结算引擎
 *
 * 例子：
 * 东(W)胡家, f_w=4
 * 自风马4匹：东中, 南不中, 西不中, 北不中
 * 实马：东1中, 南1中+1不, 西1不, 北0
 * 非胡家杠：南1明杠(f=1), 西1暗杠(f=2)
 *
 * 预期：东+28, 南-6, 西-4, 北-18
 */

const SettlementEngine = require('./SettlementEngine');

const params = {
  winner: 0,
  fan_w: 4,
  players: [
    { name: '东(W)', seatIndex: 0, melds: [] },
    { name: '南(A)', seatIndex: 1, melds: [{ type: 'exposed_kong', tiles: [1,1,1,1] }] },
    { name: '西(B)', seatIndex: 2, melds: [{ type: 'concealed_kong', tiles: [10,10,10,10] }] },
    { name: '北(C)', seatIndex: 3, melds: [] },
  ],
  horseResults: [
    { seatIndex: 0, playerName: '东(W)', horses: [{ tileType: 0, ownerSeat: 0 }] },
    { seatIndex: 1, playerName: '南(A)', horses: [
      { tileType: 1, ownerSeat: 0 },
      { tileType: 2, ownerSeat: 1 },
    ]},
    { seatIndex: 2, playerName: '西(B)', horses: [{ tileType: 3, ownerSeat: 2 }] },
    { seatIndex: 3, playerName: '北(C)', horses: [] },
  ],
  playerNames: ['东', '南', '西', '北'],
};

const result = SettlementEngine.settle(params);

console.log('=== 各家结算 ===');
console.log('perPlayer:', result.perPlayer);

const total = result.perPlayer.reduce((a,b) => a+b, 0);
console.log(`全场和: ${total} ${total === 0 ? '✅' : '❌'}`);

const expected = [28, -6, -4, -18];
const match = result.perPlayer.every((v, i) => v === expected[i]);
console.log(`预期 ${JSON.stringify(expected)} → ${match ? '✅ 通过' : '❌ 不匹配'}`);

// 逐马明细
console.log('\n=== 逐马明细 ===');
result.horseSettlement.forEach((hs, i) => {
  console.log(`\n${['东','南','西','北'][i]}(${hs.playerName}) 共${hs.count}匹, 小计${hs.pickerAdjustment}:`);
  hs.results.forEach(r => {
    const seatName = ['东','南','西','北'][r.ownerSeat] || '?';
    console.log(`  ${r.tileName}→${seatName} ${r.isHit ? '✓' : '✗'} ${r.adjustment > 0 ? '+' : ''}${r.adjustment}`);
  });
});
