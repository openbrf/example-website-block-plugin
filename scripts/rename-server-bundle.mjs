// tsc names its output after the source file. The manifest declares
// `dist/server.cjs`, and the extension is what makes the file CommonJS inside a
// package whose type is `module`, which is what the host's `require` needs.
import { renameSync } from "node:fs";

renameSync("dist/server.js", "dist/server.cjs");
