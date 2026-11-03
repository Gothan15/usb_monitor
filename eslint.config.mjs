import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next 16: eslint-config-next ya trae configuración flat nativa;
// el FlatCompat anterior dejó de funcionar.
const eslintConfig = [
  {
    // Artefactos generados y binarios: fuera del lint (sin esto,
    // `eslint .` tras un build reportaba miles de errores de .next).
    ignores: [
      ".next/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "next-env.d.ts",
      "src/generated/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // TypeScript
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/prefer-as-const": "off",

      // React
      "react-hooks/exhaustive-deps": "off",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "react/prop-types": "off",

      // Next.js
      "@next/next/no-img-element": "off",
      "@next/next/no-html-link-for-pages": "off",

      // JavaScript general
      "prefer-const": "off",
      "no-unused-vars": "off",
      "no-console": "off",
      "no-debugger": "off",
      "no-empty": "off",
      "no-irregular-whitespace": "off",
      "no-case-declarations": "off",
      "no-fallthrough": "off",
      "no-mixed-spaces-and-tabs": "off",
      "no-redeclare": "off",
      "no-undef": "off",
      "no-unreachable": "off",
      "no-useless-escape": "off",
    },
  },
];

export default eslintConfig;
