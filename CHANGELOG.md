# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Authentication now succeeds against the live Datto BCDR API. Bumped
  `@wyre-technology/node-datto-bcdr` to `^2.0.0`, which replaces the custom
  HMAC-SHA256 request signing with the HTTP Basic auth the API actually
  expects (public key = username, secret key = password). Previously every
  authenticated call failed with HTTP 401. Fixes #25.

### Added
- Initial scaffold of the Datto BCDR MCP server.
- Stdio + HTTP (StreamableHTTP) transports.
- Gateway-mode credential handling via `X-Datto-BCDR-Public-Key` / `X-Datto-BCDR-Private-Key` headers.
- 10 tools covering devices, assets, backups, screenshots, off-site status, alerts, and activity logs.
- Multi-stage `Dockerfile` with GitHub Packages auth via build secret.
- Semantic-release based CI release pipeline (`.github/workflows/release.yml`).
- MCPB packaging script and Smithery registry config.
