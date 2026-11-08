-- Example Document: also accept archives (.zip/.rar). The server sets the content type, so one mime type each is enough.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'application/zip',
  'application/vnd.rar'
]
where id = 'exdocs';
