import { readFileSync } from "node:fs";
import { parsePluginPackage } from "@openbrf/plugin-sdk";
import { readThemeArchive } from "@openbrf/theme-tools";
import { describe, expect, it } from "vitest";
import { packTarball, tarballProblems } from "../scripts/check-package.mjs";

const packageJson: unknown = JSON.parse(readFileSync("package.json", "utf8"));

describe("the packed package", () => {
  const bytes = new Uint8Array(packTarball());

  it("passes the checks the catalog runs before it lists a plugin", () => {
    expect(tarballProblems(bytes)).toEqual([]);
  });

  it("holds the server bundle and the locales, and none of the sources or tests", () => {
    const files = [...readThemeArchive(bytes).keys()];

    expect(files.sort()).toEqual([
      "LICENSE",
      "README.md",
      "dist/server.cjs",
      "locales/en.json",
      "locales/sv.json",
      "package.json",
    ]);
  });
});

describe("the manifest", () => {
  const parsed = parsePluginPackage(packageJson);

  it("is one an instance accepts", () => {
    expect(parsed.ok).toBe(true);
  });

  it("asks for site:blocks and nothing else, and declares no personal data", () => {
    expect(parsed.ok && parsed.value.openbrf.permissions).toEqual([
      "site:blocks",
    ]);
    expect(parsed.ok && parsed.value.openbrf.personalData).toEqual([]);
  });

  it("would be refused beside a permission that reads the register, which is why this is a plugin of its own", () => {
    const manifest = packageJson as { openbrf: { permissions: string[] } };
    const reading = {
      ...manifest,
      openbrf: {
        ...manifest.openbrf,
        permissions: [...manifest.openbrf.permissions, "addressBook:read"],
      },
    };

    expect(parsePluginPackage(reading).ok).toBe(false);
  });

  it("declares no runtime dependencies, only the host package it shares as a peer", () => {
    const manifest = packageJson as Record<string, unknown>;
    expect(manifest.dependencies).toBeUndefined();
    expect(Object.keys(manifest.peerDependencies as object)).toEqual([
      "@nestjs/common",
    ]);
  });
});
