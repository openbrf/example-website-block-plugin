// Empties `dist/` before a build, so a file an earlier build left behind is
// never packed into the tarball.
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
