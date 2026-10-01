import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Builds the kiosk UI into dist/renderer (see the manager's vite.config.mts for the reasoning).
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function contentSecurityPolicy(): Plugin {
  return {
    name: "asd-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), contentSecurityPolicy()],
  resolve: {
    alias: { "@asd/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) },
  },
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
  server: { port: 5174, strictPort: true },
});
