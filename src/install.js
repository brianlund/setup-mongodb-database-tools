"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const CACHE_MARKER = ".mongodb-database-tools.json";
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const TOOL_NAMES = [
  "bsondump",
  "mongodump",
  "mongoexport",
  "mongofiles",
  "mongoimport",
  "mongorestore",
  "mongostat",
  "mongotop",
];

function cachePathFor(version, target, environment = process.env) {
  const toolCache =
    environment.RUNNER_TOOL_CACHE ||
    path.join(environment.RUNNER_TEMP || os.tmpdir(), "runner-tool-cache");
  return path.join(
    toolCache,
    "mongodb-database-tools",
    version,
    target.cacheKey,
  );
}

function executableName(name, target) {
  return target.platform === "windows" ? `${name}.exe` : name;
}

async function runToolVersion(binDirectory, version, target) {
  const canonicalBinDirectory = await fs.promises.realpath(binDirectory);
  const executables = await Promise.all(
    TOOL_NAMES.map(async (name) => {
      const executable = await fs.promises.realpath(
        path.join(canonicalBinDirectory, executableName(name, target)),
      );
      const relativePath = path.relative(canonicalBinDirectory, executable);

      if (
        !relativePath ||
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        throw new Error(
          `MongoDB tool executable resolves outside its bin directory: ${name}.`,
        );
      }

      const stat = await fs.promises.stat(executable);
      if (!stat.isFile()) {
        throw new Error(`MongoDB tool executable is not a file: ${name}.`);
      }

      return { name, path: executable, stat };
    }),
  );

  if (target.platform !== "windows") {
    await Promise.all(
      executables.map((executable) =>
        fs.promises.chmod(
          executable.path,
          executable.stat.mode | 0o111,
        ),
      ),
    );
  }

  const mongodump = executables.find(({ name }) => name === "mongodump");
  const result = await execFileAsync(
    mongodump.path,
    ["--version"],
    {
      timeout: 30_000,
      windowsHide: true,
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const reportedVersion = output.match(
    /mongodump version:\s*v?(\d+\.\d+\.\d+)/i,
  )?.[1];

  if (reportedVersion !== version) {
    throw new Error(
      `Installed mongodump reported version ${reportedVersion || "unknown"} instead of ${version}.`,
    );
  }
}

async function readCachedInstallation(cachePath, version, target) {
  try {
    const marker = JSON.parse(
      await fs.promises.readFile(path.join(cachePath, CACHE_MARKER), "utf8"),
    );
    if (
      marker.version !== version ||
      typeof marker.bin !== "string" ||
      path.isAbsolute(marker.bin) ||
      marker.bin.split(/[\\/]/).includes("..")
    ) {
      return null;
    }

    const binDirectory = path.join(cachePath, marker.bin);
    await runToolVersion(binDirectory, version, target);
    return binDirectory;
  } catch {
    return null;
  }
}

function validateArchive(download) {
  const archive = download?.archive;
  if (!archive || typeof archive.url !== "string") {
    throw new Error("MongoDB's release manifest is missing an archive URL.");
  }
  if (
    typeof archive.sha256 !== "string" ||
    !/^[a-fA-F0-9]{64}$/.test(archive.sha256)
  ) {
    throw new Error(
      "MongoDB's release manifest is missing a valid SHA-256 checksum.",
    );
  }

  const url = new URL(archive.url);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "fastdl.mongodb.org" ||
    !url.pathname.startsWith("/tools/db/mongodb-database-tools-") ||
    (!url.pathname.endsWith(".tgz") && !url.pathname.endsWith(".zip")) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `MongoDB's release manifest contains an unexpected archive URL: ${archive.url}`,
    );
  }

  return {
    url: url.toString(),
    sha256: archive.sha256.toLowerCase(),
    extension: url.pathname.endsWith(".zip") ? ".zip" : ".tgz",
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function downloadArchive(
  url,
  destination,
  fetchImplementation = globalThis.fetch,
) {
  let lastError;

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImplementation(url, {
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "setup-mongodb-database-tools",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const finalUrl = new URL(response.url || url);
      if (
        finalUrl.protocol !== "https:" ||
        finalUrl.hostname !== "fastdl.mongodb.org" ||
        !finalUrl.pathname.startsWith("/tools/db/")
      ) {
        throw new Error(
          `archive redirected to an unexpected URL: ${finalUrl.toString()}`,
        );
      }

      await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(destination, { flags: "wx" }),
      );
      return;
    } catch (error) {
      lastError = error;
      await fs.promises.rm(destination, { force: true });
      if (attempt < DOWNLOAD_ATTEMPTS) {
        await delay(attempt * 1000);
      }
    }
  }

  throw new Error(
    `Could not download MongoDB Database Tools after ${DOWNLOAD_ATTEMPTS} attempts: ${lastError.message}`,
  );
}

async function sha256(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

async function verifyChecksum(file, expectedChecksum) {
  const actualChecksum = await sha256(file);
  const matches = crypto.timingSafeEqual(
    Buffer.from(actualChecksum, "hex"),
    Buffer.from(expectedChecksum, "hex"),
  );

  if (!matches) {
    throw new Error(
      `SHA-256 verification failed. Expected ${expectedChecksum}, received ${actualChecksum}.`,
    );
  }
}

async function extractArchive(archivePath, extension, destination, target) {
  await fs.promises.mkdir(destination, { recursive: true });

  if (extension === ".tgz") {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destination], {
      timeout: 2 * 60 * 1000,
    });
    return;
  }

  if (target.platform === "windows") {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Expand-Archive -LiteralPath $env:MONGODB_TOOLS_ARCHIVE -DestinationPath $env:MONGODB_TOOLS_DESTINATION -Force",
      ],
      {
        env: {
          ...process.env,
          MONGODB_TOOLS_ARCHIVE: archivePath,
          MONGODB_TOOLS_DESTINATION: destination,
        },
        timeout: 2 * 60 * 1000,
      },
    );
    return;
  }

  await execFileAsync("unzip", ["-q", archivePath, "-d", destination], {
    timeout: 2 * 60 * 1000,
  });
}

