import { type DynamicModule, Module } from "@nestjs/common";
import type {
  PluginBlockContent,
  PluginBlockNode,
  PluginBlockRenderContext,
  PluginHost,
  PluginModuleFactory,
  PluginSettingsValues,
} from "@openbrf/plugin-sdk";

/**
 * The plugin's server entry point.
 *
 * This plugin adds one block to the association's website and does nothing
 * else: no routes, no view, no register reads. The manifest declares the block
 * and the settings the board fills in on it; this file registers the function
 * that renders it. The host offers the block in the page editor, holds every
 * save to the declared settings, calls the render function while it renders a
 * page, and prints what it answers through its own short list of elements. No
 * script reaches the visitor's browser.
 *
 * Three rules shape this file, and each comes from the plugin contract:
 *
 * - It is the whole server. The host requires one CommonJS bundle that
 *   requires nothing but the host's packages and Node's built-in modules, so a
 *   helper in a second source file would be a relative require the package
 *   check refuses.
 * - `@openbrf/plugin-sdk` is imported for types only. It is a build-time
 *   dependency and cannot be resolved from an installed plugin's directory;
 *   everything the plugin uses at runtime arrives on the host object.
 * - NestJS is imported for values and resolves to the host's own copy, which
 *   the host puts on the module path. It is a peer dependency and is never
 *   bundled: a second NestJS is a second, disconnected container.
 */

/** The block's name, as the manifest declares it. */
export const BLOCK_NAME = "openingHours";

/** What the block shows, read from the settings the host stored. */
export interface OpeningHours {
  /** Empty means the block's own translated heading. */
  heading: string;
  /** `HH:MM`, or null when the board left it empty or wrote no time. */
  opens: string | null;
  closes: string | null;
  note: string;
}

/**
 * A time as the board may write it: `7`, `07`, `7.00`, `07:00` and so on, up
 * to `24:00` for a place that closes at midnight.
 *
 * A text field is the declaration's only way to ask for a time, and the host
 * holds it to its length alone, so the shape is checked here.
 */
const TIME = /^(\d{1,2})(?:[:.](\d{2}))?$/;

/** Reads one time into `HH:MM`, or null when the value is not a time. */
export function readTime(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = TIME.exec(value.trim());
  if (match === null) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) {
    return null;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reads the block's settings into the shape it renders.
 *
 * The host validates them against the declaration and applies its defaults
 * before the render function sees them, so every key is a string here. They
 * are read defensively all the same: a page stored before a field existed
 * holds no value for it, and a block that cannot read its settings shows
 * nothing rather than failing.
 */
export function readOpeningHours(settings: PluginSettingsValues): OpeningHours {
  return {
    heading: readText(settings.heading),
    opens: readTime(settings.opens),
    closes: readTime(settings.closes),
    note: readText(settings.note),
  };
}

/**
 * A time for the reader: `07.00` in Swedish, as Swedish writes it, and
 * `07:00` in English.
 */
function shownTime(time: string, locale: string): string {
  return locale === "sv" ? time.replace(":", ".") : time;
}

/**
 * A `time` element. Its `dateTime` is what a machine reads, and a valid time
 * of day has no hour 24, so midnight at closing is `00:00` there.
 */
function timeElement(time: string, locale: string): PluginBlockNode {
  return {
    tag: "time",
    attributes: { dateTime: time === "24:00" ? "00:00" : time },
    children: [shownTime(time, locale)],
  };
}

/**
 * Renders the block: a heading, the hours, and the board's note.
 *
 * Pure, so the tests hold its output to what the host prints. The hours are
 * shown only when both times are; one time alone says nothing a visitor can
 * use. With neither hours nor a note there is nothing to say, and the block
 * renders nothing, which leaves the page as if it held no block.
 */
export function renderOpeningHours(
  hours: OpeningHours,
  { t, locale }: Pick<PluginBlockRenderContext, "t" | "locale">,
): PluginBlockContent {
  const hasHours = hours.opens !== null && hours.closes !== null;
  if (!hasHours && hours.note === "") {
    return null;
  }

  const children: PluginBlockNode[] = [
    {
      tag: "h2",
      children: [
        hours.heading === "" ? t("blocks.openingHours.heading") : hours.heading,
      ],
    },
  ];
  if (hours.opens !== null && hours.closes !== null) {
    children.push({
      tag: "dl",
      children: [
        { tag: "dt", children: [t("blocks.openingHours.open")] },
        {
          tag: "dd",
          children: [
            timeElement(hours.opens, locale),
            "–",
            timeElement(hours.closes, locale),
          ],
        },
      ],
    });
  }
  if (hours.note !== "") {
    // Text, never markup: the host escapes it as it prints it.
    children.push({ tag: "p", children: [hours.note] });
  }
  return { tag: "section", children };
}

/**
 * Builds the plugin's module.
 *
 * Named `createPlugin` because that is the export the host looks for. The
 * block is registered from here, because the host reads the registrations
 * once, while the application starts.
 */
export const createPlugin: PluginModuleFactory = (
  host: PluginHost,
): DynamicModule => {
  /*
   * `host.blocks` arrived after the first hosts of this contract version
   * shipped. A host without it cannot render a plugin's block at all, so the
   * plugin says so and does without.
   */
  if (host.blocks === undefined) {
    host.logger.warn(
      "This instance cannot render a plugin's website block, so the opening hours block is not offered.",
    );
  } else {
    host.blocks.register({
      name: BLOCK_NAME,
      render: ({ settings, t, locale }) =>
        renderOpeningHours(readOpeningHours(settings), { t, locale }),
    });
  }

  /** Empty: the block is all this plugin adds, and it needs no provider. */
  @Module({})
  class OpeningHoursModule {}

  return { module: OpeningHoursModule };
};
