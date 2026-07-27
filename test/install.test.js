"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  cachePathFor,
  findToolDirectory,
  runToolVersion,
  sha256,
  validateArchive,
  verifyChecksum,
} = require("../src/install");

const linuxTarget = {
  platform: "linux",
  cacheKey: "linux-ubuntu-24.04-x64",
};

test("builds a scoped runner tool cache path", () => {
  assert.equal(
    cachePathFor("100.17.0", linuxTarget, {
      RUNNER_TOOL_CACHE: "/runner/cache",
    }),
    path.join(
      "/runner/cache",
      "mongodb-database-tools",
      "100.17.0",
      "linux-ubuntu-24.04-x64",
    ),
  );
});

test("accepts only official MongoDB archive URLs and SHA-256 values", () => {
  const archive = validateArchive({
    archive: {
      url: "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2404-x86_64-100.17.0.tgz",
      sha256:
        "1ee9051265e72bafcd3fd77fb8ae6b2a89a964b5a9bc7e4a4f7da54375b26f0f",
    },
  });
  assert.equal(archive.extension, ".tgz");

  assert.throws(
    () =>
      validateArchive({
        archive: {
          url: "https://example.com/database-tools.tgz",
          sha256: "a".repeat(64),
        },
      }),
    /unexpected archive URL/,
  );
});

test("hashes files and rejects a checksum mismatch", async (context) => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "mongodb-tools-test-"),
  );
  context.after(() => fs.promises.rm(directory, { recursive: true, force: true }));

  const file = path.join(directory, "archive");
  await fs.promises.writeFile(file, "mongodb database tools", "utf8");
  const digest = await sha256(file);

  assert.equal(
    digest,
    "ffb423079c1d64fa3cae266d1ce2ec2e893364d7e9134a049d86686960e1225b",
  );
  await verifyChecksum(file, digest);
  await assert.rejects(
    () => verifyChecksum(file, "0".repeat(64)),
    /SHA-256 verification failed/,
  );
});

test("finds the Database Tools binary directory", async (context) => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "mongodb-tools-test-"),
  );
  context.after(() => fs.promises.rm(directory, { recursive: true, force: true }));

  const bin = path.join(directory, "distribution", "bin");
  await fs.promises.mkdir(bin, { recursive: true });
  await Promise.all(
    ["mongodump", "mongorestore"].map((name) =>
      fs.promises.writeFile(path.join(bin, name), "", "utf8"),
    ),
  );

  assert.equal(await findToolDirectory(directory, linuxTarget), bin);
});

test("rejects tool executables that resolve outside the bin directory", async (context) => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "mongodb-tools-test-"),
  );
  context.after(() => fs.promises.rm(directory, { recursive: true, force: true }));

  const bin = path.join(directory, "bin");
  const outsideMongodump = path.join(directory, "mongodump");
  await fs.promises.mkdir(bin);
  await fs.promises.writeFile(outsideMongodump, "", "utf8");
  await Promise.all(
    [
      "bsondump",
      "mongoexport",
      "mongofiles",
      "mongoimport",
      "mongorestore",
      "mongostat",
      "mongotop",
    ].map((name) => fs.promises.writeFile(path.join(bin, name), "", "utf8")),
  );
  await fs.promises.symlink(outsideMongodump, path.join(bin, "mongodump"));

  await assert.rejects(
    () => runToolVersion(bin, "100.17.0", linuxTarget),
    /resolves outside its bin directory/,
  );
});
