# Windows release process

1. Keep the version aligned in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, and the About panel. Update the release notes.
2. Run the formatting, browser, core, Rust, and native desktop checks. The native suite must use the final executable with its own isolated profile. The clean Windows validation workflow provides the independent CI check.
3. Build the NSIS installer with `npm run desktop:build -- --bundles nsis`. Preserve any running development application; do not terminate another instance to release a file lock.
4. Run `pwsh -NoProfile -File scripts/package-release.ps1`. It verifies the executable version and prepares the installer, a portable ZIP with license notices and instructions, and SHA-256 checksums under `.cache/release/vVERSION/`.
5. Review the concrete artifacts, release notes, final source commit, and passing CI run before publishing. Publish tag `vVERSION` at that validated commit and upload only the installer, portable ZIP, and `SHA256SUMS.txt`. The release description comes from `docs/release-vVERSION.md`.
6. Download the published assets and compare their hashes with `SHA256SUMS.txt`. Verify the release page provides direct downloads.

For builds on CI, the Windows validation job can build NSIS after its native test step and run the same packaging script, then upload the three files as workflow artifacts. Publishing is a separate explicit step after validation; ordinary branch pushes should not create a GitHub release. The package script does not modify tags or publish anything.
