import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
// 2-space + trailing newline, matching what release-please.yml's jq writes.
// version-bump.mjs previously wrote tabs here, so every `npm version` reindented
// all 220+ lines and the next release flipped them straight back, burying real
// changes in churn. manifest.json genuinely is tab-indented, so that one stays.
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
