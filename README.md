# setup-mongodb-database-tools

[![CI](https://github.com/brianlund/setup-mongodb-database-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/brianlund/setup-mongodb-database-tools/actions/workflows/ci.yml)

Install [MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/)
on a GitHub Actions runner. The action adds `mongodump`, `mongorestore`,
`mongoexport`, `mongoimport`, and the other Database Tools commands to `PATH`.

This community-maintained action is not affiliated with or endorsed by
MongoDB, Inc.

## Usage

```yaml
permissions:
  contents: read

steps:
  - uses: brianlund/setup-mongodb-database-tools@v1
    with:
      version: "100.17.0"

  - name: Dump MongoDB
    env:
      MONGODB_URI: ${{ secrets.MONGODB_URI }}
    run: mongodump --uri="$MONGODB_URI" --archive=mongodb.archive --gzip
```

Pin an exact version for reproducible workflows. Set version to latest to install the latest release:

```yaml
- uses: brianlund/setup-mongodb-database-tools@v1
  with:
    version: latest
```

## Amazon DocumentDB

Amazon DocumentDB supports `mongodump`, `mongorestore`, `mongoexport`, and
`mongoimport`. As of July 2026, AWS recommends MongoDB Database Tools 100.6.1
or earlier for DocumentDB. Pin that version unless AWS updates its
[compatibility guidance](https://docs.aws.amazon.com/documentdb/latest/developerguide/backup_restore-dump_restore_import_export_data.html).

```yaml
- uses: brianlund/setup-mongodb-database-tools@v1
  with:
    version: "100.6.1"

- name: Download the Amazon RDS CA bundle
  run: |
    curl --fail --silent --show-error --location \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
      --output global-bundle.pem

- name: Dump Amazon DocumentDB
  env:
    DOCUMENTDB_URI: ${{ secrets.DOCUMENTDB_URI }}
  run: |
    mongodump \
      --uri="$DOCUMENTDB_URI" \
      --ssl \
      --sslCAFile=global-bundle.pem \
      --archive=documentdb.archive \
      --gzip
```

Place the runner inside a VPC that can reach the DocumentDB cluster.

## Inputs

| Input     | Description                               | Default  |
| --------- | ----------------------------------------- | -------- |
| `version` | Exact Database Tools version, or `latest` | `latest` |

## Outputs

| Output      | Description                                     |
| ----------- | ----------------------------------------------- |
| `version`   | Exact version installed                         |
| `path`      | Directory containing the installed binaries     |
| `cache-hit` | `true` when restored from the runner tool cache |

## Supported runners

CI tests the action on:

- Ubuntu 24.04 on x64 and ARM64
- macOS 15 on Intel and Apple silicon
- Windows Server 2025 on x64

The action supports compatible self-hosted Ubuntu, Debian, Amazon Linux,
RHEL-family, and SUSE runners when MongoDB publishes an archive for the
requested version and architecture. On Linux, the action selects the newest
published distribution build that is not newer than the runner.

The action uses the Node.js 24 action runtime. Self-hosted runners must use a
GitHub Actions runner version that supports Node.js 24 actions.

## Verification and caching

The action performs these checks:

1. Resolves releases from MongoDB's official Database Tools manifests.
2. Downloads archives only from `fastdl.mongodb.org`.
3. Verifies the archive against MongoDB's published SHA-256 value.
4. Checks that `mongodump` reports the requested version.
5. Stores the verified installation in the runner tool cache.

Later steps in the same job and persistent self-hosted runners can reuse the cache.

## License and terms

Brian Lund licenses the action source code under the [MIT License](LICENSE).
The [End User License Agreement](EULA.md) also governs your use of the action.

This repository does not include MongoDB Database Tools. The action downloads
them from MongoDB, and
[MongoDB's terms](https://www.mongodb.com/legal/licensing/community-edition)
govern their use. MongoDB is a registered trademark of MongoDB, Inc.
