import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import tsdocPlugin from "eslint-plugin-tsdoc";
import jsdocPlugin from "eslint-plugin-jsdoc";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    ignores: [
      "**/.mcp-use/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/*.min.js",
      "**/.turbo/**",
      "**/.tsup/**",
      "packages/*/dist/**",
      "packages/*/build/**",
      "packages/*/node_modules/**",
      "test_app/**",
      "**/playwright-report/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx", "**/*.mts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        // Node.js globals
        __dirname: "readonly",
        __filename: "readonly",
        exports: "writable",
        module: "readonly",
        require: "readonly",
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        NodeJS: "readonly",
        // ES6+ globals
        Promise: "readonly",
        Map: "readonly",
        Set: "readonly",
        WeakMap: "readonly",
        WeakSet: "readonly",
        Symbol: "readonly",
        Proxy: "readonly",
        Reflect: "readonly",
        // Web APIs available in both Node.js and browsers
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        ReadableStream: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        WebSocket: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        HeadersInit: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        btoa: "readonly",
        atob: "readonly",
        // Browser globals
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        // HTML Element types
        HTMLInputElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLDivElement: "readonly",
        HTMLSpanElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLIFrameElement: "readonly",
        HTMLElement: "readonly",
        HTMLParagraphElement: "readonly",
        HTMLHeadingElement: "readonly",
        HTMLTableElement: "readonly",
        HTMLTableSectionElement: "readonly",
        HTMLTableRowElement: "readonly",
        HTMLTableCellElement: "readonly",
        HTMLTableCaptionElement: "readonly",
        SVGSVGElement: "readonly",
        // Browser APIs
        MessageEvent: "readonly",
        MutationObserver: "readonly",
        ResizeObserver: "readonly",
        queueMicrotask: "readonly",
        FileReader: "readonly",
        // React
        React: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: true,
      },
    },
    rules: {
      "array-callback-return": "error",
      "default-case": ["error", { commentPattern: "^no default$" }],
      "dot-location": ["error", "property"],
      eqeqeq: ["error", "smart"],
      "new-parens": "error",
      "no-array-constructor": "error",
      "no-caller": "error",
      "no-cond-assign": ["error", "except-parens"],
      "no-const-assign": "error",
      "no-control-regex": "error",
      "no-delete-var": "error",
      "no-dupe-args": "error",
      "no-dupe-class-members": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty-character-class": "error",
      "no-empty-pattern": "error",
      "no-eval": "error",
      "no-ex-assign": "error",
      "no-extend-native": "error",
      "no-extra-bind": "error",
      "no-extra-label": "error",
      "no-fallthrough": "error",
      "no-func-assign": "error",
      "no-implied-eval": "error",
      "no-invalid-regexp": "error",
      "no-iterator": "error",
      "no-label-var": "error",
      "no-labels": ["error", { allowLoop: true, allowSwitch: false }],
      "no-lone-blocks": "error",
      "no-loop-func": "error",
      "no-multi-str": "error",
      "no-new-func": "error",
      "no-new-object": "error",
      "no-new-symbol": "error",
      "no-new-wrappers": "error",
      "no-obj-calls": "error",
      "no-octal": "error",
      "no-octal-escape": "error",
      "no-regex-spaces": "error",
      "no-restricted-syntax": [
        "error",
        "WithStatement",
        {
          message: "substr() is deprecated, use slice() or substring() instead",
          selector: "MemberExpression > Identifier[name='substr']",
        },
      ],
      "no-script-url": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-sequences": "error",
      "no-shadow": "off",
      "no-shadow-restricted-names": "error",
      "no-sparse-arrays": "error",
      "no-template-curly-in-string": "error",
      "no-this-before-super": "error",
      "no-throw-literal": "error",
      "no-undef": "error",
      "no-unexpected-multiline": "error",
      "no-unreachable": "error",
      "no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
      "no-unused-labels": "error",
      "no-unused-vars": "off",
      "no-useless-computed-key": "error",
      "no-useless-concat": "error",
      "no-useless-constructor": "off",
      "no-useless-escape": "error",
      "no-useless-rename": [
        "error",
        {
          ignoreDestructuring: false,
          ignoreImport: false,
          ignoreExport: false,
        },
      ],
      "no-with": "error",
      "no-whitespace-before-property": "error",
      "require-yield": "error",
      "rest-spread-spacing": ["error", "never"],
      strict: ["error", "never"],
      "unicode-bom": ["error", "never"],
      "use-isnan": "error",
      "valid-typeof": "error",
      "getter-return": "error",
      "prefer-const": "error",
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/no-redeclare": [
        "error",
        { builtinGlobals: false, ignoreDeclarationMerge: true },
      ],
    },
  },
  // TypeScript files
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      "no-undef": "off", // TypeScript handles undefined checks
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "none",
          ignoreRestSiblings: true,
          argsIgnorePattern: "^_",
          caughtErrors: "none",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          disallowTypeAnnotations: false,
        },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": "off",
      "no-case-declarations": "warn",
      "no-constant-condition": "warn",
    },
  },
  // CLI packages
  {
    files: [
      "packages/create-mcp-use-app/**/*.ts",
      "packages/server/src/bin/**/*.ts",
      "packages/server/src/commands/**/*.ts",
    ],
    rules: {
      "no-console": "off",
      "no-process-exit": "off",
    },
  },
  // mcp-use (includes the folded-in CLI and dev/build
  // toolchain under src/cli/) — strictest type safety, no escape hatches.
  // `any` is banned outright; `unknown` is allowed only at real boundaries
  // and must be narrowed before use (the no-unsafe-* rules enforce this).
  // Doc comments must be valid TSDoc (see packages/server/CLAUDE.md).
  {
    files: ["packages/server/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        projectService: false,
        project: ["./packages/server/tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      tsdoc: tsdocPlugin,
      jsdoc: jsdocPlugin,
    },
    settings: {
      jsdoc: {
        mode: "typescript",
      },
    },
    rules: {
      "tsdoc/syntax": "error",
      // Coverage only — tag style/content is tsdoc/syntax + review territory.
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          enableFixer: false,
          require: {
            ClassDeclaration: true,
            FunctionDeclaration: true,
            MethodDefinition: true,
          },
          contexts: [
            "TSInterfaceDeclaration",
            "TSTypeAliasDeclaration",
            "TSEnumDeclaration",
          ],
          exemptEmptyConstructors: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "import/no-extraneous-dependencies": [
        "error",
        { devDependencies: false },
      ],
    },
  },
  // The production declaration build deliberately excludes the Vite-only
  // dev/build commands. Lint those files against the test config, where their
  // types are included, and permit their development-only toolchain imports.
  {
    files: [
      "packages/server/src/cli/build.ts",
      "packages/server/src/cli/dev.ts",
      "packages/server/src/cli/views-bindings.ts",
      "packages/server/src/cli/views.ts",
    ],
    rules: {
      "import/no-extraneous-dependencies": ["error", { devDependencies: true }],
    },
  },
  // Test files
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "tests/**/*.ts",
      "**/vitest.config.ts",
      "**/vitest.config.mts",
    ],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
        vi: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-unreachable-loop": "off",
      "no-console": "off",
      "import/no-extraneous-dependencies": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "off",
      "no-constant-condition": "off",
      "require-yield": "off",
    },
  },
  // Examples
  {
    files: ["examples/**/*", "packages/*/examples/**/*"],
    rules: {
      "import/no-extraneous-dependencies": "off",
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-constant-condition": "off",
      "default-case": "off",
      "no-new-func": "off",
      "no-useless-escape": "off",
      "no-case-declarations": "off",
      "require-yield": "off",
    },
  },
  // Prettier - must be last to override other configs
  prettierConfig,
];
