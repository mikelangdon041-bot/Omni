// Put the finished installer somewhere a person would look.
//
// Tauri leaves it at desktop/src-tauri/target/release/bundle/nsis/, five
// levels down in a build tree, under a name with a version and an
// architecture in it. This copies it to the top of the repo as
// "Install Omni Recorder.exe", which is the file you actually double-click.

import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "..", "src-tauri", "target", "release", "bundle", "nsis");
const destination = join(here, "..", "..", "Install Omni Recorder.exe");

let built;
try {
  built = readdirSync(bundle).find((name) => name.endsWith("-setup.exe"));
} catch {
  console.error(`No bundle at ${bundle}. Run "npx tauri build" first.`);
  process.exit(1);
}
if (!built) {
  console.error(`No installer in ${bundle}.`);
  process.exit(1);
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(join(bundle, built), destination);
console.log(`Installer copied to ${destination}`);
