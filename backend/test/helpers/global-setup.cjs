/** Jest globalSetup: recreate, migrate and seed the test database (see global-setup.ts). */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function globalSetup() {
  const root = path.resolve(__dirname, '../..');
  execFileSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(__dirname, 'global-setup.ts')], { stdio: 'inherit', cwd: root, env: process.env });
};
