#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../templates/nbvoice-asterisk-apply
source "${SCRIPT_DIR}/../templates/nbvoice-asterisk-apply"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT
PJSIP_SOURCE="${TEST_ROOT}/pjsip_extensions.conf"
DIALPLAN_SOURCE="${TEST_ROOT}/extensions_internal.conf"
VOICEMAIL_SOURCE="${TEST_ROOT}/voicemail_netbrowse.conf"
TRUNK_SOURCE="${TEST_ROOT}/pjsip_trunks.conf"
INBOUND_SOURCE="${TEST_ROOT}/extensions_inbound.conf"
OUTBOUND_SOURCE="${TEST_ROOT}/extensions_outbound.conf"
CAMPAIGN_SOURCE="${TEST_ROOT}/extensions_campaigns.conf"
QUEUES_SOURCE="${TEST_ROOT}/queues_netbrowse.conf"

write_valid_pjsip() {
  printf '%s\n' \
    '; Managed by Netbrowse Voice.' \
    '' \
    '[nbvoice-transport-udp]' \
    'type=transport' \
    'protocol=udp' \
    'bind=0.0.0.0:5060' \
    '' \
    '[nbvoice-transport-tcp]' \
    'type=transport' \
    'protocol=tcp' \
    'bind=0.0.0.0:5060' \
    '' \
    '[1001]' \
    'type=endpoint' \
    'context=nbvoice-internal' \
    'disallow=all' \
    'allow=ulaw,alaw,g722' \
    'auth=1001-auth' \
    'aors=1001' \
    'callerid="Michael'"'"'s Phone" <1001>' \
    'direct_media=no' \
    'rtp_symmetric=yes' \
    'force_rport=yes' \
    'rewrite_contact=yes' \
    'mailboxes=1001@nbvoice' \
    'device_state_busy_at=1' \
    'call_group=2' \
    'pickup_group=2' \
    '' \
    '[1001-auth]' \
    'type=auth' \
    'auth_type=userpass' \
    'username=1001' \
    'password=abcdefghijklmnopqrstuvwx' \
    '' \
    '[1001]' \
    'type=aor' \
    'max_contacts=1' \
    'remove_existing=yes' \
    'qualify_frequency=60' > "${PJSIP_SOURCE}"
}

