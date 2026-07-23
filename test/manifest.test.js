"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compareVersions,
  normalizeVersionInput,
  releaseFromManifest,
  resolveRelease,
  CURRENT_MANIFEST_URL,
  FULL_MANIFEST_URL,
} = require("../src/manifest");

test("normalizes supported version inputs", () => {
  assert.equal(normalizeVersionInput(" latest "), "latest");
  assert.equal(normalizeVersionInput("100.17.0"), "100.17.0");
  assert.throws(
    () => normalizeVersionInput("100.17"),
    /Use "latest" or an exact version/,
  );
});

test("compares three-part versions numerically", () => {
  assert.ok(compareVersions("100.17.0", "100.9.5") > 0);
  assert.ok(compareVersions("100.16.1", "100.17.0") < 0);
  assert.equal(compareVersions("100.17.0", "100.17.0"), 0);
});

test("resolves latest and merges duplicate version entries", () => {
  const manifest = {
    versions: [
      { version: "100.9.5", downloads: [{ name: "old" }] },
      { version: "100.17.0", downloads: [{ name: "linux" }] },
      { version: "100.17.0", downloads: [{ name: "windows" }] },
    ],
  };

  assert.deepEqual(releaseFromManifest(manifest, "latest"), {
    version: "100.17.0",
    downloads: [{ name: "linux" }, { name: "windows" }],
  });
});

test("uses the archive manifest only when the current manifest misses", async () => {
  const requestedUrls = [];
  const fetchJson = async (url) => {
    requestedUrls.push(url);
    if (url === CURRENT_MANIFEST_URL) {
      return {
        versions: [{ version: "100.17.0", downloads: [] }],
      };
    }
    return {
      versions: [
        {
          version: "100.6.1",
          downloads: [{ name: "ubuntu2204" }],
        },
      ],
    };
  };

  const release = await resolveRelease("100.6.1", fetchJson);
  assert.equal(release.version, "100.6.1");
  assert.deepEqual(requestedUrls, [CURRENT_MANIFEST_URL, FULL_MANIFEST_URL]);
});
