import {execFileSync} from 'node:child_process';

export function requireCleanSource(root, git = execFileSync) {
  const options = {cwd:root, encoding:'utf8', windowsHide:true};
  const status = git('git', ['status','--porcelain=v1','--untracked-files=all'], options);
  if (status.trim()) throw new Error('Release requires a clean source checkout, including untracked files. Review and commit source first.');
  const commit = git('git', ['rev-parse','--verify','HEAD'], options).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Release source commit is invalid.');
  return commit;
}
