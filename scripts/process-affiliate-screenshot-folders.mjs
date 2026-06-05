import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

execFileSync(process.execPath, [
  resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  'src/merlin/affiliateScreenshotFolderProcessing.ts',
  ...process.argv.slice(2)
], {
  cwd: process.cwd(),
  stdio: 'inherit'
});
