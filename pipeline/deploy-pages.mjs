// Publishes dist/ to the gh-pages branch, which GitHub Pages serves.
// Used instead of the Actions workflow while Actions is unavailable on the account.
// Run: npm run deploy   (runs the tests and the build first)
// Adds one commit on top of gh-pages; never force-pushes.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const root = process.cwd();
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/index.html missing: run npm run build first');

const remote = run('git', ['remote', 'get-url', 'origin'], root);
const head = run('git', ['rev-parse', '--short', 'HEAD'], root);
if (run('git', ['status', '--porcelain'], root) !== '') {
  throw new Error('Uncommitted changes: commit and push main first, so the live site matches a commit.');
}

const work = mkdtempSync(join(tmpdir(), 'ribbon-pages-'));
try {
  run('git', ['clone', '--quiet', '--depth', '1', '--branch', 'gh-pages', remote, work]);
  for (const name of readdirSync(work)) if (name !== '.git') rmSync(join(work, name), { recursive: true, force: true });
  cpSync(dist, work, { recursive: true });
  writeFileSync(join(work, '.nojekyll'), '');
  run('git', ['add', '-A'], work);
  if (run('git', ['status', '--porcelain'], work) === '') {
    console.log('gh-pages already matches dist/; nothing to publish.');
  } else {
    const msg = `Built site from main ${head}`;
    run('git', ['-c', 'core.autocrlf=false', 'commit', '--quiet', '-m', msg], work);
    run('git', ['push', '--quiet', 'origin', 'gh-pages'], work);
    console.log(`Published dist/ from ${head} to gh-pages.`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
