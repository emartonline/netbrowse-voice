BEGIN;

CREATE TABLE IF NOT EXISTS call_detail_records (
  id bigserial PRIMARY KEY,
  calldate timestamptz NOT NULL DEFAULT now(),
  clid varchar(80) NOT NULL DEFAULT '',
  src varchar(80) NOT NULL DEFAULT '',
  dst varchar(80) NOT NULL DEFAULT '',
  dcontext varchar(80) NOT NULL DEFAULT '',
  channel varchar(160) NOT NULL DEFAULT '',
  dstchannel varchar(160) NOT NULL DEFAULT '',
  lastapp varchar(80) NOT NULL DEFAULT '',
  lastdata varchar(255) NOT NULL DEFAULT '',
  duration integer NOT NULL DEFAULT 0,
  billsec integer NOT NULL DEFAULT 0,
  disposition varchar(45) NOT NULL DEFAULT '',
  amaflags integer NOT NULL DEFAULT 0,
  accountcode varchar(80) NOT NULL DEFAULT '',
  uniqueid varchar(150) NOT NULL DEFAULT '',
  userfield varchar(255) NOT NULL DEFAULT '',
  peeraccount varchar(80) NOT NULL DEFAULT '',
  linkedid varchar(150) NOT NULL DEFAULT '',
  sequence integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS call_detail_records_calldate_idx
  ON call_detail_records(calldate DESC);
CREATE INDEX IF NOT EXISTS call_detail_records_linkedid_idx
  ON call_detail_records(linkedid);
CREATE INDEX IF NOT EXISTS call_detail_records_src_idx
  ON call_detail_records(src);
CREATE INDEX IF NOT EXISTS call_detail_records_dst_idx
  ON call_detail_records(dst);
CREATE INDEX IF NOT EXISTS call_detail_records_disposition_idx
  ON call_detail_records(disposition);

UPDATE modules
SET version = '0.5.0',
    description = 'Asterisk control, extensions, provider trunks, live calls, CDR history and voicemail.',
    updated_at = now()
WHERE module_key = 'pbx-core';

INSERT INTO schema_migrations(version)
VALUES ('005_live_calls_cdr')
ON CONFLICT (version) DO NOTHING;

COMMIT;
