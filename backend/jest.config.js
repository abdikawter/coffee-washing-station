/** Jest (ESM) config. Run through `npm test`, which enables --experimental-vm-modules. */
const tsJest = ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } }];
const common = {
  extensionsToTreatAsEsm: ['.ts'],
  transform: { '^.+\\.ts$': tsJest },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
};
export default {
  projects: [
    { ...common, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.test.ts'] },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      globalSetup: '<rootDir>/test/helpers/global-setup.cjs',
      setupFiles: ['<rootDir>/test/helpers/env.ts'],
    },
  ],
};
