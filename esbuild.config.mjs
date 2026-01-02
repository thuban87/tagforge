import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";

// Use environment variable for deploy path, or fall back to local main.js
// Set OBSIDIAN_PLUGIN_PATH environment variable to deploy directly to your vault
const deployPath = process.env.OBSIDIAN_PLUGIN_PATH
  ? process.env.OBSIDIAN_PLUGIN_PATH
  : "G:/My Drive/IT/Obsidian Vault/My Notebooks/.obsidian/plugins/tagforge";

const outfile = `${deployPath}/main.js`;

// Copy static files to deploy folder
function copyStaticFiles() {
  const files = ["styles.css", "manifest.json"];
  for (const file of files) {
    const src = `./${file}`;
    const dest = `${deployPath}/${file}`;
    try {
      fs.copyFileSync(src, dest);
      console.log(`Copied ${file} to ${dest}`);
    } catch (e) {
      console.error(`Failed to copy ${file}:`, e.message);
    }
  }
}

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "fs", "path"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile,
});

if (prod) {
  await context.rebuild();
  copyStaticFiles();
  process.exit(0);
} else {
  await context.watch();
  copyStaticFiles();
}
