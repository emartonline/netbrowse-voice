# Security Policy

## Supported versions

Security fixes are evaluated for the current public release and the default
branch. At the time of writing, the current release line is **v0.32.6**.

## Reporting a vulnerability

Do **not** post passwords, API keys, customer records, call recordings or full
exploit details in a public GitHub issue.

Use the repository's **Security** tab and private vulnerability-reporting flow
when it is enabled. If private reporting is not available, contact a repository
owner through GitHub and share only the minimum information needed to establish
a secure reporting channel.

Include:

- a concise description and affected version;
- reproducible, non-destructive steps;
- likely impact;
- any safe mitigation you have identified; and
- a way to contact you for follow-up.

## Scope

High-priority areas include tenant isolation, authentication and session
handling, Asterisk configuration generation, encryption and credential storage,
payment and wallet integrity, recording access, call-routing authorization and
installer privilege boundaries.

## Disclosure

Please allow the maintainers reasonable time to investigate and ship a fix
before public disclosure. Do not intentionally access other users' data,
interrupt service or place chargeable external calls while testing.
