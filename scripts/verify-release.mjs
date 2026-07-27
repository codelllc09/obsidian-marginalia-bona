import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const releaseTag = process.env.RELEASE_TAG;

if (!releaseTag) {
  throw new Error("RELEASE_TAG is unavailable.");
}

if (releaseTag !== manifest.version || releaseTag !== packageJson.version) {
  throw new Error(
    `Release tag (${releaseTag}), manifest version (${manifest.version}), and package version (${packageJson.version}) must match exactly.`,
  );
}
