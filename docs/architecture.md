# Core architecture

Netbrowse Voice separates the stable PBX control plane from optional product
modules.

## Core responsibilities

- authentication, authorization and audit events;
- Asterisk node registration and health;
- module lifecycle and compatibility checks;
- configuration transactions and rollback history;
- shared events, jobs and database access;
- web navigation and permission registration.
- durable call records and authenticated recording access;

## Module responsibilities

Modules own their domain data and subscribe to Core events. A module may add API
routes, background workers, UI navigation, permissions, migrations and guarded
Asterisk configuration fragments. Modules must not edit an Asterisk-generated
file owned by another module.

Initial module keys are:

- `pbx-core`
- `sound-studio`
- `ivr-builder`
- `ai-receptionist`
- `call-centre`
- `campaigns`
- `billing`

## Deployment boundary

The initial deployment is a single Ubuntu server. Nginx serves the web build and
proxies `/api` to the local Core API. PostgreSQL stores durable state, Redis
supports live events and jobs, and Asterisk owns telephony. These components can
be separated later without changing the module contract.

## Security baseline

- no default administrator credentials;
- password hashes use Node's scrypt implementation with individual salts;
- browser sessions are random opaque tokens stored as SHA-256 hashes;
- owner and administrator sessions are authorized separately from agent and
  customer sessions. Every agent identity is bound to exactly one enabled PBX
  extension. Every customer identity is bound to one customer tenant, and the
  customer portal derives its scope exclusively from that server-side session;
- SIP passwords are protected at rest with AES-256-GCM authenticated encryption;
- the API listens on loopback behind Nginx;
- service processes run without root privileges; a strict root-owned helper is
  limited to validating and atomically applying managed Asterisk fragments;
- call recordings are stored outside the web root and streamed only after
  session authentication and safe filename validation;
- speech-provider keys use the same AES-256-GCM envelope as SIP credentials;
- generated sounds are converted to mono 8 kHz, 16-bit PCM WAV, stored in a
  setgid Asterisk-owned directory and streamed only through authenticated API
  routes;
- IVR menus reference approved sound and extension records, are rendered into
  fixed-format contexts, and pass through the same root-owned dialplan validator;
- inbound DID routes use database-constrained extension or IVR destinations;
  only active destinations are published and every generated context jump is
  checked by the strict Asterisk apply validator;
- DID marketplace purchases lock both the selected inventory row and the
  tenant wallet, verify the destination extension belongs to the authenticated
  customer, and atomically snapshot setup and renewal prices. A partial unique
  index prevents the same number from being sold twice; failed Asterisk
  provisioning reverses the assignment and wallet charge;
- recurring DID renewal charges use the same prepaid or postpaid credit floor.
  A failed renewal disables only that tenant's inbound route, while a later
  successful charge restores it through the serialized Asterisk configuration
  boundary;
- turn-based AI receptionist routes connect Asterisk to a FastAGI listener bound
  only to `127.0.0.1:4573`; OpenAI Realtime routes register the call on that
  listener and then use Asterisk AudioSocket on `127.0.0.1:4574` for continuous
  bidirectional 8 kHz audio. The strict validator accepts only these fixed local
  listeners and database-generated agent and call identifiers;
- a local disclosure and the selected greeting play before an external AI
  engine is contacted, so provider quota failures cannot suppress caller notice;
- each agent save prepares the fixed disclosure text with its selected provider
  and voice, stores the telephony WAV locally and records only its guarded
  Asterisk identifier. The installer-generated disclosure remains a mandatory
  offline fallback for older agents and provider failures during configuration;
- OpenAI Realtime audio is converted between Asterisk signed-linear PCM and
  PCMU in memory and is never written to disk. Google and ElevenLabs use short
  caller WAV files in an Asterisk-owned private runtime directory; those files
  are deleted immediately after processing. Transcript persistence is an
  explicit per-agent opt-in;
- AI output is constrained to bounded conversation and validated handoff
  actions. Human transfer targets are active extensions or enabled Call Centre
  destinations; a narrow root-owned redirect helper accepts only a local
  channel identifier and numeric internal destination. No provider key is
  exposed to Asterisk or the browser;
- reaching the configured conversation limit produces a final spoken notice,
  then redirects the live Asterisk channel to the validated handoff destination;
  agents without a handoff close the call politely instead;
- Call Centre groups store extension membership and bounded timing in
  PostgreSQL. The configuration transaction emits validated internal dialplan
  routes plus a managed `queues.conf` fragment. Ring groups use `Dial`, while
  queues use Asterisk `app_queue`; member readiness is read from PJSIP without
  treating configuration as live registration state;
- queue agent sign-in and pause state is persisted separately from membership,
  allowing group edits to retain operational state. The API renders those
  states only into fixed-format static Asterisk member fields and applies them
  through the same transactional configuration boundary;
- live queue supervision uses a dedicated root-owned, argument-free helper that
  can execute only Asterisk's read-only `queue show` command. The API parses
  bounded counters and does not expose raw CLI output to the browser;
- the Agent Workspace is built from a role-restricted snapshot containing only
  the authenticated agent's extension, queue memberships, matching live
  channels and daily CDR totals. Queue-state mutations always use the session's
  stored extension identifier; the browser cannot nominate another extension;
- Campaigns separates the outbound control plane from the privileged Asterisk
  spool. Drafts store validated human or AI destinations, provider trunk and
  caller ID, bounded pacing/retry rules, calling days, local windows and an
  explicit configuration confirmation. The unprivileged worker can write only
  fixed-format call requests to a private outbox; a root-owned, argument-free
  helper validates every directive before atomically moving a request into the
  Asterisk outgoing spool;
