import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'coverage/**/*', 'playwright-report/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
