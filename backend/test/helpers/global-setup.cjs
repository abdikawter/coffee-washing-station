/** Jest globalSetup: recreate, migrate and seed the test database (see global-setup.ts). */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function globalSetup() {
  const root = path.resolve(__dirname, '../..');
  // Run tsx's CLI through node directly: node_modules/.bin/tsx is a .cmd shim on Windows.
  const tsxCli = path.join(root, 'node_modules/tsx/dist/cli.mjs');
  execFileSync(process.execPath, [tsxCli, path.join(__dirname, 'global-setup.ts')], { stdio: 'inherit', cwd: root, env: process.env });
};
