import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * Holds the release workflow to its split: a job that can sign an
 * attestation (`id-token: write`) installs and runs none of the lockfile's
 * packages, so code that runs at build time never holds the token that signs.
 * It also runs the check that stands between the build's tarball and the
 * attestation, so a check that no longer stops the job fails here.
 */

type Permissions = string | Record<string, string> | undefined;

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  run?: string;
}

interface Job {
  needs?: string | string[];
  permissions?: Permissions;
  steps?: Step[];
}

interface Workflow {
  permissions?: Permissions;
  jobs: Record<string, Job>;
}

/** Actions that install a package manager or a Node to run dependencies with. */
const SETUP_ACTIONS = ["pnpm/action-setup", "actions/setup-node"];

/**
 * A command that installs or runs what the lockfile holds, also when it is
 * named by its path (`/usr/bin/node`) or is an executable of the installed
 * packages (`./node_modules/.bin/vitest`).
 */
const DEPENDENCY_COMMAND =
  /(^|[\s;&|(`$/])(pnpm|npm|npx|yarn|corepack|node_modules|node)\b/m;

function mintsTokens(permissions: Permissions): boolean {
  if (typeof permissions === "string") {
    return permissions === "write-all";
  }
  return permissions?.["id-token"] === "write";
}

/** Every sentence a workflow fails the split with; none when it holds. */
function splitProblems(workflow: Workflow): string[] {
  const problems: string[] = [];
  for (const [id, job] of Object.entries(workflow.jobs)) {
    // A job without its own permissions takes the workflow's.
    if (!mintsTokens(job.permissions ?? workflow.permissions)) {
      continue;
    }
    for (const step of job.steps ?? []) {
      const action = step.uses?.split("@")[0];
      if (action !== undefined && SETUP_ACTIONS.includes(action)) {
        problems.push(`job ${id} can sign attestations and uses ${action}`);
      }
      const command = step.run?.match(DEPENDENCY_COMMAND)?.[2];
      if (command !== undefined) {
        problems.push(`job ${id} can sign attestations and runs ${command}`);
      }
    }
  }
  return problems;
}

/**
 * Runs the publish job's check of the downloaded tarball the way the runner
 * does (`bash -e` on the step's script) in a directory of its own, with the
 * `release` directory the download leaves and the two build outputs the
 * workflow hands it through the environment.
 */
interface CheckRun {
  status: number | null;
  output: string;
  /** What the check appended to `GITHUB_ENV`: the `TARBALL` and `SHA512` the later steps read. */
  env: string;
}

const scratch: string[] = [];

/**
 * The `base64` of the runner, where `-w0` is GNU's: macOS and BSD take no such
 * option. It lives for the whole suite and is removed in `afterAll`, apart
 * from the per-test directories in `scratch`.
 */
let base64Dir: string | undefined;

beforeAll(() => {
  const gnu = spawnSync("base64", ["-w0"], { input: "x" });
  if (gnu.status === 0) {
    return;
  }
  const real = spawnSync("sh", ["-c", "command -v base64"], {
    encoding: "utf8",
  }).stdout.trim();
  base64Dir = mkdtempSync(join(tmpdir(), "base64-"));
  const shim = join(base64Dir, "base64");
  // BSD base64 never wraps its output, which is what `-w0` asks of GNU's.
  writeFileSync(
    shim,
    `#!/bin/sh\nif [ "$1" = "-w0" ]; then shift; fi\nexec '${real}' "$@"\n`,
  );
  chmodSync(shim, 0o755);
});

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(() => {
  if (base64Dir !== undefined) {
    rmSync(base64Dir, { recursive: true, force: true });
    base64Dir = undefined;
  }
});

