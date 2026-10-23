import { readFileSync } from "node:fs";
import type {
  PluginBlockRegistration,
  PluginBlockRenderContext,
  PluginHost,
} from "@openbrf/plugin-sdk";

/**
 * A host object for the tests.
 *
 * Only the members this plugin uses answer: its id, its permissions, the
 * logger and `blocks`. Reading any other throws, so a test fails the moment the
 * plugin reaches for a service its manifest did not ask for.
 */

export interface FakeHost extends PluginHost {
  registrations: PluginBlockRegistration[];
  logged: string[];
}

export function fakeHost(options: { withBlocks?: boolean } = {}): FakeHost {
  const registrations: PluginBlockRegistration[] = [];
  const logged: string[] = [];

  const provided: Record<string, unknown> = {
    id: "opening-hours",
    permissions: ["site:blocks"],
    registrations,
    logged,
    logger: {
      debug: (message: string) => logged.push(message),
      info: (message: string) => logged.push(message),
      warn: (message: string) => logged.push(message),
      error: (message: string) => logged.push(message),
    },
    // An instance older than `host.blocks` has no such member at all.
    blocks:
      options.withBlocks === false
        ? undefined
        : {
            register: (registration: PluginBlockRegistration) => {
              registrations.push(registration);
            },
          },
  };

  return new Proxy(provided, {
    get(target, property) {
      if (typeof property === "symbol" || property in target) {
        return target[property as string];
      }
      throw new Error(`The test host does not provide ${property}.`);
    },
  }) as unknown as FakeHost;
}

const locales = {
  sv: JSON.parse(readFileSync("locales/sv.json", "utf8")) as Record<
    string,
    string
  >,
  en: JSON.parse(readFileSync("locales/en.json", "utf8")) as Record<
    string,
    string
  >,
};

/**
 * What the host hands a render function, with `t` reading the plugin's own
 * locale files as the host's does. A key the files lack comes back as the key,
 * which is what a reader would see.
 */
export function renderContext(
  locale: "sv" | "en",
  settings: PluginBlockRenderContext["settings"],
): PluginBlockRenderContext {
  return {
    type: "opening-hours/openingHours",
    settings,
    locale,
    t: (key, values = {}) =>
      (locales[locale][key] ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_, name: string) => String(values[name] ?? ""),
      ),
    signal: new AbortController().signal,
  };
}
