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
  outdir: "dist-artifact/tmp",
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "error",
});
const js = res.outputFiles.find((f) => f.path.endsWith(".js")).text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("node_modules/driver.js/dist/driver.css", "utf8") + "\n" + readFileSync("dist-artifact/app.css", "utf8");
const html = `<title>VitalSwitch</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap">
<style>
:root{--font-sans:'Geist',system-ui,-apple-system,sans-serif;--font-mono:'Geist Mono',ui-monospace,SFMono-Regular,monospace}
${css}
</style>
<div id="root"></div>
<script>${js}</script>
`;
writeFileSync("dist-artifact/vitalswitch.html", html);
console.log("dist-artifact/vitalswitch.html", (html.length / 1024).toFixed(0), "KB");
