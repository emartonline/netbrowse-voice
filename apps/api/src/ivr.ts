export interface IvrMenuConfigRow {
  id: string;
  name: string;
  extension_number: string;
  greeting_asterisk_name: string;
  timeout_seconds: number;
  max_attempts: number;
  fallback_extension_number: string | null;
  enabled: boolean;
}

export interface IvrOptionConfigRow {
  ivr_menu_id: string;
  digit: string;
  destination_extension_number: string;
}

export function ivrContextName(id: string): string {
  const compact = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) throw new Error("Invalid IVR identifier");
  return `nbvoice-ivr-${compact}`;
}

export function renderIvrInternalRoutes(rows: IvrMenuConfigRow[]): string[] {
  const lines: string[] = [];
  for (const row of rows.filter((item) => item.enabled)) {
    lines.push(
      `exten => ${row.extension_number},1,NoOp(Netbrowse Voice IVR ${row.extension_number})`,
      ` same => n,Goto(${ivrContextName(row.id)},s,1)`,
      "",
    );
  }
  return lines;
}

export function renderIvrContexts(
  rows: IvrMenuConfigRow[],
  options: IvrOptionConfigRow[],
): string[] {
  const lines: string[] = [];
  const optionsByMenu = new Map<string, IvrOptionConfigRow[]>();
  for (const option of options) {
    const items = optionsByMenu.get(option.ivr_menu_id) ?? [];
    items.push(option);
    optionsByMenu.set(option.ivr_menu_id, items);
  }
  for (const row of rows.filter((item) => item.enabled)) {
    const menuOptions = (optionsByMenu.get(row.id) ?? [])
      .slice()
      .sort((left, right) => left.digit.localeCompare(right.digit));
    lines.push(
      `[${ivrContextName(row.id)}]`,
      `exten => s,1,NoOp(Netbrowse Voice IVR ${row.extension_number})`,
      " same => n,Answer()",
      " same => n,Wait(1)",
      " same => n,Set(NBVOICE_IVR_ATTEMPTS=0)",
      ` same => n(start),Read(NBVOICE_IVR_DIGIT,${row.greeting_asterisk_name},1,,1,${row.timeout_seconds})`,
      ' same => n,GotoIf($["${NBVOICE_IVR_DIGIT}"=""]?timeout)',
      ...menuOptions.map((option) => (
        ` same => n,GotoIf($["\${NBVOICE_IVR_DIGIT}"="${option.digit}"]?option-${option.digit})`
      )),
      ' same => n,Set(NBVOICE_IVR_ATTEMPTS=$[${NBVOICE_IVR_ATTEMPTS}+1])',
      " same => n,Playback(pbx-invalid)",
      ` same => n,GotoIf($[\${NBVOICE_IVR_ATTEMPTS}<${row.max_attempts}]?start:fallback)`,
      " same => n(timeout),Goto(fallback)",
      ...menuOptions.map((option) => (
        ` same => n(option-${option.digit}),Goto(nbvoice-internal,${option.destination_extension_number},1)`
      )),
      ...(row.fallback_extension_number
        ? [` same => n(fallback),Goto(nbvoice-internal,${row.fallback_extension_number},1)`]
        : [" same => n(fallback),Hangup()"]),
      "",
    );
  }
  return lines;
}
