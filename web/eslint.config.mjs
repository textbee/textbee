import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

// Next 16 removed `next lint`; eslint-config-next now ships a native ESLint 9
// flat config, so we spread it directly (this replaces the old .eslintrc.json).
const eslintConfig = [
  ...nextCoreWebVitals,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      // Next 16 enables the newer react-hooks (v6) compiler-adjacent rules by
      // default. They flag working-but-non-optimal patterns across this
      // pre-existing codebase, so keep them advisory (warn) rather than
      // blocking; tighten to error as components are refactored.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/incompatible-library': 'warn',
    },
  },
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      // Node helper scripts, outside the app lint rules
      'scripts/**',
    ],
  },
]

export default eslintConfig
