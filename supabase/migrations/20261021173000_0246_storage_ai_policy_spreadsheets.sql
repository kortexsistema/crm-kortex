-- Migration 0246: Permite upload de planilhas (.csv, .xlsx) no bucket ai-policy
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'text/markdown',
  'text/x-markdown',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
]
where id = 'ai-policy';
