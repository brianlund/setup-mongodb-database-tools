"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  cachePathFor,
  installRelease,
  readCachedInstallation,
} = require("./install");
const { normalizeVersionInput, resolveRelease } = require("./manifest");
const { detectTarget, selectDownload } = require("./platform");

function appendWorkflowFile(environmentName, line) {
  const file = process.env[environmentName];
  if (!file) {
    return;
  }
  fs.appendFileSync(file, `${line}${os.EOL}`, "utf8");
}

function setOutput(name, value) {
  appendWorkflowFile("GITHUB_OUTPUT", `${name}=${value}`);
}

function addPath(directory) {
  appendWorkflowFile("GITHUB_PATH", directory);
  process.env.PATH = `${directory}${path.delimiter}${process.env.PATH || ""}`;
}

function annotateError(message) {
  const escaped = message
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
  console.error(`::error::${escaped}`);
}

async function main() {
  const versionInput = process.env.INPUT_VERSION || "latest";
  const normalizedVersion = normalizeVersionInput(versionInput);
  const target = detectTarget();

  console.log(`Runner: ${target.displayName}.`);

  if (normalizedVersion !== "latest") {
    const cachePath = cachePathFor(normalizedVersion, target);
    const cached = await readCachedInstallation(
      cachePath,
      normalizedVersion,
      target,
    );
    if (cached) {
      addPath(cached);
      setOutput("version", normalizedVersion);
      setOutput("path", cached);
      setOutput("cache-hit", "true");
      console.log(
        `MongoDB Database Tools ${normalizedVersion} restored from the runner tool cache.`,
      );
      return;
    }
  }

  const release = await resolveRelease(normalizedVersion);
  const download = selectDownload(release.downloads, target);
  console.log(
    `Selected MongoDB's ${download.name}/${download.arch} archive.`,
  );

  const installation = await installRelease(release, download, target);
  addPath(installation.binDirectory);
  setOutput("version", release.version);
  setOutput("path", installation.binDirectory);
  setOutput("cache-hit", String(installation.cacheHit));

  console.log(
    `MongoDB Database Tools ${release.version} is available on PATH.`,
  );
}

main().catch((error) => {
  annotateError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
