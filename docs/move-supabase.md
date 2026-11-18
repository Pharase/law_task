# Moving to a new Supabase project

The web pages, the LINE OA and the Google Sheet stay as they are. Only the server (`api` function), the database and the stored files move. Plan about an hour, at a quiet time: nobody should use the app between steps 4 and 8.

Why this can't be a button in ตั้งค่า: the Settings page itself runs on Supabase. A wrong project address saved from there would lock every user out, including the admin who saved it, with no page left to fix it from.

## What changes

The project ref (the `xxxx` in `https://xxxx.supabase.co`) is written in these places:

| Where | What |
|---|---|
| `js/app.js` | `API_URL` = `https://<ref>.supabase.co/functions/v1/api` |
| `supabase/config.toml` | `project_id` |
| `.github/workflows/supabase-deploy.yml` | `PROJECT_REF` |
| Scheduled jobs (pg_cron) in the database | the URL each job calls: `cleanup-old-files`, `daily-digest`, `pending-notices` |
| LINE Developers Console → Messaging API | Webhook URL |

## Steps

1. **New project.** Create it at supabase.com (region: Singapore, the closest to Thailand). Note its ref. Under Database → Extensions, turn on `pg_cron` and `pg_net`.
2. **Secrets.** Project Settings → Edge Functions → Secrets: add `LINE_MESSAGING_TOKEN`, `LINE_CHANNEL_SECRET`, `GSHEET_URL` and `GSHEET_SECRET`, with the same values as the old project. If they were saved in the app (ตั้งค่า → Linkage), they are copied with the database in step 5 instead, but setting them here as well is a safe fallback.
3. **Point the repo at it.** Replace the old ref with the new one in `js/app.js`, `supabase/config.toml` and `.github/workflows/supabase-deploy.yml`. Make a new access token for the new account if it is a different one (`gh secret set SUPABASE_ACCESS_TOKEN`). Don't push yet.
4. **Freeze the old project.** Tell the team not to use the app for a while.
5. **Copy the database.** Push the repo changes (`main`): GitHub Actions creates every table and bucket in the new project and deploys `api`. Then copy the data, table by table, from the old project to the new one: Table Editor → table → Export to CSV in the old project, then Import data from CSV in the new one. Copy `profiles` first (other tables point to it), then `invites`, `files`, `exdoc_groups`, `exdocs`, `app_settings`, `news_reads`, `notify_log`. Skip `sheet_cache`: it refills by itself. `tasks`, `task_sends` and `buildings` are empty since the data moved to the Google Sheet. Skip them too unless they have rows.
6. **Copy the stored files.** Storage, old project → new project, same paths: buckets `uploads` (ส่งงาน files kept for a year), `exdocs` (Example Documents), `line-images` (bubble pictures). Skip `reports` and `invoice-files`: they only cache Drive files and refill by themselves. After copying `line-images`, open ตั้งค่า → รูปในข้อความ LINE and upload the two pictures again. The saved picture links still point to the old project.
7. **Scheduled jobs.** The migrations created the jobs with the **old** URL. In the new project, open SQL Editor and run this, with your new ref:

   ```sql
   select cron.schedule(j.name, j.sched, format($c$
     select net.http_post(url := 'https://%s.supabase.co/functions/v1/api',
       headers := '{"content-type": "application/json"}'::jsonb, body := '{"action": "%s"}'::jsonb);
   $c$, 'NEW_REF', j.action))
   from (values ('cleanup-old-files', '0 3 * * *', 'cleanup'),
                ('daily-digest', '5,35 * * * *', 'digest'),
                ('pending-notices', '0,30 * * * *', 'pendingNotices')) as j(name, sched, action);
   ```

   Same job names replace the old ones. Check with `select jobname, command from cron.job;`.
8. **LINE webhook.** In the app, open ตั้งค่า → การเชื่อมต่อ LINE OA, copy the new Webhook URL and paste it into LINE Developers Console → Messaging API → Webhook settings, then press Verify.
9. **Check.** Open the app from LINE: log in, open each page, press ตรวจลิงก์ Google Sheet และ Drive and ทดสอบส่ง LINE ถึงฉัน in ตั้งค่า, send a test task, approve it.
10. **Old project.** Pause it, and delete it only after a week or two without problems.

LINE user IDs stay the same (same LINE channels), so everyone keeps their account and role, as long as `profiles` was copied in step 5.
