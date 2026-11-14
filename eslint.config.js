/* ScrapMan — flat ESLint config.
 *
 * Two tiers on purpose:
 *
 *   1. Refactored code (src/, scripts/, verify-collector/) is linted strictly —
 *      `no-undef` and `no-unused-vars` are errors there, which is what catches a
 *      module importing something that doesn't exist or forgetting to export.
 *
 *   2. The legacy classic-script frontend (app.js, auth.js, geo.js, sw.js,
 *      supabase-config.js) shares one global scope through <script> tag order, so
 *      `no-undef` would need a hand-maintained list of every cross-file symbol and
 *      would flag every one of them the moment the file order changed. Those rules
 *      stay off there and the files are still checked for syntax and dead code.
 *      Phase 2 moves that code into src/ modules, after which tier 1 covers it.
 */

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  fetch: "readonly",
  module: "writable",
  require: "readonly",
  exports: "writable",
  __dirname: "readonly",
  __filename: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly"
};

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  localStorage: "readonly",
  location: "readonly",
  console: "readonly",
  fetch: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  CustomEvent: "readonly",
  alert: "readonly",
  confirm: "readonly",
  Image: "readonly",
  caches: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly"
};

export default [
  {
    ignores: ["node_modules/**", "**/node_modules/**", "**/*.min.js"]
  },
  {
    // Refactored browser modules.
    files: ["src/**/*.js", "scripts/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...browserGlobals, ...nodeGlobals }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_" }],
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      eqeqeq: ["error", "smart"],
      "prefer-const": "error"
    }
  },
  {
    // Node service: CommonJS (its own package.json has no "type": "module").
    files: ["verify-collector/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: nodeGlobals
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_" }],
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      eqeqeq: ["error", "smart"],
      "prefer-const": "error"
    }
  },
  {
    // Legacy classic scripts — see the tier-2 note above.
    files: ["app.js", "auth.js", "geo.js", "sw.js", "supabase-config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: { ...browserGlobals, self: "readonly" }
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-dupe-keys": "error",
      "no-unreachable": "error"
    }
  }
];
