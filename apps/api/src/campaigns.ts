export interface ImportedContact {
  phoneE164: string;
  firstName: string;
  lastName: string;
  externalReference: string;
}

export interface ContactImportResult {
  contacts: ImportedContact[];
  invalidLines: number;
  duplicateLines: number;
  totalLines: number;
}

export function normalizeE164(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const international = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  return /^\+[1-9][0-9]{7,14}$/.test(international) ? international : null;
}

export function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) return null;
  fields.push(field.trim());
  return fields;
}

export function parseContactImport(input: string, maximum = 1_000): ContactImportResult {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const contacts: ImportedContact[] = [];
  const seen = new Set<string>();
  let invalidLines = 0;
  let duplicateLines = 0;
  let totalLines = 0;

  for (const [index, line] of lines.entries()) {
    const fields = parseCsvLine(line);
    if (index === 0 && fields?.[0] && /^(phone|phone_number|number|mobile)$/i.test(fields[0])) {
      continue;
    }
    totalLines += 1;
    if (totalLines > maximum || !fields || fields.length > 4) {
      invalidLines += 1;
      continue;
    }
    const phoneE164 = normalizeE164(fields[0] ?? "");
    if (!phoneE164) {
      invalidLines += 1;
      continue;
    }
    if (seen.has(phoneE164)) {
      duplicateLines += 1;
      continue;
    }
    seen.add(phoneE164);
    contacts.push({
      phoneE164,
      firstName: (fields[1] ?? "").slice(0, 100),
      lastName: (fields[2] ?? "").slice(0, 100),
      externalReference: (fields[3] ?? "").slice(0, 120),
    });
  }
  return { contacts, invalidLines, duplicateLines, totalLines };
}

export function validTimeZone(value: string): boolean {
  if (value.length < 1 || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
