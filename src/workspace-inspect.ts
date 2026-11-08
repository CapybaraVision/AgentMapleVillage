import { spawn } from 'node:child_process';

export interface InspectedFile {
  path: string;
  added: number | null;
  removed: number | null;
}

export interface WorkdirInspect {
  repo: boolean;
  files: InspectedFile[];
  summary: string;
}

/** Fixed git arguments only. The caller chooses the directory. No shell and no extra user text. */
export async function inspectWorkdir(dir: string): Promise<WorkdirInspect> {
  const status = await runGit(dir, ['status', '--porcelain']);
  if (status.code !== 0) {
    const missing = /not a git repository/i.test(`${status.stderr}\n${status.stdout}`);
    return {
      repo: false,
      files: [],
      summary: missing
        ? '이 세션 폴더는 git 저장소가 아닙니다. 변경 파일과 테스트 결과는 이 검사에 없습니다.'
        : 'git 상태 조회가 실패했습니다. 테스트 결과는 이 검사에 없습니다.',
    };
  }
  const diff = await runGit(dir, ['diff', '--numstat']);
  const counts = new Map<string, { added: number; removed: number }>();
  for (const line of diff.stdout.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
    if (!match) continue;
    counts.set(match[3], {
      added: match[1] === '-' ? 0 : Number(match[1]),
      removed: match[2] === '-' ? 0 : Number(match[2]),
    });
  }
  const names = status.stdout
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .slice(0, 8);
  if (names.length === 0) {
    return { repo: true, files: [], summary: '변경된 파일이 없습니다. 테스트 결과는 이 검사에 없습니다.' };
  }
  const files = names.map((name) => {
    const pathName = name.includes(' -> ') ? name.split(' -> ').at(-1)!.trim() : name;
    const count = counts.get(name) ?? counts.get(pathName);
    return { path: pathName, added: count?.added ?? null, removed: count?.removed ?? null };
  });
  const lines = files.map((file) => (file.added === null ? file.path : `${file.path} +${file.added} -${file.removed}`));
  return {
    repo: true,
    files,
    summary: `변경 ${files.length}\n${lines.join('\n')}\n테스트 결과는 이 검사에 없습니다.`.slice(0, 400),
  };
}

function runGit(dir: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', dir, ...args], { shell: false, windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', () => resolve({ code: 127, stdout: '', stderr: 'git failed to start' }));
    child.on('exit', (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}
