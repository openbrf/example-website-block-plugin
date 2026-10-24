import {
  PLUGIN_BLOCK_ATTRIBUTES,
  PLUGIN_BLOCK_ELEMENTS,
  type PluginBlockContent,
  type PluginBlockNode,
} from "@openbrf/plugin-sdk";
import { describe, expect, it } from "vitest";
import { readOpeningHours, readTime, renderOpeningHours } from "../src/server";
import { renderContext } from "./fake-host";

function render(
  settings: Record<string, unknown>,
  locale: "sv" | "en" = "sv",
): PluginBlockContent {
  const context = renderContext(locale, settings as never);
  return renderOpeningHours(readOpeningHours(context.settings), context);
}

/** Every element and attribute in a rendered tree that the host would drop. */
function dropped(content: PluginBlockContent): string[] {
  const problems: string[] = [];
  const visit = (node: PluginBlockNode): void => {
    if (typeof node === "string") {
      return;
    }
    if (!(PLUGIN_BLOCK_ELEMENTS as readonly string[]).includes(node.tag)) {
      problems.push(`element ${node.tag}`);
    }
    const allowed = PLUGIN_BLOCK_ATTRIBUTES[node.tag] ?? [];
    for (const name of Object.keys(node.attributes ?? {})) {
      if (!allowed.includes(name)) {
        problems.push(`attribute ${name} on ${node.tag}`);
      }
    }
    node.children?.forEach(visit);
  };
  if (content !== null && content !== undefined) {
    (Array.isArray(content) ? content : [content]).forEach(visit);
  }
  return problems;
}

describe("the opening hours block", () => {
  it("renders the heading, the hours and the note in Swedish", () => {
    expect(
      render({
        heading: "Tvättstugan",
        opens: "07:00",
        closes: "22:00",
        note: "Stängt på midsommarafton.",
      }),
    ).toEqual({
      tag: "section",
      children: [
        { tag: "h2", children: ["Tvättstugan"] },
        {
          tag: "dl",
          children: [
            { tag: "dt", children: ["Öppet"] },
            {
              tag: "dd",
              children: [
                {
                  tag: "time",
                  attributes: { dateTime: "07:00" },
                  children: ["07.00"],
                },
                "–",
                {
                  tag: "time",
                  attributes: { dateTime: "22:00" },
                  children: ["22.00"],
                },
              ],
            },
          ],
        },
        { tag: "p", children: ["Stängt på midsommarafton."] },
      ],
    });
  });

  it("renders in English with English labels and times", () => {
    expect(
      render({ heading: "", opens: "7", closes: "22.30", note: "" }, "en"),
    ).toEqual({
      tag: "section",
      children: [
        { tag: "h2", children: ["Opening hours"] },
        {
          tag: "dl",
          children: [
            { tag: "dt", children: ["Open"] },
            {
              tag: "dd",
              children: [
                {
                  tag: "time",
                  attributes: { dateTime: "07:00" },
                  children: ["07:00"],
                },
                "–",
                {
                  tag: "time",
                  attributes: { dateTime: "22:30" },
                  children: ["22:30"],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("uses its own heading when the board leaves the heading empty or blank", () => {
    for (const heading of ["", "   ", undefined]) {
      expect(render({ heading, opens: "8", closes: "20" })).toEqual({
        tag: "section",
        children: [
          { tag: "h2", children: ["Öppettider"] },
          {
            tag: "dl",
            children: [
              { tag: "dt", children: ["Öppet"] },
              {
                tag: "dd",
                children: [
                  {
                    tag: "time",
                    attributes: { dateTime: "08:00" },
                    children: ["08.00"],
                  },
                  "–",
                  {
                    tag: "time",
                    attributes: { dateTime: "20:00" },
                    children: ["20.00"],
                  },
                ],
              },
            ],
          },
        ],
      });
    }
  });

  it("renders nothing when the settings are missing", () => {
    expect(render({})).toBeNull();
  });

  it("renders nothing when every setting is empty or only whitespace", () => {
    expect(render({ heading: "", opens: "", closes: "", note: "" })).toBeNull();
    expect(
      render({ heading: "Bastun", opens: " ", closes: "\t", note: "  " }),
    ).toBeNull();
  });

  it("leaves the hours out when only one time is given, and keeps the note", () => {
    expect(
      render({
        heading: "Bastun",
        opens: "18:00",
        closes: "",
        note: "Boka i appen.",
      }),
    ).toEqual({
      tag: "section",
      children: [
        { tag: "h2", children: ["Bastun"] },
        { tag: "p", children: ["Boka i appen."] },
      ],
    });
  });

  it("renders nothing when a heading is all there is", () => {
    expect(render({ heading: "Bastun" })).toBeNull();
  });

  it("leaves the hours out when a time is not a time", () => {
    for (const opens of ["25:00", "7:5", "kl 7", "07:60", "24:30", "-1", 7]) {
      expect(render({ opens, closes: "22:00", note: "Se anslaget." })).toEqual({
        tag: "section",
        children: [
          { tag: "h2", children: ["Öppettider"] },
          { tag: "p", children: ["Se anslaget."] },
        ],
      });
    }
  });

  it("closes at midnight as 24.00, with a time of day a machine can read", () => {
    expect(render({ opens: "6", closes: "24:00" })).toEqual({
      tag: "section",
      children: [
        { tag: "h2", children: ["Öppettider"] },
        {
          tag: "dl",
          children: [
            { tag: "dt", children: ["Öppet"] },
            {
              tag: "dd",
              children: [
                {
                  tag: "time",
                  attributes: { dateTime: "06:00" },
                  children: ["06.00"],
                },
                "–",
                {
                  tag: "time",
                  attributes: { dateTime: "00:00" },
                  children: ["24.00"],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("keeps the note as text, for the host to escape", () => {
    expect(
      render({ opens: "8", closes: "9", note: "<script>alert(1)</script>" }),
    ).toEqual({
      tag: "section",
      children: [
        { tag: "h2", children: ["Öppettider"] },
        {
          tag: "dl",
          children: [
            { tag: "dt", children: ["Öppet"] },
            {
              tag: "dd",
              children: [
                {
                  tag: "time",
                  attributes: { dateTime: "08:00" },
                  children: ["08.00"],
                },
                "–",
                {
                  tag: "time",
                  attributes: { dateTime: "09:00" },
                  children: ["09.00"],
                },
              ],
            },
          ],
        },
        { tag: "p", children: ["<script>alert(1)</script>"] },
      ],
    });
  });

  it("uses only elements and attributes the host keeps, and copies through JSON", () => {
    const content = render({
      heading: "Tvättstugan",
      opens: "07:00",
      closes: "24",
      note: "Stängt på helgdagar.",
    });

    expect(dropped(content)).toEqual([]);
    expect(JSON.parse(JSON.stringify(content))).toEqual(content);
  });
});

describe("readTime", () => {
  it.each([
    ["07:00", "07:00"],
    ["7:00", "07:00"],
    ["07.00", "07:00"],
    ["7", "07:00"],
    [" 22:30 ", "22:30"],
    ["0", "00:00"],
    ["24", "24:00"],
    ["24.00", "24:00"],
  ])("reads %j as %s", (value, time) => {
    expect(readTime(value)).toBe(time);
  });

  it.each<unknown>([
    "",
    "  ",
    "25",
    "12:5",
    "12:345",
    "1:00:00",
    "noon",
    null,
    7,
  ])("reads %j as no time", (value) => {
    expect(readTime(value)).toBeNull();
  });
});
