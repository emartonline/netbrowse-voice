# Netbrowse Voice

> **One system. Every call.**

Netbrowse Voice is an AI-assisted, multi-tenant communications platform for
building PBX, IVR, contact-centre and customer operations from one Ubuntu
server. The project is prepared for hackathon demonstration with a focused
walkthrough, architecture overview and judging notes in
[HACKATHON.md](HACKATHON.md).

Netbrowse Voice is a modular PBX and intelligent communications platform built
around Asterisk. The Core provides extensions, trunks, routing, health,
authentication, module management and the event foundation. AI reception,
campaign dialling, billing and contact-centre functions are
installed as independent modules.

The 0.32.3 hackathon release provides:

- a first-run administrator setup flow;
- a responsive operations dashboard;
- PostgreSQL-backed users, sessions, modules and audit records;
- PBX extension creation, deletion and SIP password rotation;
- AES-256-GCM encryption for SIP credentials at rest;
- generated PJSIP endpoints, AoRs, authentication and internal dial routes;
- live registered, unregistered and unreachable device status from Asterisk;
- local voicemail with encrypted mailbox PINs and MWI configuration;
- ring timeout, DND, call waiting, pickup groups and internal call forwarding;
- provider-neutral SIP trunks using registration, digest credentials without
  registration, or trusted source IP authentication;
- optional registration Contact-header usernames for provider interoperability,
  including Callcentric;
- UDP/TCP provider transport, optional SIP From identity, multiple trusted
  inbound networks and encrypted provider secrets;
- per-trunk E.164 plus removal and carrier dial-prefix preparation for the
  controlled outbound dialer;
- administrator-managed outbound routes that publish exact 8-to-15-digit
  access-code patterns for registered extensions;
- optional provider-authorized caller ID, bounded ring timeout and safe
  enable/disable controls for each outbound route;
- live outbound registration status from Asterisk;
- provider-isolated inbound contexts and exact DID routing to extensions or IVRs;
- a real-time Live Calls dashboard refreshed directly from Asterisk channels;
- durable PostgreSQL call detail records for answered, missed, busy and failed calls;
- searchable call history with direction, ring time and billable conversation time;
- opt-in automatic call recording for individual extensions;
- authenticated WAV playback, downloads and permanent deletion;
- configurable 7, 30, 90 or 365-day retention, with a keep-forever option;
- an active Sound Studio module with encrypted OpenAI, Google Gemini and ElevenLabs provider configuration;
- AI voice, tone, speed and pronunciation direction controls;
- automatic mono 8 kHz, 16-bit PCM conversion into Asterisk's sound library;
- authenticated sound preview, WAV download, safe identifiers and deletion;
- an active IVR Builder using approved Sound Studio greetings;
- internal IVR test numbers, digit-to-extension routes and configurable timeout fallback;
- an OpenAI Realtime full-duplex AI Receptionist with caller interruption;
- provider-selectable Google and ElevenLabs turn-based alternatives;
- mandatory provider-generated natural AI disclosure, approved greetings and private caller audio;
- business-knowledge conversations of up to 100 turns with optional transcript storage;
- validated human handoff to an active PBX extension and internal test numbers;
- a spoken conversation-limit notice followed by automatic transfer to the
  configured human handoff extension (or a polite close when no handoff exists);
- an active Call Centre Core with Asterisk-native ring groups and call queues;
- ring-all, round-robin and least-recent distribution with bounded wait, retry
  and agent wrap-up controls;
- live member registration readiness, controlled fallback routing and AI
  receptionist handoff to an enabled team destination, with uninterrupted
  music on hold when an AI call enters a queue;
- a live queue supervision console with waiting callers, longest wait, answered,
  abandoned, average-hold and service-level statistics;
- persistent per-queue agent sign-in, sign-out, pause, resume and pause-reason
  controls that survive Asterisk and application restarts;
- extension-bound agent login accounts with independently resettable passwords;
- strict owner/administrator and agent authorization boundaries across every
  control-plane API;
- a dedicated Agent Workspace with phone registration, queue availability,
  waiting callers, current-call state and daily personal call totals;
- an active Campaigns control plane with draft, ready, running, paused,
  completed and archived workflow states;
