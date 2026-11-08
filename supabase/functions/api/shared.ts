// Shared by every handler module: service-role client, storage bucket, error helpers.
import { createClient } from "npm:@supabase/supabase-js@2";

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export const bucket = db.storage.from("uploads");

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
// No generated DB types, so results are loosely typed: `must` returns non-null data or throws.
// deno-lint-ignore no-explicit-any
export const must = ({ data, error }: { data: any; error: unknown }): any => { if (error) throw error; return data; };
export const found = <T>(row: T | null, what = "user") => { if (!row) throw new HttpError(404, `${what} not found`); return row; };

export type Me = { line_user_id: string; role: string };
