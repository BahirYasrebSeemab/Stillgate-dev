import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Builds the React UI into dist/renderer. "@stillgate/shared" points at its TypeScript source,
// so Vite bundles it as modern ESM (its dist/ is CommonJS, made for Node).
// Strict Content-Security-Policy for the BUILT page only: our own files, nothing else.
// (The dev server needs inline scripts for hot reload, so it is not applied there.)
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function contentSecurityPolicy(): Plugin {
  return {
    name: "stillgate-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./", // relative asset paths, needed when Electron loads the page from a file
  plugins: [react(), contentSecurityPolicy()],
  resolve: {
    alias: { "@stillgate/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) },
  },
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
