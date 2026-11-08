-- Example Document: besides PDF, accept Word templates (.doc/.docx) and pictures (.jpg/.png).
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
]
where id = 'exdocs';
