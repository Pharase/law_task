// Example Document file types (PDF, Word, pictures, zip/rar). Pure: no Deno or npm imports. The `exdocs` bucket accepts the same mime types.
const KINDS: Record<string, { ext: string; mime: string; preview: boolean }> = {
  pdf: { ext: "pdf", mime: "application/pdf", preview: true },
  doc: { ext: "doc", mime: "application/msword", preview: false },
  docx: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", preview: false },
  jpg: { ext: "jpg", mime: "image/jpeg", preview: true },
  jpeg: { ext: "jpg", mime: "image/jpeg", preview: true },
  png: { ext: "png", mime: "image/png", preview: true },
  zip: { ext: "zip", mime: "application/zip", preview: false },
  rar: { ext: "rar", mime: "application/vnd.rar", preview: false },
};

/** Type of a file by its name; null when Example Document doesn't take it. preview = the browser can show it. */
export function fileKind(name: string): { ext: string; mime: string; preview: boolean } | null {
  const m = /\.([a-z0-9]+)$/i.exec(String(name ?? ""));
  return (m && KINDS[m[1].toLowerCase()]) || null;
}

/** A storage path this app created: <uuid>.<allowed ext>. */
export const isExDocPath = (path: string) => /^[0-9a-f-]{36}\.(pdf|docx?|jpg|png|zip|rar)$/.test(path);
