# Netbrowse Voice v0.32.5 — Community Edition and Submission Release

## Highlights

- Moves the current Community Edition source and release archives to
  GPL-3.0-or-later.
- Adds Community Edition, licensing-transition, trademark, contributing and
  security policies.
- Adds a reproducible release-archive script that produces a `.tar.gz` and a
  matching `.sha256` file whose filename verifies correctly after download.
- Updates the installation instructions and submission runbook for v0.32.5.
- Keeps the project ready for public judging: the three-minute demo plan,
  testing guidance and Codex/GPT-5.6 attribution remain in the repository.

## Compatibility

This release is intended as a documentation, licensing and release-process
update over v0.32.4. No functional PBX migration is intended. Earlier copies
distributed under Apache-2.0 retain their original licence grant; see
[LICENSE-TRANSITION.md](../LICENSE-TRANSITION.md).

## Validation

- TypeScript typecheck passed for API, web and Module SDK.
- Production API, web and Module SDK builds passed.
- 129 API tests passed.
- The shipped [LICENSE](../LICENSE) exactly matches the GNU GPL v3 text.

## Release assets

Attach both of these files to the GitHub Release:

- `netbrowse-voice-0.32.5.tar.gz`
- `netbrowse-voice-0.32.5.tar.gz.sha256`

Use the archive script from a clean, committed checkout:

```bash
cd ~
cd ~/netbrowse-voice-publish
bash scripts/create-release-archive.sh
```

The files are created in `~/netbrowse-voice-publish/release/`. Upload both
files to the `v0.32.5` GitHub Release, then verify the public download using
the commands in [INSTALL.md](../INSTALL.md).
