# Contributing

Bug reports and focused pull requests are welcome.

## Development

Use Node.js 24 or later:

```sh
npm ci
npm run check
npm test
```

Changes to platform selection should include unit coverage. Changes to the
installer should preserve these guarantees:

- Archives come from MongoDB's official download host.
- Every archive is checked against the SHA-256 value in MongoDB's manifest.
- User-provided values are not interpolated into shell commands.
- The action remains usable without installing runtime dependencies.

By contributing, you agree that your contribution is licensed under the MIT
License.
