import * as esbuild from "esbuild";
import { rmSync, mkdirSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

// ESM build - react/react-dom stay external, consumer supplies them.
await esbuild.build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.esm.js",
    bundle: true,
    format: "esm",
    platform: "browser",
    external: ["react", "react-dom", "react/jsx-runtime"],
    sourcemap: true,
});

// Browser global build - react/react-dom bundled in, so preview.html (and
// any other static page) can use this with a single <script> tag and no
// package manager. Exposes window.KitchenDS. Built from browser-entry.ts
// (not index.ts) so this global also carries React/ReactDOM themselves -
// vanilla consumers like script.js/status-badge.js need those to mount.
await esbuild.build({
    entryPoints: ["src/browser-entry.ts"],
    outfile: "dist/index.global.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    globalName: "KitchenDS",
    sourcemap: true,
});

console.log(
    "esbuild: wrote dist/index.esm.{js,css} and dist/index.global.{js,css}"
);
