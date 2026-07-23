"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  architectureAliases,
  detectTarget,
  parseOsRelease,
  selectDownload,
} = require("../src/platform");

test("parses quoted Linux release metadata", () => {
  assert.deepEqual(
    parseOsRelease(
      'ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.2 LTS"\n',
    ),
    {
      ID: "ubuntu",
      VERSION_ID: "24.04",
      PRETTY_NAME: "Ubuntu 24.04.2 LTS",
    },
  );
});

test("detects an Ubuntu ARM64 runner", () => {
  const target = detectTarget({
    platform: "linux",
    architecture: "arm64",
    osReleaseContents:
      'ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04 LTS"\n',
  });

  assert.equal(target.family, "ubuntu");
  assert.deepEqual(target.archAliases, ["arm64", "aarch64"]);
  assert.equal(target.cacheKey, "linux-ubuntu-24.04-arm64");
});

test("maps supported Node architectures to MongoDB archive names", () => {
  assert.deepEqual(architectureAliases("x64"), ["x86_64"]);
  assert.deepEqual(architectureAliases("ppc64", "LE"), ["ppc64le"]);
  assert.throws(() => architectureAliases("ia32"), /Unsupported/);
});

test("selects the newest compatible Ubuntu archive", () => {
  const target = detectTarget({
    platform: "linux",
    architecture: "x64",
    osReleaseContents:
      'ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04 LTS"\n',
  });
  const selected = selectDownload(
    [
      { name: "ubuntu1804", arch: "x86_64" },
      { name: "ubuntu2204", arch: "x86_64" },
      { name: "ubuntu2604", arch: "x86_64" },
    ],
    target,
  );

  assert.equal(selected.name, "ubuntu2204");
});

test("recognizes legacy Debian archive version names", () => {
  const target = detectTarget({
    platform: "linux",
    architecture: "x64",
    osReleaseContents:
      'ID=debian\nVERSION_ID="12"\nPRETTY_NAME="Debian GNU/Linux 12"\n',
  });
  const selected = selectDownload(
    [
      { name: "debian71", arch: "x86_64" },
      { name: "debian92", arch: "x86_64" },
    ],
    target,
  );

  assert.equal(selected.name, "debian92");
});

test("uses a compatible RHEL minor build when the runner reports only a major", () => {
  const target = detectTarget({
    platform: "linux",
    architecture: "x64",
    osReleaseContents:
      'ID=centos\nID_LIKE="rhel fedora"\nVERSION_ID="9"\nPRETTY_NAME="CentOS Stream 9"\n',
  });
  const selected = selectDownload(
    [
      { name: "rhel88", arch: "x86_64" },
      { name: "rhel93", arch: "x86_64" },
    ],
    target,
  );

  assert.equal(selected.name, "rhel93");
});

test("prefers exact Amazon Linux releases and falls back to older releases", () => {
  const target = detectTarget({
    platform: "linux",
    architecture: "arm64",
    osReleaseContents:
      'ID="amzn"\nVERSION_ID="2023"\nPRETTY_NAME="Amazon Linux 2023"\n',
  });
  const selected = selectDownload(
    [
      { name: "amazon2", arch: "aarch64" },
      { name: "amazon2023", arch: "aarch64" },
    ],
    target,
  );

  assert.equal(selected.name, "amazon2023");
});

test("fails clearly when MongoDB has no archive for the runner", () => {
  const target = detectTarget({
    platform: "darwin",
    architecture: "arm64",
  });

  assert.throws(
    () =>
      selectDownload([{ name: "macos", arch: "x86_64" }], target),
    /does not publish a compatible archive/,
  );
});
