# Netbrowse Voice v0.32.6 — OpenAI Realtime Answer-Completion Fix

## Highlights

- Removes the Netbrowse Voice 300-token ceiling from each OpenAI Realtime
  response and uses the provider-managed maximum response allowance.
- Prevents the local application from ending longer spoken answers at roughly
  30 seconds or in the middle of a sentence.
- Keeps the existing configurable 5-to-30-second caller-silence check
  unchanged.
- Clarifies in the administrator interface that the silence timer starts only
  after AI playback finishes and does not limit answer length.
- Adds regression tests for both settings so response length and caller silence
  remain independent.

## Compatibility

This is a focused, migration-free update over v0.32.5. It does not change the
database schema, Asterisk dialplan, saved AI receptionist settings, SIP trunks,
extensions, customer records or billing data. The supported clean-install
platform remains Ubuntu Server 26.04 amd64.

OpenAI still enforces the selected Realtime model's own maximum response size.
Netbrowse Voice no longer applies the earlier 300-token application limit.

## Validation

- TypeScript typecheck passed for API, web and Module SDK.
- Production API, web and Module SDK builds passed.
- 129 API tests passed.
- `git diff --check` passed.

## Release assets

Attach both files to the GitHub Release:

- `netbrowse-voice-0.32.6.tar.gz`
- `netbrowse-voice-0.32.6.tar.gz.sha256`

Create them from the clean, committed release branch:

```bash
cd ~
cd ~/netbrowse-voice-publish
bash scripts/create-release-archive.sh
```

The files are created in `~/netbrowse-voice-publish/release/`. Upload both to
the `v0.32.6` GitHub Release and verify the public download using
[INSTALL.md](../INSTALL.md).