write_valid_dialplan() {
  printf '%s\n' \
    '; Managed by Netbrowse Voice.' \
    '' \
    '[nbvoice-internal]' \
    'exten => *97,1,NoOp(Netbrowse Voice own voicemail access)' \
    ' same => n,VoiceMailMain(${CALLERID(num)}@nbvoice)' \
    ' same => n,Hangup()' \
    '' \
    'exten => *98,1,NoOp(Netbrowse Voice mailbox access)' \
    ' same => n,VoiceMailMain(@nbvoice)' \
    ' same => n,Hangup()' \
    '' \
    'exten => *8,1,NoOp(Netbrowse Voice group call pickup)' \
    ' same => n,Pickup()' \
    ' same => n,Hangup()' \
    '' \
    'exten => 1001,hint,PJSIP/1001' \
    'exten => 1001,1,NoOp(Netbrowse Voice call to 1001)' \
    ' same => n,GotoIf($["${DEVICE_STATE(PJSIP/1001)}"="BUSY"]?busy)' \
    ' same => n,Set(NBVOICE_CONTACTS=${PJSIP_DIAL_CONTACTS(1001)})' \
    ' same => n,GotoIf($["${NBVOICE_CONTACTS}"=""]?unavailable)' \
    ' same => n,Set(NBVOICE_RECORDING=nbv-${UNIQUEID}.wav)' \
    ' same => n,Set(CDR(userfield)=nbvoice-recording:${NBVOICE_RECORDING})' \
    ' same => n,MixMonitor(/var/lib/netbrowse-voice/recordings/${NBVOICE_RECORDING},b)' \
    ' same => n,Dial(${NBVOICE_CONTACTS},25)' \
    ' same => n,StopMixMonitor()' \
    ' same => n,GotoIf($["${DIALSTATUS}"="BUSY"]?busy)' \
    ' same => n,GotoIf($["${DIALSTATUS}"="ANSWER"]?done:unavailable)' \
    ' same => n(unavailable),VoiceMail(1001@nbvoice,u)' \
    ' same => n,Hangup()' \
    ' same => n(busy),VoiceMail(1001@nbvoice,b)' \
    ' same => n,Hangup()' \
    ' same => n(done),Hangup()' \
    '' \
    'exten => 800,1,NoOp(Netbrowse Voice AI receptionist 800)' \
    ' same => n,Answer()' \
    ' same => n,AGI(agi://127.0.0.1:4573/agent/cda43e55-6388-40d8-a373-a3a8ca09ce5b)' \
    ' same => n,Hangup()' \
    '' \
    'exten => 801,1,NoOp(Netbrowse Voice AI receptionist 801)' \
    ' same => n,Answer()' \
    ' same => n,Playback(netbrowse/nbvs-ai-disclosure-48c577ef)' \
    ' same => n,Playback(netbrowse/nbvs-main-greeting-cda43e55)' \
    ' same => n,Set(NBVOICE_AI_CALL_ID=${UUID()})' \
    ' same => n,AGI(agi://127.0.0.1:4573/stream/cda43e55-6388-40d8-a373-a3a8ca09ce5b/${NBVOICE_AI_CALL_ID})' \
    ' same => n,AudioSocket(${NBVOICE_AI_CALL_ID},127.0.0.1:4574)' \
    ' same => n,Hangup()' \
    '' \
    'exten => 600,1,NoOp(Netbrowse Voice call queue 600)' \
    ' same => n,Answer()' \
    ' same => n,Queue(nbvq-cda43e55638840d8a373a3a8ca09ce5b,t,,,60)' \
    ' same => n,GotoIf($["${QUEUESTATUS}"="TIMEOUT"]?fallback)' \
    ' same => n,GotoIf($["${QUEUESTATUS}"="FULL"]?fallback)' \
    ' same => n,GotoIf($["${QUEUESTATUS}"="JOINEMPTY"]?fallback)' \
    ' same => n,GotoIf($["${QUEUESTATUS}"="LEAVEEMPTY"]?fallback:done)' \
    ' same => n(fallback),Goto(1001,1)' \
    ' same => n(done),Hangup()' \
    '' \
    'exten => 601,1,NoOp(Netbrowse Voice ring group 601)' \
    ' same => n,Set(NBVOICE_GROUP_MEMBERS=PJSIP/1001&PJSIP/1002)' \
    ' same => n,Dial(${NBVOICE_GROUP_MEMBERS},15)' \
    ' same => n,GotoIf($["${DIALSTATUS}"="ANSWER"]?done:fallback)' \
    ' same => n(fallback),Playback(vm-nobodyavail)' \
    ' same => n,Hangup()' \
    ' same => n(done),Hangup()' \
    '' \
    'exten => 700,1,NoOp(Netbrowse Voice IVR 700)' \
    ' same => n,Goto(nbvoice-ivr-b4c26e30c36a428e9ed87d1d678b0fa1,s,1)' \
    '' \
    '[nbvoice-ivr-b4c26e30c36a428e9ed87d1d678b0fa1]' \
    'exten => s,1,NoOp(Netbrowse Voice IVR 700)' \
    ' same => n,Answer()' \
    ' same => n,Wait(1)' \
    ' same => n,Set(NBVOICE_IVR_ATTEMPTS=0)' \
    ' same => n(start),Read(NBVOICE_IVR_DIGIT,netbrowse/nbvs-main-menu-b4c26e30,1,,1,7)' \
    ' same => n,GotoIf($["${NBVOICE_IVR_DIGIT}"=""]?timeout)' \
    ' same => n,GotoIf($["${NBVOICE_IVR_DIGIT}"="1"]?option-1)' \
    ' same => n,Set(NBVOICE_IVR_ATTEMPTS=$[${NBVOICE_IVR_ATTEMPTS}+1])' \
    ' same => n,Playback(pbx-invalid)' \
    ' same => n,GotoIf($[${NBVOICE_IVR_ATTEMPTS}<3]?start:fallback)' \
    ' same => n(timeout),Goto(fallback)' \
    ' same => n(option-1),Goto(nbvoice-internal,1001,1)' \
    ' same => n(fallback),Goto(nbvoice-internal,1001,1)' \
    '' \
    '[nbvoice-ai-queue-handoff]' \
    'exten => 600,1,NoOp(Netbrowse Voice AI queue handoff 600)' \
    ' same => n,StartMusicOnHold(default)' \
    ' same => n,Goto(nbvoice-internal,600,1)' > "${DIALPLAN_SOURCE}"
}

