# Contributing to Netbrowse Voice

Thank you for improving Netbrowse Voice Community Edition.

## Before you start

- Search existing issues and pull requests before starting similar work.
- Discuss substantial feature, architecture or security changes in an issue
  first.
- Keep changes focused and include tests or clear manual verification steps.
- Do not add passwords, API keys, phone numbers, recordings, customer data,
  database exports or private certificates to a branch, issue or pull request.

## Licence for contributions

By submitting a contribution, you confirm that you have the right to submit it
and license your original contribution under GPL-3.0-or-later, the licence of
the Community Edition. Do not submit copied code, media or documentation unless
you have the right to do so and clearly identify its licence.

## Development quality

Before opening a pull request, run the relevant checks where available:

```bash
cd ~
npm run typecheck
npm run build
```

Explain the user-visible change, how it was tested and any migration or
deployment impact. Keep Asterisk configuration generation, tenant boundaries,
credential handling and billing changes especially small and reviewable.

## Pull requests

- Use a descriptive title.
- Do not mix unrelated formatting or generated-file changes with a feature.
- Update documentation when behaviour, installation or security expectations
  change.
- Make it clear when an API is intended as a stable integration boundary.

## Brand use

Contributing code does not grant a right to use official product branding for a
fork or hosted offering. See [TRADEMARKS.md](TRADEMARKS.md).