- human-queue or AI-receptionist assignment, optional outbound trunk and
  verified E.164 caller-ID preparation;
- bounded pacing, concurrency, attempt, retry and local calling-window rules;
- CSV-style E.164 contact import with header support, validation and duplicate
  detection;
- a global do-not-call suppression list that immediately blocks matching
  contacts across every campaign;
- a live Asterisk campaign worker with strict call-file validation, selected
  calling days and hours, bounded concurrency and per-minute pacing;
- answered-call delivery to a human queue or AI receptionist, automatic retry
  scheduling, result tracking and immediate prevention of new calls on pause;
- an active Billing module with one provider cost deck per SIP trunk;
- independent administrator-managed customer rate cards that are never tied to
  or exposed as provider cost decks;
- separate provider-cost and customer-price CSV imports with longest-prefix
  matching, billing increments and minimum chargeable duration;
- automatic rating of answered outbound CDRs with duplicate protection by
  linked call identifier;
- exact outbound Asterisk dial-status capture, with provider failures separated
  from genuinely unanswered calls and shown as zero-cost Billing activity;
- immutable call-charge snapshots, per-currency daily/monthly totals and live
  provider-cost, revenue and margin reporting;
- administrator-managed customer organisations with prepaid or postpaid
  billing profiles, public account numbers and isolated portal credentials;
- administrator-managed customer service plans with extension, DID, recording,
  AI-receptionist and campaign allowances;
- an administrator DID Store for publishing provider numbers with customer
  setup and recurring monthly prices;
- a tenant-isolated customer number marketplace with extension selection,
  plan allowance checks and atomic number allocation;
- immediate prepaid wallet or postpaid credit charging, immutable purchase
  ledger entries and automatic monthly DID renewals;
- PayPal sandbox-first prepaid wallet top-ups, with browser-safe public client
  configuration, owner-only encrypted gateway settings in Billing, server-side
  Orders API credentials and a verified capture before an immutable wallet
  credit is written;
- idempotent PayPal capture handling that binds every order, capture and wallet
  transaction to the authenticated customer account;
- automatic inbound-route suspension when renewal credit is unavailable and
  restoration after a successful renewal;
- non-overlapping extension number ranges and tenant self-service provisioning
  with plan quotas, one-time SIP credentials and live Asterisk application;
- tenant-owned extension controls for voicemail, DND, call waiting, recording,
  forwarding, ring timeout and SIP password rotation;
- a tenant-isolated recording archive with authenticated playback, downloads,
  deletion, search, retention visibility and per-plan storage usage;
- automatic recording shutdown when a customer exhausts its plan storage
  allowance, with re-enablement blocked until storage is available;
- explicit customer-portal availability reasons when a plan, quota, number
  range or optional feature prevents an action;
- an administrator-assigned customer rate card for each customer, with currency
  validation and outbound blocking when transparent customer pricing is absent;
- explicit standard-business and wholesale/reseller customer types, with
  customer-perspective rate terminology in each private portal;
- a wholesale reseller workspace for creating isolated client organisations,
  private portal administrators and suspendable client accounts;
- reseller-delegated extension, DID and recording allowances that cannot exceed
  the reseller's own plan, including concurrency-safe allocation checks;
- non-overlapping client extension sub-ranges constrained to the reseller's
  administrator-assigned master range, with reserved numbers excluded;
- child login isolation that also closes when either the client or its parent
  reseller is suspended;
- reseller-controlled white-label identity with a safe raster logo, business
  name, portal title, primary/accent colours and public support details;
- a dedicated branded login address restricted to the reseller and its child
  accounts, with automatic brand inheritance inside every child portal;
- reseller-branded customer invoice PDFs while provider cost and platform
  administration remain private;
- exclusive extension and DID tenant assignments, customer-scoped call history,
  rated usage, wallet balances and append-only wallet transaction ledgers;
- real-time outbound customer authorization, automatic rated-call wallet
  deductions and prepaid/postpaid credit exhaustion blocking;
- active customer-portal navigation for account, services, call activity,
  customer rates, itemised rated calls and wallet-ledger sections;
- tenant-safe pricing APIs that expose customer rates, billing increments and
  immutable charges without exposing provider costs or reseller margins;