write_valid_voicemail() {
  printf '%s\n' \
    '; Managed by Netbrowse Voice.' \
    '' \
    '[general]' \
    'format=wav' \
    'attach=no' \
    'maxmsg=100' \
    'maxsecs=300' \
    'minsecs=2' \
    'review=yes' \
    'operator=no' \
    'saycid=yes' \
    'envelope=yes' \
    '' \
    '[nbvoice]' \
    '1001 => 8294,Michael'"'"'s Phone' > "${VOICEMAIL_SOURCE}"
}

write_valid_trunk() {
  printf '%s\n' \
    '; Managed by Netbrowse Voice.' \
    '' \
    '[nbvt-75fc4720908b462a956728190f51470a]' \
    'type=endpoint' \
    'transport=nbvoice-transport-tcp' \
    'context=nbvt-75fc4720908b462a956728190f51470a-inbound' \
    'disallow=all' \
    'allow=ulaw,alaw,g722' \
    'aors=nbvt-75fc4720908b462a956728190f51470a-aor' \
    'direct_media=no' \
    'rtp_symmetric=yes' \
    'force_rport=yes' \
    'rewrite_contact=yes' \
    'trust_id_inbound=yes' \
    'outbound_auth=nbvt-75fc4720908b462a956728190f51470a-auth' \
    'from_user=27870001111' \
    'from_domain=voice.example.net' \
    '' \
    '[nbvt-75fc4720908b462a956728190f51470a-aor]' \
    'type=aor' \
    'contact=sip:sip.example.net:5060' \
    'qualify_frequency=60' \
    '' \
    '[nbvt-75fc4720908b462a956728190f51470a-auth]' \
    'type=auth' \
    'auth_type=userpass' \
    'username=27870001111' \
    'password=provider-secret-123' \
    '' \
    '[nbvt-75fc4720908b462a956728190f51470a-registration]' \
    'type=registration' \
    'transport=nbvoice-transport-tcp' \
    'outbound_auth=nbvt-75fc4720908b462a956728190f51470a-auth' \
    'contact_user=17770001111' \
    'server_uri=sip:sip.example.net:5060' \
    'client_uri=sip:27870001111@sip.example.net' \
    'retry_interval=60' \
    'forbidden_retry_interval=600' \
    'expiration=300' \
    'line=yes' \
    'endpoint=nbvt-75fc4720908b462a956728190f51470a' \
    '' \
    '[nbvt-75fc4720908b462a956728190f51470a-identify]' \
    'type=identify' \
    'endpoint=nbvt-75fc4720908b462a956728190f51470a' \
    'match=192.0.2.0/24' \
    'match=198.51.100.20' > "${TRUNK_SOURCE}"
}

