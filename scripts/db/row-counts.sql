-- Exact row counts for every table in the public schema, one "table count"
-- per line, sorted. Used to prove a restored backup holds what was dumped
-- (ROADMAP 13.6, docs/DATABASE.md).
SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.' || quote_ident(table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY 1;
