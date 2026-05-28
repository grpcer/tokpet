// SPDX-License-Identifier: Apache-2.0
//
// Flat-config ESLint setup for TypeScript.
// See https://eslint.org/docs/latest/use/configure/configuration-files-new

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  // Templates are intentionally stubbed; `await` is added by the user
  // when they implement the real upstream call.
  {
    files: ['src/providers/_template/**'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
