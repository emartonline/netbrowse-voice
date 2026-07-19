# Netbrowse Voice — Hackathon Brief

> One system. Every call.

## The problem

Small businesses, service providers and growing contact centres commonly stitch
together a PBX, IVR, call recording, AI voice tools, billing and customer
management from separate products. That makes deployment expensive, difficult
to manage and hard to resell.

## The solution

Netbrowse Voice is an AI-assisted communications platform that runs on one
Ubuntu server with Asterisk at its core. It brings PBX operations, AI
receptionists, voice generation, call queues, customer billing and multi-tenant
reseller portals into one control plane.

It is designed for an organisation to operate its own service, while customers
and resellers receive isolated portals that cannot see provider costs, platform
credentials or one another's data.

## What judges can see in the demo

1. Create or show two SIP extensions and make a live internal call.
2. Open **AI Receptionist**, call its internal test number and demonstrate a
   natural spoken response with an optional human handoff.
3. Open **Sound Studio** and **IVR Builder** to show how generated speech is
   converted to Asterisk-ready audio and used in a call flow.
4. Open **Live Calls**, **Call History** and **Recordings** to show operational
   visibility after a call completes.
5. Open **Customers** to show an isolated customer or reseller workspace,
   service allowances and white-label branding.
6. Open **DID Store** and the customer **Buy numbers** view to demonstrate
   provider inventory, customer pricing, automatic routing and recurring DID
   billing.
7. Optionally, sign in to a prepaid USD sandbox customer and open **Wallet
   ledger** to show a PayPal top-up being captured and written to the immutable
   wallet ledger.

## Technical architecture

```mermaid
flowchart TD
  Caller[Caller or SIP phone] --> Asterisk[Asterisk PBX]
  Asterisk --> Voice[Extensions, IVR, queues and recordings]
  Asterisk --> AI[AI receptionist gateway]
  AI --> Providers[OpenAI / Google / ElevenLabs]
  Asterisk --> API[Netbrowse Voice API]
  API --> DB[(PostgreSQL)]
  API --> UI[Web control centre]
  UI --> Admin[Administrator]
  UI --> Portal[Customer and reseller portals]
```

## What makes it different

- Asterisk-native telephony instead of a mock calling interface.
- AI receptionists that can answer calls and hand off to people.
- Provider-neutral AI voice generation, with OpenAI, Google and ElevenLabs
  options.
- A real multi-tenant model: administrator, agent, customer and reseller roles
  have separate authorised workspaces.
- Billing is designed into call records, rated calls, wallet controls, customer
  rate cards, invoices and recurring DID charges.
- Optional PayPal sandbox top-ups verify a completed capture on the server
  before a customer wallet is credited.
- The project is deployable through one idempotent Ubuntu installation script.

## Open-source Community Edition

The Community Edition source submitted with this release is under the
[GNU GPL v3 or later](LICENSE). It includes the PBX, AI voice, customer,
reseller, billing and installation functionality demonstrated here. The source
is public so operators and contributors can inspect, run and improve it.

Netbrowse Media (PTY) LTD may later offer independent commercial products or
hosted services, but no proprietary component is required for the demonstrated
Community Edition. Product names and logos are not granted by the GPL; see
[TRADEMARKS.md](TRADEMARKS.md). The future separation approach is described in
[docs/plugin-licensing.md](docs/plugin-licensing.md).

## Security and privacy choices

- SIP and provider secrets are encrypted at rest.
- Customer routes, recordings, calls, invoices, balances and rates are tenant
  scoped.
- Provider costs, platform credentials and other customers remain private.
- AI calls include a disclosure and bounded handoff behaviour.
- Generated Asterisk configuration passes through a narrow validation helper.
- PayPal credentials remain server-side; the wallet changes only after a
  completed capture is checked against the local amount and currency.

## Fast demo script (about 3 minutes)

1. **0:00–0:20 — Problem and dashboard**
   Explain that the platform unifies PBX, AI voice and customer operations.
   Show the health dashboard and the Quick Launch journey.
2. **0:20–0:40 — How it was built**
   Show the README's **Built with Codex and GPT-5.6** section or a concise
   development view. Explain that Codex accelerated implementation, testing
   and clean-server deployment while product decisions stayed human-directed.
3. **0:40–1:15 — A real call**
   Call an extension or the AI receptionist from a registered softphone. Show
   the AI response or IVR, then the live-call view.
4. **1:15–1:50 — Build a voice flow**
   Show a generated Sound Studio announcement and the IVR or receptionist that
   uses it.
5. **1:50–2:25 — Operate it**
   Show call history, recordings and the customer/reseller separation.
6. **2:25–2:50 — Commercial model**
   Show the DID Store, customer marketplace and wallet ledger. Do not show live
   credentials, real customer data or third-party payment screens in the video.
7. **2:50–3:00 — Close**
   End with the clean Ubuntu installation and the outcome: one deployable
   platform for live calling, AI voice and customer operations.

## Verification completed

The 0.32.6 build has passed TypeScript checks, production web/API builds, 129
API tests and all installer helper tests. The installer checks Asterisk voicemail,
recording, AudioSocket, queues, music on hold and PostgreSQL CDR support before
it reports success.

## Roadmap after the hackathon

- Customer DID cancellation, reassignment and porting workflow.
- Verified PayPal webhooks, refunds/dispute reconciliation and local payment
  gateways for currencies not supported by PayPal Orders.
- Metered or subscription-based AI receptionist billing.
- Native iPhone and Android softphone applications.
- Optional independently deployed commercial modules and managed services, with
  their licensing boundary reviewed before release.
