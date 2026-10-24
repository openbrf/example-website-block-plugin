// The checks the catalog runs on a plugin's tarball, run on this one.
//
//   node scripts/check-package.mjs                 packs the package and checks it
//   node scripts/check-package.mjs <file>.tgz      checks a tarball already packed
//
// The tarball is read the way the catalog reads it: with `readThemeArchive`
// from @openbrf/theme-tools, which holds it to the limits an instance applies
// to an archive (files and directories only, at most 200 of each, no file over
// 4 MiB, 8 MiB in all, short relative paths), and then with
// `pluginPackageProblems` from @openbrf/plugin-sdk, which says whether the
// package installs and loads: the manifest, no runtime dependencies, the
// declared entries present, a server bundle requiring only the host's packages
// and Node's built-ins, and two locale files with the same keys.
//
// The release workflow runs it on the very file it then attests and uploads.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePluginPackage, pluginPackageProblems } from "@openbrf/plugin-sdk";
import { readThemeArchive } from "@openbrf/theme-tools";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const text = new TextDecoder("utf8");

/** Every sentence the catalog would refuse this tarball with; none when it passes. */
export function tarballProblems(bytes) {
  let files;
  try {
    files = readThemeArchive(bytes);
  } catch (error) {
    return [`the tarball is not a readable package: ${error.message}`];
  }

  const json = (path) => {
    const file = files.get(path);
    if (file === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(text.decode(file));
    } catch {
      return undefined;
    }
  };

  const packageJson = json("package.json");
  if (packageJson === undefined) {
    return ["the package has no readable package.json."];
  }

  const parsed = parsePluginPackage(packageJson);
  const server = parsed.ok
    ? files.get((parsed.value.openbrf.entry.server ?? "").replace(/^\.\//, ""))
    : undefined;

  return pluginPackageProblems({
    packageJson,
    files: [...files.keys()],
    serverBundle: server === undefined ? null : text.decode(server),
    locales: { sv: json("locales/sv.json"), en: json("locales/en.json") },
  });
}

/** Packs the package as `npm pack` would publish it, and returns the tarball's bytes. */
export function packTarball() {
  const destination = mkdtempSync(join(tmpdir(), "opening-hours-pack-"));
  try {
    const [packed] = JSON.parse(
      execFileSync(
        "npm",
        [
          "pack",
          "--json",
          "--silent",
          "--ignore-scripts",
          "--pack-destination",
          destination,
        ],
        { cwd: root, encoding: "utf8" },
      ),
    );
    return readFileSync(join(destination, packed.filename));
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const file = process.argv[2];
  const bytes = file === undefined ? packTarball() : readFileSync(file);
  const problems = tarballProblems(new Uint8Array(bytes));
  if (problems.length > 0) {
    console.error(
      `The package fails the catalog's checks:\n  ${problems.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log(
    `${file ?? "The packed package"} passes the catalog's package checks.`,
  );
}