write_valid_inbound() {
  printf '%s\n' \
    '; Managed by Netbrowse Voice.' \
    '' \
    '[nbvt-75fc4720908b462a956728190f51470a-inbound]' \
    'exten => +27115550100,1,NoOp(Netbrowse Voice inbound DID +27115550100)' \
    ' same => n,Goto(nbvoice-internal,1001,1)' \
    ' same => n,Hangup()' \
    '' \
    'exten => +27115550101,1,NoOp(Netbrowse Voice inbound DID +27115550101)' \
    ' same => n,Goto(nbvoice-ivr-b4c26e30c36a428e9ed87d1d678b0fa1,s,1)' \
    ' same => n,Hangup()' \
    '' \
    'exten => _X!,1,NoOp(Netbrowse Voice unrouted inbound number)' \
    ' same => n,Hangup()' \
    '' \
    'exten => _+X!,1,NoOp(Netbrowse Voice unrouted inbound number)' \
    ' same => n,Hangup()' > "${INBOUND_SOURCE}"
}

write_valid_outbound() {
  printf '%s\n' \
    '; Managed by Netbrowse Voice.' \
    '' \
    '[nbvoice-internal]' \
    'exten => _9XXXXXXXX,1,Goto(nbvoice-outbound-b4c26e30c36a428e9ed87d1d678b0fa1,${EXTEN:1},1)' \
    'exten => _9XXXXXXXXX,1,Goto(nbvoice-outbound-b4c26e30c36a428e9ed87d1d678b0fa1,${EXTEN:1},1)' \
    '' \
    '[nbvoice-outbound-b4c26e30c36a428e9ed87d1d678b0fa1]' \
    'exten => _X!,1,NoOp(Netbrowse Voice outbound route)' \
    ' same => n,AGI(agi://127.0.0.1:4573/billing-authorize/b4c26e30-c36a-428e-9ed8-7d1d678b0fa1/${CHANNEL(endpoint)}/${EXTEN})' \
    ' same => n,GotoIf($["${NBVOICE_BILLING_ALLOWED}"="1"]?authorized:blocked)' \
    ' same => n(blocked),Set(CDR(peeraccount)=NBVOICE:BILLING_BLOCKED)' \
    ' same => n,Playback(netbrowse/nbvoice-billing-blocked)' \
    ' same => n,Hangup()' \
    ' same => n(authorized),Set(CDR(accountcode)=${NBVOICE_BILLING_CUSTOMER_ID})' \
    ' same => n,Set(NBVOICE_OUTBOUND_DESTINATION=0011104${EXTEN})' \
    ' same => n,Set(CALLERID(num)=+27115550100)' \
    ' same => n,Dial(PJSIP/${NBVOICE_OUTBOUND_DESTINATION}@nbvt-75fc4720908b462a956728190f51470a,60)' \
    ' same => n,Set(CDR(peeraccount)=NBVOICE:${DIALSTATUS})' \
    ' same => n,Hangup()' > "${OUTBOUND_SOURCE}"
}

write_valid_campaigns() {
  printf '%s\n' \
    '; Managed by Netbrowse Voice.' \
    '' \
    '[nbvoice-campaign-originate]' \
    'exten => s,1,NoOp(Netbrowse Voice campaign call)' \
    ' same => n,Set(CALLERID(num)=${NBVOICE_CAMPAIGN_CALLER_ID})' \
    ' same => n,Dial(PJSIP/${NBVOICE_CAMPAIGN_DESTINATION}@${NBVOICE_CAMPAIGN_TRUNK},${NBVOICE_CAMPAIGN_RING_TIMEOUT})' \
    ' same => n,Set(NBVOICE_CAMPAIGN_RESULT=${DIALSTATUS})' \
    ' same => n,Set(CDR(peeraccount)=NBVOICE:${NBVOICE_CAMPAIGN_RESULT})' \
    ' same => n,AGI(agi://127.0.0.1:4573/campaign-result/${NBVOICE_CAMPAIGN_ATTEMPT_ID}/${NBVOICE_CAMPAIGN_RESULT})' \
    ' same => n,Hangup()' > "${CAMPAIGN_SOURCE}"
}

