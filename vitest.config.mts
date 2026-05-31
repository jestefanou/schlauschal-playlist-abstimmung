import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest-Config. `.mts` = ESM+TS, unabhängig von package.json "type".
//
// Alias-Auflösung @/* -> ./src über einen expliziten, importer-unabhängigen Alias.
// Bewusst KEIN vite-tsconfig-paths: das greift nur für Importer im tsconfig-`include`,
// Testdateien sind dort aber ausgeschlossen (sonst typecheckt `next build` sie mit) —
// dann träfe `vi.mock("@/lib/...")` einen anderen Modulpfad als der Import in der
// getesteten Quelle und der Mock liefe ins Leere. Der RegExp matcht NUR "@/..."
// (nicht "@supabase/..."). Spiegelt die einzige tsconfig-Path-Mapping-Regel wider.
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)/, replacement: `${srcDir}/$1` }],
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["src/**/*.{test,spec}.tsx", "e2e/**", "supabase/**", "node_modules/**"],
  },
});
