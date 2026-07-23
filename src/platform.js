"use strict";

const fs = require("node:fs");
const os = require("node:os");

const LINUX_RELEASE_PATH = "/etc/os-release";

function parseOsRelease(contents) {
  const values = {};

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) {
      continue;
    }

    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    values[match[1]] = value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  return values;
}

function architectureAliases(architecture, endianness = os.endianness()) {
  switch (architecture) {
    case "x64":
      return ["x86_64"];
    case "arm64":
      return ["arm64", "aarch64"];
    case "ppc64":
      if (endianness !== "LE") {
        throw new Error("Big-endian ppc64 runners are not supported.");
      }
      return ["ppc64le"];
    case "s390x":
      return ["s390x"];
    default:
      throw new Error(`Unsupported runner architecture: ${architecture}`);
  }
}

function normalizeLinuxFamily(release) {
  const identifiers = [release.ID, ...(release.ID_LIKE || "").split(/\s+/)]
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  if (identifiers.includes("ubuntu")) {
    return "ubuntu";
  }
  if (identifiers.includes("debian")) {
    return "debian";
  }
  if (identifiers.includes("amzn")) {
    return "amazon";
  }
  if (
    identifiers.some((value) =>
      ["rhel", "centos", "rocky", "almalinux", "ol"].includes(value),
    )
  ) {
    return "rhel";
  }
  if (
    identifiers.some((value) =>
      ["sles", "suse", "opensuse", "opensuse-leap"].includes(value),
    )
  ) {
    return "suse";
  }

  throw new Error(
    `Unsupported Linux distribution: ${release.PRETTY_NAME || release.ID || "unknown"}`,
  );
}

function detectTarget(options = {}) {
  const runnerPlatform = options.platform || process.platform;
  const runnerArchitecture = options.architecture || process.arch;
  const archAliases = architectureAliases(
    runnerArchitecture,
    options.endianness,
  );

  if (runnerPlatform === "darwin") {
    return {
      platform: "macos",
      family: "macos",
      version: "",
      architecture: runnerArchitecture,
      archAliases,
      cacheKey: `macos-${runnerArchitecture}`,
      displayName: `macOS ${runnerArchitecture}`,
    };
  }

  if (runnerPlatform === "win32") {
    return {
      platform: "windows",
      family: "windows",
      version: "",
      architecture: runnerArchitecture,
      archAliases,
      cacheKey: `windows-${runnerArchitecture}`,
      displayName: `Windows ${runnerArchitecture}`,
    };
  }

  if (runnerPlatform !== "linux") {
    throw new Error(`Unsupported runner operating system: ${runnerPlatform}`);
  }

  const osReleaseContents =
    options.osReleaseContents || fs.readFileSync(LINUX_RELEASE_PATH, "utf8");
  const release = parseOsRelease(osReleaseContents);
  const family = normalizeLinuxFamily(release);
  const version = release.VERSION_ID || "";

  if (!version) {
    throw new Error(
      `Could not determine the version of ${release.PRETTY_NAME || release.ID || "this Linux distribution"}.`,
    );
  }

  const id = (release.ID || family).toLowerCase();
  const safeVersion = version.replace(/[^0-9A-Za-z.-]/g, "-");

  return {
    platform: "linux",
    family,
    version,
    architecture: runnerArchitecture,
    archAliases,
    cacheKey: `linux-${id}-${safeVersion}-${runnerArchitecture}`,
    displayName: `${release.PRETTY_NAME || `${id} ${version}`} ${runnerArchitecture}`,
  };
}

function parseUbuntuVersion(name) {
  const match = name.match(/^ubuntu(\d{2})(\d{2})$/);
  return match ? Number(match[1]) * 100 + Number(match[2]) : null;
}

function parseDebianVersion(name) {
  const match = name.match(/^debian(\d+)$/);
  if (!match) {
    return null;
  }

  const digits = match[1];
  if (digits.length === 2 && ["7", "8", "9"].includes(digits[0])) {
    return Number(digits[0]) * 100 + Number(digits.slice(1));
  }

  return Number(digits) * 100;
}

function parseRhelVersion(name) {
  const match = name.match(/^rhel(\d+)$/);
  if (!match) {
    return null;
  }

  const digits = match[1];
  if (digits === "10") {
    return 1000;
  }
  if (digits.length === 1) {
    return Number(digits) * 100;
  }

  return Number(digits[0]) * 100 + Number(digits.slice(1));
}

function parseSuseVersion(name) {
  const match = name.match(/^suse(\d+)$/);
  return match ? Number(match[1]) * 100 : null;
}

function runnerVersionNumber(target) {
  const numericParts = target.version.match(/\d+/g) || [];
  const major = Number(numericParts[0]);
  const minor =
    target.family === "rhel" && numericParts.length === 1
      ? 99
      : Number(numericParts[1] || 0);

  if (!Number.isFinite(major)) {
    throw new Error(`Unsupported ${target.family} version: ${target.version}`);
  }

  return major * 100 + minor;
}

function chooseLinuxPlatform(downloads, target) {
  const parsers = {
    ubuntu: parseUbuntuVersion,
    debian: parseDebianVersion,
    rhel: parseRhelVersion,
    suse: parseSuseVersion,
  };

  if (target.family === "amazon") {
    const major = target.version.match(/\d+/)?.[0] || "";
    const preferredNames =
      major === "2023"
        ? ["amazon2023", "amazon2", "amazon"]
        : major === "2"
          ? ["amazon2", "amazon"]
          : ["amazon"];

    for (const name of preferredNames) {
      const match = downloads.find((download) => download.name === name);
      if (match) {
        return match;
      }
    }
    return null;
  }

  const parseVersion = parsers[target.family];
  if (!parseVersion) {
    return null;
  }

  const runnerVersion = runnerVersionNumber(target);
  return downloads
    .map((download) => ({
      download,
      version: parseVersion(download.name),
    }))
    .filter(
      (candidate) =>
        candidate.version !== null && candidate.version <= runnerVersion,
    )
    .sort((left, right) => right.version - left.version)[0]?.download;
}

function selectDownload(downloads, target) {
  const matchingArchitecture = downloads
    .filter((download) => target.archAliases.includes(download.arch))
    .sort(
      (left, right) =>
        target.archAliases.indexOf(left.arch) -
        target.archAliases.indexOf(right.arch),
    );

  let selected;
  if (target.platform === "linux") {
    selected = chooseLinuxPlatform(matchingArchitecture, target);
  } else {
    selected = matchingArchitecture.find(
      (download) => download.name === target.platform,
    );
  }

  if (!selected) {
    const available = [
      ...new Set(
        downloads.map((download) => `${download.name}/${download.arch}`),
      ),
    ]
      .sort()
      .join(", ");
    throw new Error(
      `MongoDB does not publish a compatible archive for ${target.displayName}. Available archives for this version: ${available || "none"}.`,
    );
  }

  return selected;
}

module.exports = {
  architectureAliases,
  detectTarget,
  parseOsRelease,
  selectDownload,
};
