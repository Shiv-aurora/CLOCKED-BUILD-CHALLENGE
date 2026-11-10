// Builds dist-artifact/vitalswitch.html: one self-contained page (inlined JS + CSS) for static hosting.
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("dist-artifact", { recursive: true });
execSync("npx tailwindcss -i app/globals.css -o dist-artifact/app.css --minify", { stdio: "inherit" });
const res = await build({
  entryPoints: ["artifact/main.tsx"],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "error",
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("dist-artifact/app.css", "utf8");
const html = `<title>VitalSwitch</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap">
<style>
:root{--font-sans:'Inter',system-ui,-apple-system,sans-serif;--font-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;color-scheme:dark}
${css}
body{background:#05070d;color:#e6ebf5}
@media (prefers-reduced-motion: reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important}}
</style>
<div id="root"></div>
<script>${js}</script>
`;
writeFileSync("dist-artifact/vitalswitch.html", html);
console.log("dist-artifact/vitalswitch.html", (html.length / 1024).toFixed(0), "KB");