write_valid_queues() {
  printf '%s\n' \
    '; Managed by Netbrowse Voice.' \
    '' \
    '[nbvq-cda43e55638840d8a373a3a8ca09ce5b]' \
    'strategy=rrmemory' \
    'timeout=15' \
    'retry=5' \
    'wrapuptime=8' \
    'musicclass=default' \
    'joinempty=no' \
    'leavewhenempty=yes' \
    'autofill=yes' \
    'ringinuse=no' \
    'member => PJSIP/1001,0,,PJSIP/1001,no,5,no' > "${QUEUES_SOURCE}"
}

write_valid_pjsip
write_valid_dialplan
write_valid_voicemail
write_valid_trunk
write_valid_inbound
write_valid_outbound
write_valid_campaigns
write_valid_queues
validate_pjsip
validate_dialplan
validate_voicemail
validate_trunks
validate_inbound
validate_outbound
validate_campaigns
validate_queues

printf '%s\n' '[nbvoice-internal]' ' same => n,System(touch /tmp/unsafe)' > "${DIALPLAN_SOURCE}"
if (validate_dialplan >/dev/null 2>&1); then
  printf 'unsafe dialplan was accepted\n' >&2
  exit 1
fi

printf '%s\n' \
  '[nbvoice-internal]' \
  'exten => 800,1,NoOp(Netbrowse Voice AI receptionist 800)' \
  ' same => n,Answer()' \
  ' same => n,AGI(agi://192.0.2.10:4573/agent/cda43e55-6388-40d8-a373-a3a8ca09ce5b)' \
  ' same => n,Hangup()' > "${DIALPLAN_SOURCE}"
if (validate_dialplan >/dev/null 2>&1); then
  printf 'remote FastAGI target was accepted\n' >&2
  exit 1
fi

printf '%s\n' \
  '[nbvoice-internal]' \
  'exten => 801,1,NoOp(Netbrowse Voice AI receptionist 801)' \
  ' same => n,Answer()' \
  ' same => n,AudioSocket(${NBVOICE_AI_CALL_ID},192.0.2.10:4574)' \
  ' same => n,Hangup()' > "${DIALPLAN_SOURCE}"
if (validate_dialplan >/dev/null 2>&1); then
  printf 'remote AudioSocket target was accepted\n' >&2
  exit 1
fi

printf '%s\n' '#exec /tmp/unsafe' > "${PJSIP_SOURCE}"
if (validate_pjsip >/dev/null 2>&1); then
  printf 'unsafe PJSIP configuration was accepted\n' >&2
  exit 1
fi

printf '%s\n' '[nbvoice]' '1001 => 1234,Valid' 'mailcmd=touch /tmp/unsafe' > "${VOICEMAIL_SOURCE}"
if (validate_voicemail >/dev/null 2>&1); then
  printf 'unsafe voicemail configuration was accepted\n' >&2
  exit 1
fi

printf '%s\n' '[nbvt-75fc4720908b462a956728190f51470a]' 'type=endpoint' 'set_var=EVIL=yes' > "${TRUNK_SOURCE}"
if (validate_trunks >/dev/null 2>&1); then
  printf 'unsafe SIP trunk configuration was accepted\n' >&2
  exit 1
fi

printf '%s\n' '[nbvt-75fc4720908b462a956728190f51470a-inbound]' ' same => n,System(touch /tmp/unsafe)' > "${INBOUND_SOURCE}"
if (validate_inbound >/dev/null 2>&1); then
  printf 'unsafe inbound dialplan was accepted\n' >&2
  exit 1
fi

printf '%s\n' '[nbvq-cda43e55638840d8a373a3a8ca09ce5b]' 'member => Local/unsafe@system' > "${QUEUES_SOURCE}"
if (validate_queues >/dev/null 2>&1); then
  printf 'unsafe queue configuration was accepted\n' >&2
  exit 1
fi

printf 'Asterisk apply validator tests passed\n'
