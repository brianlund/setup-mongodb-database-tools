"use strict";

const CURRENT_MANIFEST_URL =
  "https://downloads.mongodb.org/tools/db/release.json";
const FULL_MANIFEST_URL = "https://downloads.mongodb.org/tools/db/full.json";
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;

function normalizeVersionInput(value) {
  const version = value.trim().toLowerCase();
  if (version === "latest") {
    return version;
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `Invalid version "${value}". Use "latest" or an exact version such as "100.17.0".`,
    );
  }
  return version;
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function releaseFromManifest(manifest, requestedVersion) {
  if (!manifest || !Array.isArray(manifest.versions)) {
    throw new Error("MongoDB returned an invalid Database Tools manifest.");
  }

  const validVersions = manifest.versions
    .map((release) => release?.version)
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version || ""));

  const resolvedVersion =
    requestedVersion === "latest"
      ? validVersions.sort(compareVersions).at(-1)
      : requestedVersion;

  if (!resolvedVersion) {
    throw new Error("MongoDB's Database Tools manifest contains no releases.");
  }

  const matchingReleases = manifest.versions.filter(
    (release) => release?.version === resolvedVersion,
  );
  if (matchingReleases.length === 0) {
    return null;
  }

  const downloads = matchingReleases.flatMap((release) =>
    Array.isArray(release.downloads) ? release.downloads : [],
  );
  return { version: resolvedVersion, downloads };
}

async function fetchJson(url, fetchImplementation = globalThis.fetch) {
  let response;
  try {
    response = await fetchImplementation(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "setup-mongodb-database-tools",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`Could not download MongoDB's release manifest: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(
      `Could not download MongoDB's release manifest: HTTP ${response.status}.`,
    );
  }

  const finalUrl = new URL(response.url || url);
  if (
    finalUrl.protocol !== "https:" ||
    finalUrl.hostname !== "downloads.mongodb.org" ||
    !finalUrl.pathname.startsWith("/tools/db/")
  ) {
    throw new Error(
      `MongoDB's release manifest redirected to an unexpected URL: ${finalUrl.toString()}`,
    );
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_MANIFEST_BYTES) {
    throw new Error("MongoDB's release manifest is unexpectedly large.");
  }

  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_MANIFEST_BYTES) {
    throw new Error("MongoDB's release manifest is unexpectedly large.");
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("MongoDB returned malformed JSON for its release manifest.");
  }
}

async function resolveRelease(
  versionInput,
  fetchJsonImplementation = fetchJson,
) {
  const requestedVersion = normalizeVersionInput(versionInput);
  const currentManifest = await fetchJsonImplementation(CURRENT_MANIFEST_URL);
  const currentRelease = releaseFromManifest(
    currentManifest,
    requestedVersion,
  );

  if (currentRelease) {
    return currentRelease;
  }

  if (requestedVersion === "latest") {
    throw new Error("MongoDB's current Database Tools manifest is empty.");
  }

  const fullManifest = await fetchJsonImplementation(FULL_MANIFEST_URL);
  const archivedRelease = releaseFromManifest(fullManifest, requestedVersion);
  if (!archivedRelease) {
    throw new Error(
      `MongoDB Database Tools ${requestedVersion} was not found in MongoDB's official release manifest.`,
    );
  }

  return archivedRelease;
}

module.exports = {
  CURRENT_MANIFEST_URL,
  FULL_MANIFEST_URL,
  compareVersions,
  fetchJson,
  normalizeVersionInput,
  releaseFromManifest,
  resolveRelease,
};