- customer invoice creation for zero-usage or rated-call periods, immutable
  call line items, downloadable CSV statements and audited postpaid payments;
- automatic role-based login routing that prevents customer accounts from
  opening administrator or agent APIs and interfaces;
- automatic installation and absolute-path configuration of Asterisk WAV
  music on hold;
- a narrow root-owned Asterisk apply helper with strict configuration validation;
- Redis and Asterisk readiness checks;
- an Ubuntu 26.04 bootstrap installer;
- deterministic file-based voicemail module selection on Ubuntu 26.04;
- a hardened systemd service and Nginx configuration;
- the initial module manifest SDK.

## PayPal wallet top-ups

PayPal is an optional **prepaid wallet top-up** method. It is intentionally not
used for one-off DID checkout: customers add credit first, then the existing
wallet rules purchase DIDs and pay for call usage. The browser receives only a
public PayPal client ID. The PayPal secret remains in the root-owned server
environment file, and Netbrowse Voice credits a wallet only after its server
captures and verifies the exact PayPal payment amount and currency.

The feature is disabled after installation. The organisation owner can open
**Billing → PayPal Sandbox** and enter the Sandbox Client ID, secret and wallet
top-up limits. The secret is AES-256-GCM encrypted before it is stored, is never
shown again in the GUI, and is available only to the owner-controlled API. The
server environment variables remain a headless fallback until those GUI settings
are saved.