function sha512Of(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function runTarballCheck(options: {
  /** The files the download leaves in `release`, by name. */
  files: Record<string, Buffer>;
  /** The tarball name the build reports. */
  builtTarball: string;
  /** The sha512 the build reports. */
  builtSha512: string;
}): CheckRun {
  const steps = workflow.jobs.publish?.steps ?? [];
  const script = steps.find(
    (step) => step.env?.BUILT_SHA512 !== undefined,
  )?.run;
  if (script === undefined) {
    throw new Error("the publish job has no check of the downloaded tarball");
  }
  const dir = mkdtempSync(join(tmpdir(), "release-check-"));
  scratch.push(dir);
  mkdirSync(join(dir, "release"));
  for (const [name, bytes] of Object.entries(options.files)) {
    writeFileSync(join(dir, "release", name), bytes);
  }
  const scriptPath = join(dir, "check.sh");
  writeFileSync(scriptPath, script);
  const githubEnv = join(dir, "github-env");
  writeFileSync(githubEnv, "");

  const result = spawnSync("bash", ["-e", scriptPath], {
    cwd: dir,
    encoding: "utf8",
    // Nothing of this process's environment: on a runner it would hold the
    // real `GITHUB_ENV`.
    env: {
      PATH: [base64Dir, process.env.PATH].filter(Boolean).join(":"),
      GITHUB_ENV: githubEnv,
      BUILT_TARBALL: options.builtTarball,
      BUILT_SHA512: options.builtSha512,
    },
  });
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    env: readFileSync(githubEnv, "utf8"),
  };
}

const workflow = parse(
  readFileSync(".github/workflows/release.yml", "utf8"),
) as Workflow;

