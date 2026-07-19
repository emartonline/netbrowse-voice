# Hackathon Submission Runbook

This document is the final preparation checklist for the Netbrowse Voice
submission. Keep the Devpost entry, public repository and demonstration video
consistent with it.

## Recommended category

Choose the closest available category to **Developer Tools**, **Infrastructure**
or **Business Software**. Netbrowse Voice is an installable communications
platform and developer-operated control plane, rather than a single-purpose
consumer application.

## Ready-to-paste project description

**Netbrowse Voice** is a deployable communications platform that brings PBX
operations, AI call handling, voice generation, IVR design, queues, recordings,
customer billing and reseller portals into one Ubuntu-hosted control plane.

Small businesses and service providers often combine separate systems for
telephony, AI voice, call analytics, billing and customer administration. That
creates operational overhead and makes the service difficult to resell.
Netbrowse Voice uses a real Asterisk PBX for extensions, SIP trunks, live calls,
voicemail, queues and recordings, while its web application adds AI
receptionists, Sound Studio announcements, routing, rated call records,
invoices, customer isolation and white-label reseller workspaces.

The project was built through a human-directed collaboration with Codex and
GPT-5.6. Codex accelerated the implementation of the TypeScript services,
database migrations, Asterisk configuration generators, installer, test suite
and interface, while product and design decisions were reviewed and directed by
the project owner. The result is a working system demonstrated with registered
SIP endpoints and a clean Ubuntu installation—not a mock telephony prototype.

## Open-source status

The public release is Netbrowse Voice Community Edition under
[GPL-3.0-or-later](../LICENSE). The current PBX, AI, billing, reseller and
installer functionality is included in that public codebase. Netbrowse Media
(PTY) LTD may later offer genuinely separate commercial products or services;
none is required for the Community Edition demonstration.

## Three-minute recording plan

Keep the finished YouTube video below three minutes. Record only synthetic test
data and your own narration; do not include copyrighted music, third-party
logos, real customer data, passwords, API keys, private phone numbers or live
payment credentials.

| Time | Screen / action | What to say |
| --- | --- | --- |
| 0:00–0:20 | Netbrowse Voice dashboard | “Businesses often need separate tools for calls, AI voice, billing and customer operations. Netbrowse Voice brings those operations into one deployable platform.” |
| 0:20–0:40 | README section: **Built with Codex and GPT-5.6** | “I directed the product scope and reviewed each milestone. Codex with GPT-5.6 accelerated the web app, Asterisk integration, testing and clean-server installer work.” |
| 0:40–1:15 | Registered softphone calling an extension or AI receptionist | “This is a real SIP call through the PBX. The assistant can answer using approved knowledge and route a caller to a human team destination.” |
| 1:15–1:50 | Sound Studio, then IVR Builder | “I can generate an announcement, convert it into PBX-ready audio and connect it to a live keypad flow without editing dialplan files manually.” |
| 1:50–2:25 | Live Calls, history, recording archive, customer/reseller portal | “Operational data is recorded live, while customer and reseller workspaces are isolated from provider costs, credentials and other tenants.” |
| 2:25–2:50 | DID Store or customer wallet / rates screen | “The commercial layer includes rate cards, rated usage, invoices and DID inventory so the platform can be operated as a service.” |
| 2:50–3:00 | `INSTALL.md`, GitHub release or final dashboard | “The project installs on a clean Ubuntu server through one release command. Netbrowse Voice turns a complex communications stack into one operating platform.” |

Before uploading, watch the full recording once with sound enabled. Cut anything
after 2:55 rather than risk exceeding the three-minute limit.

## Judge testing instructions

Use one of the following paths in the Devpost submission.

### Preferred: public demonstration instance

Provide a public `https://` URL and a temporary, non-sensitive judge account.
Use only synthetic extensions, recordings and sample data. Put the test email
and password in the Devpost testing instructions, not in the public repository.
Do not expose administrator credentials, SIP secrets, provider credentials,
PayPal credentials or a server console.

> A `192.168.x.x` VirtualBox address is private to your local network and
> cannot be used as the judge-facing demonstration URL.

### Installable test build

Also provide the public GitHub repository and the v0.32.6 GitHub Release. The
release archive, checksum and [INSTALL.md](../INSTALL.md) let a judge install
the platform on a clean Ubuntu 26.04 amd64 server without rebuilding the code.

```bash
cd ~
sudo apt-get update
sudo apt-get install -y wget
wget https://github.com/emartonline/netbrowse-voice/releases/download/v0.32.6/netbrowse-voice-0.32.6.tar.gz
wget https://github.com/emartonline/netbrowse-voice/releases/download/v0.32.6/netbrowse-voice-0.32.6.tar.gz.sha256
sha256sum -c netbrowse-voice-0.32.6.tar.gz.sha256
tar -xzf netbrowse-voice-0.32.6.tar.gz
cd ~/netbrowse-voice-0.32.6
sudo bash installer/install.sh
```

## Submission checklist

- [ ] Choose the exact Devpost category.
- [ ] Confirm the GitHub repository is public and identifies Community Edition
  as GPL-3.0-or-later in [README.md](../README.md) and [LICENSE](../LICENSE).
- [ ] Confirm [NOTICE](../NOTICE), [TRADEMARKS.md](../TRADEMARKS.md),
  [SECURITY.md](../SECURITY.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) are
  visible in the default branch.
- [ ] Confirm the v0.32.6 GitHub Release includes both the `.tar.gz` archive and
  its `.sha256` file.
- [ ] Confirm [README.md](../README.md) includes the **Built with Codex and
  GPT-5.6** section and links to the installation instructions.
- [ ] Create a public YouTube video shorter than three minutes with clear audio.
- [ ] Add the public YouTube URL to Devpost.
- [ ] Provide a working public demo URL and temporary test account, or clearly
  provide the release-based testing path required by the hackathon.
- [ ] In this primary build conversation, enter `/feedback` and copy the Codex
  Session ID into the Devpost form.
- [ ] Paste the project description above, repository URL, video URL and testing
  instructions into Devpost.
- [ ] Review every field before final submission; drafts can be changed only
  before the submission period ends.