async function findToolDirectory(root, target) {
  const mongodump = executableName("mongodump", target);
  const mongorestore = executableName("mongorestore", target);
  const queue = [{ directory: root, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    const entries = await fs.promises.readdir(current.directory, {
      withFileTypes: true,
    });
    const fileNames = new Set(
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    );

    if (fileNames.has(mongodump) && fileNames.has(mongorestore)) {
      return current.directory;
    }

    if (current.depth < 4) {
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          queue.push({
            directory: path.join(current.directory, entry.name),
            depth: current.depth + 1,
          });
        }
      }
    }
  }

  throw new Error(
    "The MongoDB archive did not contain mongodump and mongorestore.",
  );
}

async function populateCache(
  extractedBinDirectory,
  cachePath,
  release,
  download,
) {
  const distributionRoot = path.dirname(extractedBinDirectory);
  const stagedCache = `${cachePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const binRelativePath = path.relative(
    distributionRoot,
    extractedBinDirectory,
  );

  await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
  try {
    await fs.promises.rm(stagedCache, { recursive: true, force: true });
    await fs.promises.cp(distributionRoot, stagedCache, {
      recursive: true,
      verbatimSymlinks: true,
    });
    await fs.promises.writeFile(
      path.join(stagedCache, CACHE_MARKER),
      `${JSON.stringify(
        {
          version: release.version,
          platform: download.name,
          architecture: download.arch,
          bin: binRelativePath,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await fs.promises.rm(cachePath, { recursive: true, force: true });
    await fs.promises.rename(stagedCache, cachePath);
    return path.join(cachePath, binRelativePath);
  } finally {
    await fs.promises.rm(stagedCache, { recursive: true, force: true });
  }
}

async function installRelease(
  release,
  download,
  target,
  options = {},
) {
  const environment = options.environment || process.env;
  const cachePath = cachePathFor(release.version, target, environment);
  const cached = await readCachedInstallation(
    cachePath,
    release.version,
    target,
  );
  if (cached) {
    return { binDirectory: cached, cacheHit: true };
  }

  const archive = validateArchive(download);
  const tempRoot = await fs.promises.mkdtemp(
    path.join(environment.RUNNER_TEMP || os.tmpdir(), "mongodb-tools-"),
  );
  const archivePath = path.join(tempRoot, `database-tools${archive.extension}`);
  const extractedDirectory = path.join(tempRoot, "extracted");

  try {
    console.log(`Downloading MongoDB Database Tools ${release.version}.`);
    await downloadArchive(
      archive.url,
      archivePath,
      options.fetchImplementation,
    );
    await verifyChecksum(archivePath, archive.sha256);
    console.log("Verified the archive SHA-256 checksum.");

    await extractArchive(
      archivePath,
      archive.extension,
      extractedDirectory,
      target,
    );
    const extractedBinDirectory = await findToolDirectory(
      extractedDirectory,
      target,
    );
    await runToolVersion(extractedBinDirectory, release.version, target);

    const binDirectory = await populateCache(
      extractedBinDirectory,
      cachePath,
      release,
      download,
    );
    await runToolVersion(binDirectory, release.version, target);
    return { binDirectory, cacheHit: false };
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

module.exports = {
  cachePathFor,
  downloadArchive,
  findToolDirectory,
  installRelease,
  readCachedInstallation,
  runToolVersion,
  sha256,
  validateArchive,
  verifyChecksum,
};