describe("the release workflow", () => {
  it("grants nothing at the top, so each job states what it needs", () => {
    expect(workflow.permissions).toEqual({});
  });

  it("builds with read access only", () => {
    expect(workflow.jobs.build?.permissions).toEqual({ contents: "read" });
  });

  it("publishes with exactly the three write scopes, in a job that needs the build", () => {
    const publish = workflow.jobs.publish;
    expect(publish?.permissions).toEqual({
      contents: "write",
      "id-token": "write",
      attestations: "write",
    });
    expect(publish).toMatchObject({ needs: "build" });
  });

  it("attests only the tarball the build checked, and refuses any other", () => {
    const steps = workflow.jobs.publish?.steps ?? [];
    const download = steps.find((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    expect(download?.with).toMatchObject({ name: "tarball", path: "release" });

    const check = steps.find((step) => step.env?.BUILT_SHA512 !== undefined);
    expect(check?.env).toEqual({
      BUILT_TARBALL: "${{ needs.build.outputs.tarball }}",
      BUILT_SHA512: "${{ needs.build.outputs.sha512 }}",
    });
    // The outputs are read as data, never interpolated into the script.
    expect(check?.run).not.toContain("${{");
    expect(check?.run).toContain("openssl dgst -sha512");
    expect(check?.run).toContain('!= "${BUILT_SHA512}"');
    expect(check?.run).toContain('!= "${BUILT_TARBALL}"');

    const attest = steps.find((step) =>
      step.uses?.startsWith("actions/attest-build-provenance@"),
    );
    expect(attest?.with).toEqual({ "subject-path": "${{ env.TARBALL }}" });
    // The check runs before the tarball is attested.
    expect(steps.indexOf(check as Step)).toBeLessThan(
      steps.indexOf(attest as Step),
    );
  });

  it("installs and runs none of the lockfile's packages in a job that can sign attestations", () => {
    expect(splitProblems(workflow)).toEqual([]);
  });

  it("refuses a single job that builds where it signs", () => {
    const single: Workflow = {
      permissions: {},
      jobs: {
        release: {
          permissions: { contents: "write", "id-token": "write" },
          steps: [
            {
              uses: "pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413",
            },
            { run: "pnpm install --frozen-lockfile" },
            { run: "mkdir release\nnpm pack --pack-destination release" },
            { uses: "actions/attest-build-provenance@4d101475" },
          ],
        },
      },
    };

    expect(splitProblems(single)).toEqual([
      "job release can sign attestations and uses pnpm/action-setup",
      "job release can sign attestations and runs pnpm",
      "job release can sign attestations and runs npm",
    ]);
  });

  it("refuses a job that takes write-all from the workflow and runs node", () => {
    const inherited: Workflow = {
      permissions: "write-all",
      jobs: { publish: { steps: [{ run: "node scripts/check-package.mjs" }] } },
    };

    expect(splitProblems(inherited)).toEqual([
      "job publish can sign attestations and runs node",
    ]);
  });

  it("refuses a job that runs node by its path", () => {
    const pathed: Workflow = {
      permissions: {},
      jobs: {
        publish: {
          permissions: { "id-token": "write" },
          steps: [{ run: "/usr/bin/node scripts/check-package.mjs" }],
        },
      },
    };

    expect(splitProblems(pathed)).toEqual([
      "job publish can sign attestations and runs node",
    ]);
  });

  it("refuses a job that runs an executable of the installed packages", () => {
    const local: Workflow = {
      permissions: {},
      jobs: {
        publish: {
          permissions: { "id-token": "write" },
          steps: [
            { run: "./node_modules/.bin/vitest run" },
            { run: "node_modules/.bin/tsc" },
          ],
        },
      },
    };

    expect(splitProblems(local)).toEqual([
      "job publish can sign attestations and runs node_modules",
      "job publish can sign attestations and runs node_modules",
    ]);
  });

  describe("the check of the downloaded tarball", () => {
    const name = "openbrf-example-website-block-plugin-0.1.0.tgz";
    const bytes = Buffer.from("the tarball the build packed");
    const digest = sha512Of(bytes);

    it("passes the tarball the build packed and hands its path and sha512 on", () => {
      const run = runTarballCheck({
        files: { [name]: bytes },
        builtTarball: name,
        builtSha512: digest,
      });

      expect(run.status).toBe(0);
      expect(run.env).toBe(`TARBALL=release/${name}\nSHA512=${digest}\n`);
    });

    it("stops on a sha512 other than the build's", () => {
      const run = runTarballCheck({
        files: { [name]: Buffer.from("a tarball swapped in after the build") },
        builtTarball: name,
        builtSha512: digest,
      });

      expect(run.status).toBe(1);
      expect(run.output).toContain("::error::The downloaded tarball's sha512");
      expect(run.env).toBe("");
    });

    it("stops on an extra file next to the tarball", () => {
      const run = runTarballCheck({
        files: { [name]: bytes, "extra.txt": Buffer.from("not built") },
        builtTarball: name,
        builtSha512: digest,
      });

      expect(run.status).toBe(1);
      expect(run.output).toContain("holds other files");
      expect(run.env).toBe("");
    });

    it("stops on an extra hidden file, which `ls` without -A would not list", () => {
      const run = runTarballCheck({
        files: { [name]: bytes, ".hidden": Buffer.from("not built") },
        builtTarball: name,
        builtSha512: digest,
      });

      expect(run.status).toBe(1);
      expect(run.env).toBe("");
    });

    it("stops when the artifact does not hold the tarball the build named", () => {
      const run = runTarballCheck({
        files: { "other-0.1.0.tgz": bytes },
        builtTarball: name,
        builtSha512: digest,
      });

      expect(run.status).toBe(1);
      expect(run.output).toContain("holds other files");
      expect(run.env).toBe("");
    });

    it.each([
      ["a path up a directory", "../escape.tgz"],
      ["a path into a subdirectory", "sub/plugin.tgz"],
      ["a command substitution", "$(touch pwned).tgz"],
      ["a name without the .tgz ending", "plugin.tar"],
      ["a name that starts with a dash", "-plugin.tgz"],
      ["empty", ""],
    ])(
      "stops on a tarball name that is %s, before it reads any file",
      (_, built) => {
        const run = runTarballCheck({
          files: { [name]: bytes },
          builtTarball: built,
          builtSha512: digest,
        });

        expect(run.status).toBe(1);
        expect(run.output).toContain("is not a tarball's file name");
        expect(run.env).toBe("");
      },
    );
  });
});
