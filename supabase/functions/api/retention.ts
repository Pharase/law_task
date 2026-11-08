// Retention (spec "Retention: backup before delete"): files are due after 365 days and deleted only once backed up.
export const RETENTION_DAYS = 365;

type F = { created_at: string; backed_up_at: string | null; deleted_at: string | null };

export const cutoff = (now: Date) => new Date(now.getTime() - RETENTION_DAYS * 864e5);

export const isDue = (f: F, now: Date): boolean => !f.deleted_at && new Date(f.created_at) < cutoff(now);

// Grace period after a recorded backup: if the ZIP never actually saved (e.g. LINE's in-app browser
// ignored the download), the originals survive long enough to back up again.
export const BACKUP_GRACE_DAYS = 7;
export const graceCutoff = (now: Date) => new Date(now.getTime() - BACKUP_GRACE_DAYS * 864e5);

export const isDeletable = (f: F, now: Date): boolean =>
  isDue(f, now) && !!f.backed_up_at && new Date(f.backed_up_at) < graceCutoff(now);
