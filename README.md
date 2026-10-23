# example-website-block-plugin

A reference [Open BRF](https://github.com/openbrf/openbrf) plugin that adds a
block to the association's website. A housing cooperative can install it from
the catalog, and a plugin author can start from it. It is built only against
the published plugin contract,
[`@openbrf/plugin-sdk`](https://www.npmjs.com/package/@openbrf/plugin-sdk), the
same way any third-party plugin is.

## What it does

It adds one block, **Öppettider** (Opening hours), which the board can put on
any page of the website from the page editor. The board fills in four things
on each block:

- a heading, for example "Tvättstugan" (the laundry room). Left empty, the
  block's own heading "Öppettider" is used;
- when it opens and when it closes, written as `07.00`, `07:00` or `7`, up to
  `24.00`;
- a note shown under the hours, for example that it is closed on public
  holidays.

The block shows the hours only when both times are filled in and are times.
With no hours and no note there is nothing to say, so the block renders
nothing and the page reads as if it held no block. Times are written the
Swedish way (`07.00`) on a Swedish page and as `07:00` on an English one, and
each is marked up as a `time` element a machine can read.

## Why it is a plugin of its own

The [reference plugin](https://github.com/openbrf/example-plugin) reads the
register to count residents, so it asks for `addressBook:read`. The plugin
contract refuses `site:blocks` beside `addressBook:read`,
`addressBook:readContact` or `finances:read`: what a block renders is
published to anyone who visits the website, and the website's promise that it
cannot publish a resident's details rests on there being no path from a block
to the register. A plugin that reads the register and wants a website block is
therefore two plugins, and this is the second one. The test
[`test/package.test.ts`](test/package.test.ts) shows the manifest being
refused once `addressBook:read` is added to it.

## What it asks for, and why

| Declaration        | Value          | Why                                                                                                                      |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Permission         | `site:blocks`  | To add a block to the association's website. Nothing else: no register, no mail, no jobs.                                |
| Personal data      | none           | The block prints what the board writes on it and nothing more. It reads no person, and nothing leaves the instance.      |
| Block              | `openingHours` | Declared with its four settings, so the page editor draws the form and the host validates every save against it.         |
| Protected resource | none           | An instance has only one OAuth protected resource. A plugin holding it would keep a real connector from being installed. |

Whatever the board writes on a block is published to anyone, account or not.
The host scans every string in a block's settings for a personal identity
number before the page is published, and leaves out a block whose rendered
output holds one.

## How a plugin adds a website block

The [website blocks](https://github.com/openbrf/openbrf/blob/main/docs/plugin-contract.md#website-blocks)
section of the plugin contract is the reference. In short:

1. Ask for `site:blocks` in the manifest, and for no permission that reads the
   register or the finances.
2. Declare each block under `openbrf.blocks` in [`package.json`](package.json):
   a lowerCamelCase `name`, a `labelKey` for its name in the editor, an
   optional `icon` and `category`, and a `settingsSchema` with the settings the
   board fills in. A block's settings may not hold a secret field, because
   they are published with the page. The page stores the block under the type
   `<plugin id>/<name>`, here `opening-hours/openingHours`.
3. Register a render function for each declared block with
   `host.blocks.register` from the module factory, after checking that
   `host.blocks` exists, because an older host does not have it.
4. Return a tree of elements, not HTML. The host copies it through JSON,
   keeps only a short list of text, table and link elements and the `href`,
   `dateTime` and `scope` attributes, escapes every string and prints the
   rest. Nothing a plugin returns can load or run anything in the visitor's
   browser. A render that throws, takes longer than 2 seconds or answers with
   too much hides its own block, never the page.

The render function is told the block's settings, already validated with the
declared defaults applied, the page's `locale`, a translation function `t` in
the plugin's own namespace, and an abort `signal`. It is told nothing about
the reader: one stored page is rendered alike for a visitor with no account
and for a member.

## Where each part of the contract is

| Part          | Here                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest      | The `openbrf` field of [`package.json`](package.json): id, server entry, the permission, no personal data, and the block with its settings.                                        |
| Server entry  | [`src/server.ts`](src/server.ts), compiled by `tsc` to `dist/server.cjs`: one CommonJS file that requires only `@nestjs/common`, which resolves to the host's own copy.            |
| NestJS module | An empty module. The block is all this plugin adds, and it needs no route, provider or view.                                                                                       |
| Block         | Registered from the module factory with `host.blocks.register`. The render function is pure: it reads the settings and returns a tree of elements.                                 |
| Translations  | [`locales/sv.json`](locales/sv.json) and [`locales/en.json`](locales/en.json), merged by the host under the `plugin-opening-hours` namespace, for the editor and the render alike. |
| Package check | [`scripts/check-package.mjs`](scripts/check-package.mjs) reads the packed tarball the way the catalog does and runs `pluginPackageProblems` on it.                                 |
| Release       | [`.github/workflows/release.yml`](.github/workflows/release.yml): on a `v<version>` tag it packs the tarball once, checks it, attests it and publishes it on a release.            |

## Building and testing

You need Node 26 and pnpm (`npm i -g pnpm`). Any recent pnpm switches itself to
the version pinned in `package.json` inside this repository.

```sh
pnpm install
pnpm typecheck
pnpm test            # builds dist/, then runs the tests
pnpm check:package   # packs the package and runs the catalog's checks on it
```

The tests cover four things:

- the render output, in Swedish and English, for full settings, missing and
  empty settings, settings of only whitespace, one time alone and times that
  are not times, held to the elements and attributes the host keeps;
- the built `dist/server.cjs` in a NestJS testing module, registering the
  block on a host that has `host.blocks` and loading without it on one that
  does not;
- the packed tarball, against the catalog's checks, and the manifest, which is
  refused once a permission that reads the register is added;
- the locale files, against every key the manifest and the render function
  name.

To see the block on a page, install the package in a running instance, add the
block in the page editor and publish the page.

## Starting your own plugin from this one

The licence is MIT-0, so you can copy any of it without keeping a notice.

1. Choose an id: lowercase letters, digits and single hyphens. Put it in
   `openbrf.id`. The host composes each block's type from it, and merges the
   locale files under the `plugin-<id>` namespace.
2. Rename the package and start your version at `0.1.0`.
3. Declare only what your code uses. The board sees `permissions` and
   `personalData` on the consent screen before anything is downloaded, and a
   later version that asks for more is refused until the board consents
   again.
4. Keep the server in one file, or bundle it into one. Keep `@nestjs/common`
   as a peer dependency and never bundle it, and import `@openbrf/plugin-sdk`
   for types only. The package check refuses any runtime dependency, and a
   bundle that requires another package or a relative path.
5. Turn on GitHub's immutable releases for your repository before your first
   release. The catalog refuses a release that is not immutable.

## Releasing

1. In a pull request, set the new `version` in `package.json` and add it to
   [`CHANGELOG.md`](CHANGELOG.md).
2. Once it is merged, tag the merge commit on `main` and push the tag:

   ```sh
   git fetch origin
   git tag v0.1.0 origin/main
   git push origin v0.1.0
   ```

3. The release workflow checks that the tag matches the version and points at
   a commit on `main`. Its `build` job then builds, tests, packs and checks
   the tarball with read access only. Its `publish` job, which installs and
   runs none of the lockfile's packages, holds the tarball to the `sha512` the
   build packed, attests it and publishes the release with the tarball
   attached. Code that runs at build time therefore never holds the token that
   signs an attestation. The release notes give the tarball's `sha512` and
   `bytes`, and the `gh attestation verify` command the catalog runs.

Do not create the release in the GitHub interface. That creates the tag
first, so the workflow starts after the release is already immutable, and the
tarball cannot be attached.

To have a version listed, open a pull request in
[`openbrf/catalog`](https://github.com/openbrf/catalog) that adds its entry
with the release's tarball URL, `sha512` and `bytes`. Copy the declaration from
the manifest exactly: the catalog's check compares the two.

## Licence

[MIT-0](LICENSE). The plugin is built against `@openbrf/plugin-sdk`, which is
AGPL-3.0-only with a module exception. Under that exception, a plugin built
against it may be licensed on any terms.
