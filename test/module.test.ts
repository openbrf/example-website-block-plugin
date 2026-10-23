import "reflect-metadata";
import { createRequire } from "node:module";
import type { DynamicModule } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import type * as Server from "../src/server";
import { fakeHost, renderContext } from "./fake-host";

/**
 * The server bundle as it ships, built into a NestJS application.
 *
 * `dist/server.cjs` rather than the source: what an instance loads is the
 * compiled file, and building it into a real module is what proves it loads.
 */
const { createPlugin } = createRequire(import.meta.url)(
  "../dist/server.cjs",
) as typeof Server;

async function start(host = fakeHost()) {
  const module = (await createPlugin(host)) as DynamicModule;
  const testing = await Test.createTestingModule({
    imports: [module],
  }).compile();
  await testing.init();
  return { host, module, testing };
}

describe("the server bundle", () => {
  it("is a dynamic module with no controller, no provider and nothing global", async () => {
    const { module, testing } = await start();

    expect(module.global).toBeUndefined();
    expect(module.controllers).toBeUndefined();
    expect(module.providers).toBeUndefined();
    expect(module.imports).toBeUndefined();
    await testing.close();
  });

  it("registers the block its manifest declares, from the module factory", async () => {
    const host = fakeHost();
    await createPlugin(host);

    expect(host.registrations.map((registration) => registration.name)).toEqual(
      ["openingHours"],
    );
  });

  it("renders through the registered function as the host calls it", async () => {
    const host = fakeHost();
    await createPlugin(host);
    const [block] = host.registrations;

    const content = await block?.render(
      renderContext("en", {
        heading: "Laundry room",
        opens: "07:00",
        closes: "22:00",
        note: "",
      }),
    );
    expect(content).toMatchObject({
      tag: "section",
      children: [{ tag: "h2", children: ["Laundry room"] }, { tag: "dl" }],
    });
    expect(await block?.render(renderContext("sv", {}))).toBeNull();
  });

  it("loads on a host older than host.blocks, without the block, and says so", async () => {
    const { host, testing } = await start(fakeHost({ withBlocks: false }));

    expect(host.registrations).toEqual([]);
    expect(host.logged).toEqual([
      "This instance cannot render a plugin's website block, so the opening hours block is not offered.",
    ]);
    await testing.close();
  });
});
