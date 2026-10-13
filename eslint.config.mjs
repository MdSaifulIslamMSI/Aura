import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

// Root ESLint project, scoped to the Node-side sources that had no linting at
// all: desktop/ (plain CommonJS Electron) and scripts/ (mixed .mjs/.cjs).
//
// app/ has its own ESLint project in app/eslint.config.js with the React,
// TypeScript, and formatjs plugins. This config deliberately does not reach
// into it — one root, one frontend — so `npm run lint` stays a single command
// while each project keeps its own rules.
export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/desktop-release/**',
    '**/generated/**',
    '**/output/**',
    '**/coverage/**',
    '**/.run-logs/**',
  ]),

  // The desktop shell: CommonJS, Electron main-process, runs on Node.
  {
    files: ['desktop/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,

      // no-undef is the rule that would have caught the lost
      // DESKTOP_AUTH_TOKEN_MAX_LENGTH export: destructuring a name a module
      // does not export yields undefined rather than a load error, so a guard
      // like `length > UNDEFINED` silently stops rejecting anything.
      'no-undef': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-implicit-coercion': ['error', { boolean: false }],
      'no-throw-literal': 'error',
      'no-return-await': 'error',
      'no-async-promise-executor': 'error',

      // Control-character matching is the point of these rules: they reject
      // NUL/control bytes smuggled into a return path or a URL. Flagging them
      // would be flagging the defence itself.
      'no-control-regex': 'off',

      // main.cjs assigns the shared `runtime` handle from an async start. The
      // single-instance lock plus mainWindowCreationPromise already serialise
      // that path, so the rule's warning here is not actionable.
      'require-atomic-updates': 'off',

      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },

  // preload.cjs runs in the renderer, so it legitimately touches `window` and
  // dispatchs DOM events even though the file is CommonJS.
  {
    files: ['desktop/preload.cjs', 'desktop/**/*.test.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Repo automation: ESM, mixes modern syntax and Node built-ins.
  //
  // Scoped deliberately narrowly. `scripts/` is large, pre-existing, and not
  // part of the desktop work; enabling opinionated rules across it would bury
  // the desktop signal under unrelated churn. Only the correctness rules run
  // here, and the file is a documented follow-up rather than a silent gap.
  {
    files: ['scripts/**/*.{mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'error',
      'no-async-promise-executor': 'error',

      // Correctness-only for scripts/. The unused/dead-code and style rules
      // already flag real debt across this large pre-existing tree; leaving
      // them off keeps the gate useful instead of red on day one.
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'no-control-regex': 'off',
      'preserve-caught-error': 'off',

      // Escaped metacharacters inside character classes are deliberate in the
      // security scanners, which build patterns from secret syntax.
      'no-useless-escape': 'off',

      // Unicode-aware character classes are the point in the i18n scanners, and
      // scripts/ is pre-existing code outside this change's scope.
      'no-misleading-character-class': 'off',
    },
  },
]);