An authorised PayPal Business account owner must supply sandbox credentials for
a demo; this release deliberately keeps live payments unavailable. PayPal's
standard Orders currency list does not include ZAR, so a ZAR wallet will
correctly display as unavailable; use a PayPal-supported customer currency such
as USD for the sandbox demo, or add a local payment gateway for ZAR later. See
PayPal's [Orders API](https://developer.paypal.com/docs/api/orders/sdk/v2/) and
[currency reference](https://developer.paypal.com/reference/currency-codes/).

On the server, edit the environment file and then restart only the API:

```bash
cd ~
sudoedit /etc/netbrowse-voice/netbrowse-voice.env
```

Add the sandbox values supplied by the authorised account owner:

```text
NBVOICE_PAYPAL_MODE=sandbox
NBVOICE_PAYPAL_CLIENT_ID=your_sandbox_client_id
NBVOICE_PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
NBVOICE_PAYPAL_MINIMUM_TOPUP=5
NBVOICE_PAYPAL_MAXIMUM_TOPUP=10000
```

```bash
cd ~
sudo systemctl restart nbvoice-api
sudo nbvoice status
```

Sign in as a **prepaid** customer whose account currency is supported by PayPal,
open **Wallet ledger**, enter an amount and select **Continue to PayPal**. A
successful sandbox capture creates one immutable `topup` ledger entry and
updates the wallet balance. This hackathon scope does not yet include PayPal
webhooks, refunds, disputes, subscriptions or automatic invoice collection;
those must be added before treating it as a production payments deployment.

## Development installation

Copy the release archive to a clean Ubuntu VM, extract it, and run:

```bash
cd ~
sudo bash installer/install.sh
```

The installer is intentionally idempotent. Running it again updates the source,
rebuilds the applications, reruns safe migrations and restarts the services.
Existing administrator accounts, database data and installation credentials are
preserved during an upgrade.

When installation finishes, open the displayed address and create the first
administrator. No default administrator password is created.

Open **PBX Core**, create an extension and save the one-time SIP password. A SIP
phone can then register to the server address on port 5060 using UDP. The
extension number is the SIP username.

Open an extension's **Services** screen to enable voicemail and call handling.
Dial `*97` from an extension to open its mailbox, or `*98` to choose a mailbox.

Open **PBX Core → SIP trunks** to add a provider, then use **Inbound DIDs** to
route the exact number received from that provider to an extension or active
IVR menu. Existing routes can be edited without deleting the provider number.
Inbound DID testing can wait until provider credentials and a number are available.
Choose **Credentials · no registration** for providers that authenticate SIP
requests but do not expect REGISTER, or **Trusted source IP** for a fully
IP-authenticated interconnect. Multiple inbound provider addresses can be
entered with commas. Leave the carrier dial prefix blank unless the provider
explicitly supplies one.

To let extensions call through a provider, open **PBX Core → Outbound routes**,
select the trunk and choose a 1-to-4-digit access prefix such as `9`. With a
prefix of `9`, an extension calls a South African number by dialling `9`, then
country code `27`, then the national number without its leading zero. Only
8-to-15-digit international destinations match the generated dialplan. Test
first with a destination number you own or control.

Open **Live Calls** and call between two extensions. Active calls appear within
two seconds. After hangup, the completed call is written to PostgreSQL and shown
in searchable history. These call records preserve the timing fields used by
the recording archive and Billing module.

To test recordings without a provider, open **PBX Core**, choose an extension's
**Services**, and enable automatic recording. Complete a call to that extension,
then open **Recordings** to play or download the WAV file. Recording is disabled
by default; enable it only after applying the notice, consent and retention
requirements that apply to your organisation.

Open **Sound Studio**, choose OpenAI, Google Gemini or ElevenLabs, then save the
provider key and enter a name and the text to speak. ElevenLabs voices are
loaded from the configured account; Google and OpenAI use their supported voice
catalogues. Netbrowse Voice converts every provider's output to Asterisk's
telephony format and stores it in the detected Asterisk data directory under
`sounds/netbrowse`. Every API key is encrypted at rest and is never returned to
the browser. Google or ElevenLabs credentials must be supplied and managed by
an authorized adult or organization account owner when their terms require it.
Generated speech must
be disclosed as AI-generated to people who hear it. Each library item displays
the safe Asterisk sound name that can later be assigned by the announcement,
queue and IVR builders.

Open **IVR Builder**, create a menu, select a Sound Studio greeting and assign
digits `0` to `9` to active extensions. Configure the input timeout, invalid
attempt limit and fallback extension, then publish the menu. Dial its internal
test number from a registered extension to verify the full flow before linking
it to an inbound DID. In **PBX Core → Inbound DIDs**, choose **IVR menu** as the
destination type and select the published menu.

Open **AI Receptionist** after configuring OpenAI, ElevenLabs or Google and
generating a greeting in Sound Studio. OpenAI Realtime is recommended for live
calls because it streams caller and assistant audio continuously and permits
natural interruption. Create an agent with an unused internal number such as
`800`, enter its business behavior and factual knowledge, and optionally choose
a human handoff extension. Dial `800` from a registered extension to test the AI
disclosure, greeting, live conversation and a request for a person. Google and
ElevenLabs remain available as turn-based alternatives. Every call plays a
local provider-independent AI disclosure before any provider request. OpenAI
audio is streamed without being written to disk; temporary turn-based caller
WAV files are deleted after processing. Transcripts are off by default and
should be enabled only when the required notice, consent and retention rules
have been applied. Connect a real DID only after internal testing is complete.
The first save of an AI receptionist generates the fixed disclosure with that
agent's selected provider and voice and stores it locally. Existing agents from
an earlier release use the local fallback until they are edited and saved once.

Open **Call Centre**, create either a ring group or queue, select its member
extensions and assign an unused internal number such as `600`. Ring groups call
all members together. Queues can distribute calls using ring-all, round-robin or
least-recent strategies while providing hold music and a maximum caller wait.
Dial the internal number to test the group, then edit an AI receptionist and
choose the enabled call group as its human handoff destination.
Queue cards refresh from Asterisk every ten seconds. Use the agent controls to
sign an extension out of a queue, pause it for a break, lunch, training or
administrative work, and resume it when ready. A paused or signed-out extension
is not offered new queue calls. Statistics shown by this development release
are the live counters maintained by the current Asterisk session.

To create agent access, remain signed in as the owner and open **Call Centre →
Agent login accounts**. Choose **Add agent login**, assign an active PBX
extension, and create a temporary password of at least twelve characters. Sign
out of the administrator account and sign in using the new agent email. The
application automatically opens the restricted Agent Workspace instead of the
control centre. Agents can sign in or out of their own queues, pause for the
approved reasons and view only calls and totals associated with their assigned
extension. They cannot access trunks, recordings, Sound Studio, AI settings or
PBX administration.

Open **Campaigns** to create an outbound draft. Assign an enabled human queue
or AI receptionist, configure conservative pacing and retry limits, and set the
local calling window and IANA timezone. Import contacts as `phone, first name,
last name, reference`, using full international E.164 numbers. Duplicate and
invalid rows are reported, while any number on the global suppression list is
stored as blocked. A campaign can be marked ready only after it has a
non-suppressed contact, an enabled trunk, a verified caller ID and the explicit
configuration confirmation. Mark the campaign ready, then choose **Start**.
The worker processes contacts only on the selected days and inside the configured
local calling window. **Pause now** prevents new calls immediately; calls already
in progress are allowed to finish and their results are recorded.

Open **Billing** and create a provider cost deck for the outbound SIP trunk.
Import provider CSV rows as `prefix, destination, cost_per_minute,
increment_seconds, minimum_seconds`. Then create one or more independent
customer rate cards and import `prefix, destination, price_per_minute,
increment_seconds, minimum_seconds`. Prefixes contain international digits
without `+`; the most specific matching prefix wins independently in both
lists. Older six-column provider imports remain accepted during migration, but
their legacy sell column is not used as customer pricing. Every outbound
attempt appears in Billing CDR activity, while only answered calls with positive
CDR conversation time and matching provider and customer rates are charged.
Failed, busy and unanswered attempts remain visible as non-chargeable zero-cost
outcomes. Each rated result stores provider cost, customer price, margin,
original seconds and rounded chargeable seconds so later changes do not alter
historical charges.

Open **Customers** to create a customer organisation and its primary portal
login. Choose whether the account is a standard business or wholesale/reseller,
select prepaid or postpaid billing, assign a same-currency customer rate card,
then assign only the extensions and inbound DID routes belonging to that
customer. The same sign-in page detects the
customer role and opens a separate Customer Portal instead of the administrator
control centre. Customer APIs use the customer identifier stored in the server
session; the browser cannot request another tenant. Answered rated calls now
post an atomic negative wallet transaction using the assigned customer selling
price. **My Rates** shows the customer-visible prefix, destination, price,
billing increment and minimum duration. **Recent rated outbound calls** shows
actual duration, rounded billable duration, the snapshotted selling rate and the
final charge. Standard customers see these as **Your Rates**; wholesale or
reseller customers see them as **Your Buying Rates**. Provider wholesale cost
and margin remain administrator-only.
Wholesale accounts also receive **Clients** and **Branding** workspaces. Use
**Clients** to create a private downstream customer login and delegate a
non-overlapping part of the reseller extension range. Use **Branding** to upload
a PNG, JPEG or WebP logo, choose the portal colours, publish support details and
copy the reseller's `/login/<brand>` address. The reseller and every child
portal inherit that identity automatically. Logos are size-limited and stored
outside the public web application; executable SVG content is not accepted.
Before an assigned extension reaches
the provider trunk, a localhost-only FastAGI authorization checks that the
customer is active, has an assigned matching customer rate in the same currency
and has remaining
prepaid balance or postpaid credit. Exhausted accounts hear a local announcement
and the blocked attempt remains visible in Billing activity.

Open **Billing → Customer invoices** and choose an inclusive service period and
due date. A customer can receive a zero-usage statement when no rated calls fall
inside that period. When calls exist, the invoice stores each one as an
immutable line item, so later rate changes cannot alter the statement. Prepaid
statements are marked paid because those calls were already deducted from the
wallet. Postpaid invoices can accept partial or full manual payments; every
payment credits the customer wallet and creates an append-only ledger entry.
Administrators and the matching customer can download a branded A4 PDF invoice
with customer details, immutable usage lines, payments, totals and page numbers.
CSV remains available as a compact accounting export. Customer sessions remain
restricted to their own invoice identifiers.

The administrator control-centre pages and customer portal sections use stable
browser routes. Refreshing `/billing` or `/portal/invoices` returns to that same
screen, and browser Back and Forward navigation restores the previous section.

## Local development

Node.js 22.12 or later is required.

```bash
npm install
npm run build
```

Run the API and web development servers in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

See [docs/architecture.md](docs/architecture.md) for boundaries and the planned
module contract.
