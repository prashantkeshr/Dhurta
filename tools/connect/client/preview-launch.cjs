const { spawn } = require('node:child_process');

const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5182', '--strictPort'], {
  cwd: __dirname,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (d) => process.stdout.write(`[vite:out] ${d}`));
child.stderr.on('data', (d) => process.stdout.write(`[vite:err] ${d}`));
child.on('error', (err) => console.log('[spawn error]', err));
child.on('exit', (code, signal) => console.log('[vite exited]', code, signal));
