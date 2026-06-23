import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 외부/3rd-party 모듈 및 정적 자산 - lint 대상 아님
    "QCAD_modules/**",
    "geoserver_modules/**",
    "public/**",
    "python/**",
    "111_extracted/**",
    "node_modules/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
