/**
 * Sanitize text for PostgreSQL UTF-8 text columns.
 * Postgres rejects NUL bytes (0x00) in text fields (SQLSTATE 22021).
 */

/** Remove characters PostgreSQL text columns cannot store. */
export function sanitizeTextForPostgres(
  text: string | null | undefined
): string {
  if (!text) return "";
  // NUL bytes — common in PDF extractors; fatal for Postgres text columns
  let cleaned = text.replace(/\0/g, "");
  // Strip other C0 control chars except tab/newline/carriage return
  cleaned = cleaned.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return cleaned;
}

/** Sanitize optional string; preserves null/undefined. */
export function sanitizeOptionalTextForPostgres(
  text: string | null | undefined
): string | null | undefined {
  if (text == null) return text;
  return sanitizeTextForPostgres(text);
}

/** Sanitize string array fields (keywords, extractionNotes, etc.). */
export function sanitizeTextArrayForPostgres(
  values: string[] | null | undefined
): string[] {
  if (!values?.length) return [];
  return values.map((v) => sanitizeTextForPostgres(v));
}
