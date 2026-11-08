import { runSimDemo } from '../demo.js';

const report = await runSimDemo();
console.log('시뮬 목표 흐름이 끝났습니다. 실제 Claude 호출과 메이플 월드 실행은 없습니다.');
console.log(`세션 ${report.sessionId} / 목표 상태 ${report.goalStatus}`);
console.log(`질문: ${report.question.split('\n')[0]}`);
for (const hop of report.hops) console.log(`${hop.name}: ${hop.ms}ms`);
console.log('이 숫자는 로컬 루프백입니다. 월드 반영 목표 1–2초와 같지 않습니다.');
