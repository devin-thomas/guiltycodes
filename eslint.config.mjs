// ESLint gate for owned TypeScript; tsc --noEmit and tools/check-style.ts are separate gates.
import tseslint from "typescript-eslint";

/** @typedef {import("typescript-eslint").ConfigArray} ConfigArray */
/** @typedef {ConfigArray[number]} Config */

/** @type {ConfigArray} */
let config = tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  ...tseslint.configs.recommendedTypeChecked.map(/** @type {(preset: Config) => Config} */ (preset) => ({ ...preset, files: ["**/*.ts"] })),
  {
    files: ["**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "prefer-const": "off",
      "@typescript-eslint/prefer-as-const": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: false, allowTypedFunctionExpressions: false }],
      "@typescript-eslint/typedef": [
        "error",
        { variableDeclaration: true, parameter: true, arrowParameter: true, propertyDeclaration: true },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      // node:test owns the promise each test() call returns and reports its failure.
      "@typescript-eslint/no-floating-promises": [
        "error",
        { ignoreVoid: false, allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test"] }] },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
    },
  },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
);

export default config;
