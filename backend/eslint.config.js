import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'storage/**', 'jest.config.js', '**/*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  { files: ['src/db/migrate.ts', 'src/db/seed.ts', 'src/openapi/generate.ts'], rules: { 'no-console': 'off' } },
);
