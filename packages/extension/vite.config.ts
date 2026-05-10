/**
 * Vite config that produces a Chrome-loadable Manifest V3 bundle.
 *
 * The MV3 platform has three independently-loaded JS contexts: the
 * service worker (background), the content script, and the popup. They
 * can't share a Rollup chunk graph the way a single SPA can, so we run
 * Vite once with three separate `input` entries and force `inlineDynamicImports`.
 *
 * `manifest.json` and `popup/index.html` are copied verbatim from `src/`
 * to `dist/` by the `copy-manifest` plugin below; the manifest's `js`
 * fields then resolve against the flat `dist/` layout that
 * `chrome://extensions → Load unpacked` expects.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "src");
const OUT = resolve(__dirname, "dist");

/**
 * Copy `manifest.json` to dist/ and rewrite the popup HTML so its script
 * src points at `popup.js` (the bundled, no-extension form Vite emits).
 */
function copyExtensionAssets(): Plugin {
  return {
    name: "passman-extension-assets",
    apply: "build",
    closeBundle() {
      if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

      // 1. manifest.json — straight copy, no transform.
      copyFileSync(
        resolve(__dirname, "manifest.json"),
        resolve(OUT, "manifest.json"),
      );

      // 2. popup/index.html — rewrite the module script src to the bundled
      //    `popup.js` that Vite produced (which lives at the dist root).
      const popupSrc = readFileSync(resolve(SRC, "popup/index.html"), "utf8");
      const popupOut = popupSrc.replace(
        /src="\.\/popup\.ts"/,
        'src="./popup.js"',
      );
      writeFileSync(resolve(OUT, "popup.html"), popupOut);
    },
  };
}

export default defineConfig({
  publicDir: false,
  build: {
    outDir: OUT,
    emptyOutDir: true,
    target: "esnext",
    sourcemap: true,
    minify: false,
    // Chrome extension contexts can't share a runtime, so each entry is
    // bundled independently with its dynamic imports inlined.
    rollupOptions: {
      input: {
        background: resolve(SRC, "background.ts"),
        content: resolve(SRC, "content.ts"),
        popup: resolve(SRC, "popup/popup.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
        format: "es",
        inlineDynamicImports: false,
        manualChunks: undefined,
      },
      preserveEntrySignatures: false,
    },
  },
  plugins: [copyExtensionAssets()],
});
