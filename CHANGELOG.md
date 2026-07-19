# Changelog

All notable Netbrowse Voice Community Edition changes are recorded here.

## v0.32.6 — OpenAI Realtime answer-completion fix

- Removes the application's 300-token ceiling from OpenAI Realtime responses so
  longer answers are no longer cut off by Netbrowse Voice mid-sentence.
- Keeps the existing caller-silence timeout unchanged and clarifies in the
  administrator interface that it begins only after AI playback finishes.
- Adds regression coverage for the provider-managed response allowance and the
  independent caller-silence timer.

## v0.32.5 — Community Edition and submission release

- Adopts GPL-3.0-or-later for the current Community Edition source and release
  archives.
- Adds licensing-transition, trademark, contribution and security guidance.
- Adds reproducible Git archive and checksum generation for GitHub releases.
- Updates the public installation instructions and hackathon submission
  runbook.

## v0.32.4 — Hackathon platform release

- Delivers the full PBX, AI voice, billing, customer and reseller feature set
  demonstrated in the hackathon.
- Adds the Callcentric registration compatibility and clean Ubuntu installer
  fixes validated during deployment.
