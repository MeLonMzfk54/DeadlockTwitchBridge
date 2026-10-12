/** Allowed item class_name characters for cfg (Deadlock mod class ids). */
const CLS_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Sanitize Assets API / Panorama class_name for cfg and vote options. */
export function sanitizeHelpClassName(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s === "0" || s === "-") return null;
  if (!CLS_RE.test(s)) return null;
  return s;
}