- campaign calls originate through a fixed managed Local-channel context. After
  answer, Asterisk connects the contact to the selected internal queue or AI
  receptionist. A localhost-only FastAGI callback records the final Dial status,
  applies retry timing and completes the campaign when no eligible contacts
  remain. Pausing prevents the worker from claiming new contacts;
- provider trunks isolate common ITSP differences in data rather than
  provider-specific code: registration, digest authentication without REGISTER,
  or IP trust; UDP/TCP transport; optional From identity; bounded inbound IP
  matches; and E.164 prefix/plus formatting. Secrets remain write-only and are
  decrypted only while rendering the root-validated Asterisk configuration;
- outbound extension routes use a unique 1-to-4-digit access prefix and emit
  exact patterns for 8 through 15 destination digits. The privileged apply
  helper validates the separately generated outbound file before publishing
  it, and route prefixes may not overlap;
- Billing reads completed PostgreSQL CDRs rather than intercepting live media.
  Managed outbound dialplans preserve the exact Asterisk `DIALSTATUS` in the
  CDR peer-account field so provider failures are not mislabeled as missed
  calls. All outbound attempts are visible in Billing activity, but only
  answered provider legs with positive conversation time can be rated. The
  selected trunk comes from managed PJSIP channel data; destination
  normalization and longest-prefix matching then produce a unique linked-call
  charge snapshot. Failed and unmatched attempts never create charges;
- customer organisations own one wallet and may exclusively claim extensions
  and DID routes through unique assignment tables. Customer portal queries do
  not accept a tenant identifier from the browser: they use the authenticated
  session's `customer_id` for service lists, CDR filters, rated usage and the
  append-only wallet ledger. Administrator endpoints reject customer roles,
  while customer endpoints reject owner, administrator and agent roles;
- customer service plans define bounded extension, DID, recording-storage, AI
  and campaign entitlements. Every tenant PBX mutation derives the customer ID
  from the authenticated session, checks the enabled plan and resource quota,
  and restricts automatic number allocation to the administrator-assigned,
  non-overlapping extension range. Forwarding targets must belong to the same
  customer and the existing cycle detector rejects loops before Asterisk is
  changed;
- customer recording queries first derive owned call identifiers from CDR legs
  involving extensions assigned to the authenticated tenant. Listing, ranged
  WAV playback, downloads and deletion then require that owned identifier and
  never accept a browser-supplied customer ID. A periodic quota guard compares
  real WAV sizes with the plan allowance and disables future MixMonitor routes
  when the allowance is exhausted; existing files are retained for customer
  export or deliberate deletion;
- provider cost decks belong to SIP trunks, while customer rate cards use an
  independent schema and may be assigned to many same-currency customers.
  Customer APIs query only customer-rate tables and immutable charge-price
  snapshots; they never select or serialize provider cost or margin columns.
  Missing customer pricing fails outbound authorization closed instead of
  silently applying an undisclosed rate;
- customer account classification is restricted to `retail` or `wholesale`.
  It changes the portal's pricing perspective only: standard businesses see
  "Your Rates", while resellers see "Your Buying Rates". Both are charged from
  the same immutable customer-price snapshot, and neither sees internal cost;
- wholesale customers may own one level of retail client tenants through
  `customers.parent_customer_id`. The reseller API always takes the parent ID
  from the authenticated session and never from a request body. Each child has
  its own customer row, wallet, delegated service plan and portal user. Child
  ranges must be contained by the reseller master range and cannot overlap a
  sibling or an already reserved PBX number. Allocated extension, DID and
  recording limits are subtracted from the reseller's plan atomically under a
  transaction-scoped allocation lock. Parent suspension invalidates child
  portal access without merging tenant data;
- one `customer_branding` row belongs to the top-level wholesale account.
  Effective branding is derived from the authenticated account's parent rather
  than a browser-supplied tenant ID, so every child inherits the reseller logo,
  colours and support identity. Branded login URLs validate that the submitted
  user belongs to that same hierarchy before creating a session. Public brand
  endpoints expose only published identity fields and validated PNG, JPEG or
  WebP bytes; provider credentials, balances and tenant data are never included.
  Invoice rendering resolves the same parent-owned profile and snapshots no
  additional customer authority;
- assigned customer extensions pass through a localhost-only FastAGI credit
  decision before an outbound provider Dial. The decision fails closed when
  the tenant, wallet, rate or currency cannot be verified. Completed rated calls
  snapshot provider-cost terms and customer-selling terms independently, then
  insert the immutable charge, lock and debit the wallet, and append the linked
  ledger transaction in one PostgreSQL transaction;
- invoices snapshot only uninvoiced rated charges belonging to the selected
  customer and currency. Invoice line items and payment rows are append-only.
  Branded PDF and CSV downloads bind the invoice lookup to the authenticated
  session customer; a guessed invoice UUID from another tenant returns no data.
  Postpaid payments update the invoice, credit the wallet and append the payment
  ledger row inside one database transaction;
- control-centre pages and customer portal sections have stable browser paths.
  The client restores the active view from the URL and uses browser history for
  navigation, while Nginx falls unknown application paths back to the SPA entry;
- contact imports accept only normalized E.164 numbers, deduplicate within the
  submitted list and campaign, and apply the global suppression table before a
  contact becomes ready. Adding a suppression also blocks matching contacts in
  every existing campaign and returns affected ready campaigns to draft review;
- module packages will require signatures before the marketplace is enabled.
