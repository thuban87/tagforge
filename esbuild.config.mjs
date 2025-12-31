import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

// Use environment variable for deploy path, or fall back to local main.js
// Set OBSIDIAN_PLUGIN_PATH environment variable to deploy directly to your vault
const outfile = process.env.OBSIDIAN_PLUGIN_PATH
  ? `${process.env.OBSIDIAN_PLUGIN_PATH}/main.js`
  : "G:/My Drive/IT/Obsidian Vault/My Notebooks/.obsidian/plugins/tagforge/main.js";

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
