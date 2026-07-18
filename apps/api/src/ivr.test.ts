import assert from "node:assert/strict";
import test from "node:test";
import {
  ivrContextName,
  renderIvrContexts,
  renderIvrInternalRoutes,
  type IvrMenuConfigRow,
  type IvrOptionConfigRow,
} from "./ivr.js";

const menu: IvrMenuConfigRow = {
  id: "b4c26e30-c36a-428e-9ed8-7d1d678b0fa1",
  name: "Main Menu",
  extension_number: "700",
  greeting_asterisk_name: "netbrowse/nbvs-main-menu-b4c26e30",
  timeout_seconds: 7,
  max_attempts: 3,
  fallback_extension_number: "102",
  enabled: true,
};

const options: IvrOptionConfigRow[] = [
  { ivr_menu_id: menu.id, digit: "2", destination_extension_number: "102" },
  { ivr_menu_id: menu.id, digit: "1", destination_extension_number: "100" },
];

test("IVR context identifiers contain only fixed safe characters", () => {
  assert.equal(
    ivrContextName(menu.id),
    "nbvoice-ivr-b4c26e30c36a428e9ed87d1d678b0fa1",
  );
  assert.throws(() => ivrContextName("../../unsafe"), /Invalid IVR identifier/);
});

test("IVR renderer creates an internal test number and digit routes", () => {
  const config = [...renderIvrInternalRoutes([menu]), ...renderIvrContexts([menu], options)].join("\n");
  assert.match(config, /exten => 700,1,NoOp\(Netbrowse Voice IVR 700\)/);
  assert.match(config, /Goto\(nbvoice-ivr-b4c26e30c36a428e9ed87d1d678b0fa1,s,1\)/);
  assert.match(config, /Read\(NBVOICE_IVR_DIGIT,netbrowse\/nbvs-main-menu-b4c26e30,1,,1,7\)/);
  assert.match(config, /NBVOICE_IVR_DIGIT\}"="1"\]\?option-1/);
  assert.match(config, /n\(option-1\),Goto\(nbvoice-internal,100,1\)/);
  assert.match(config, /n\(option-2\),Goto\(nbvoice-internal,102,1\)/);
  assert.ok(config.indexOf("option-1") < config.indexOf("option-2"));
  assert.match(config, /n\(fallback\),Goto\(nbvoice-internal,102,1\)/);
});

test("disabled IVRs are not rendered and a missing fallback hangs up", () => {
  assert.deepEqual(renderIvrInternalRoutes([{ ...menu, enabled: false }]), []);
  const config = renderIvrContexts([{ ...menu, fallback_extension_number: null }], options).join("\n");
  assert.match(config, /n\(fallback\),Hangup\(\)/);
});
