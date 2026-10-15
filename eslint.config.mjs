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

  // server/: the Express + MongoDB API. CommonJS, and by far the largest
  // Node-side tree (689 sources, 486 tests) that previously had no linting at
  // all — both security findings in the 2026-10-14 assessment originated here
  // (a misclassified cache route class and a health payload that bypassed its
  // disclosure gate), and nothing here would have flagged either class of bug.
  //
  // Same posture as scripts/: correctness rules only. The unused/style rules
  // already flag real debt across a tree this size, so turning them on would
  // bury any future signal. The point is a gate that is green today and catches
  // regressions tomorrow.
  {
    files: ['server/**/*.js', 'server/**/*.cjs'],
    // server/scripts/ holds migrations, backfills, wipes, and seeders that touch
    // real data. Excluded from this gate on purpose — they change rarely, are
    // reviewed by hand, and are not where a routine edit introduces a defect.
    ignores: ['server/**/node_modules/**', 'server/scripts/**', 'server/seeders/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-var': 'error',
      // `== null` is deliberate in this tree: it tests for both null and
      // undefined in one comparison (finalValue presence checks, cursor
      // termination). Tightening it to === would silently change behaviour.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
      'no-async-promise-executor': 'error',
      'no-return-await': 'error',
      // Best-effort notification emission uses an intentional empty catch.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Migration loops legitimately use `while (true)` with an inner break.
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-undef': 'error',

      // Dynamic-code guards. These are the rules most likely to catch an
      // injection sink introduced by a dependency, a migration, or a codegen
      // pass, and they have no legitimate use in this tree.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-debugger': 'error',

      // Correctness-only for the pre-existing tree, mirroring scripts/.
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'no-control-regex': 'off',
      'preserve-caught-error': 'off',
      'no-useless-escape': 'off',
      'no-misleading-character-class': 'off',

      // Opinionated/style rules that already fire across a tree this size and
      // would bury any future signal. Turned off deliberately, not overlooked.
      'no-console': 'off', // the logger wraps console; direct use is intentional
      'no-await-in-loop': 'off', // deliberate sequencing in retry/queue paths
      'global-require': 'off', // CommonJS idiom used throughout server/
      'class-methods-use-this': 'off',
      'no-continue': 'off',
      'no-extra-boolean-cast': 'off',
      'no-regex-spaces': 'off',
      'no-restricted-syntax': 'off',
      'no-useless-catch': 'off',
      'prefer-const': 'off',
    },
    // Turning `no-console` off above makes the tree's existing
    // `eslint-disable-next-line no-console` directives redundant. Reporting
    // them would mean editing ~20 unrelated files to silence noise this config
    // introduced, so they are not reported. Scoped to server/ on purpose: the
    // desktop/ and scripts/ blocks keep their existing reporting behaviour.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },

  // Jest suites, both the server/tests/ tree and the co-located */tests/ ones.
  // Same correctness rules as the source block, plus the Jest globals the
  // runner injects at runtime.
  {
    files: [
      'server/tests/**/*.js',
      'server/**/tests/**/*.js',
      'server/**/*.test.js',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-var': 'error',
      'no-throw-literal': 'error',
      'no-async-promise-executor': 'error',
      'no-undef': 'error',
      'no-unused-vars': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-misleading-character-class': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',
      'no-await-in-loop': 'off',
      'global-require': 'off',
      'class-methods-use-this': 'off',
      'no-continue': 'off',
      'no-extra-boolean-cast': 'off',
      'no-regex-spaces': 'off',
      'no-restricted-syntax': 'off',
      'no-useless-catch': 'off',
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      'prefer-const': 'off',
    },
    // Same rationale as the server source block above: the suite carries the
    // tree's pre-existing `no-console` disable directives, which this block's
    // `no-console: off` makes redundant. Reported from neither block.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
]);