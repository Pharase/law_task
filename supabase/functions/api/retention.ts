// Retention (spec "Retention: backup before delete"): files are due after 365 days and deleted only once backed up.
export const RETENTION_DAYS = 365;

type F = { created_at: string; backed_up_at: string | null; deleted_at: string | null };

export const cutoff = (now: Date) => new Date(now.getTime() - RETENTION_DAYS * 864e5);

export const isDue = (f: F, now: Date): boolean => !f.deleted_at && new Date(f.created_at) < cutoff(now);

export const isDeletable = (f: F, now: Date): boolean => isDue(f, now) && !!f.backed_up_at;
