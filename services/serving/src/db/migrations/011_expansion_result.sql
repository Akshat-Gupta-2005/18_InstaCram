-- Task 5.6: what a "more topics" tap actually achieved, reported through the feed.
--
-- Candidate generation runs in the background (32-54s), so the tap's own
-- response cannot say how many new topics it produced (DECISIONS 2026-09-16).
-- The feed reports it instead, from this row, and the client decides whether to
-- keep offering the action: a finished 'more' expansion that queued nothing,
-- linked nothing new and retried nothing means the field is genuinely exhausted.
--
-- `linked_existing` exists because generation is not the only way a field gains
-- content. A tap can link topics other fields already generated - new cards for
-- this field at no pipeline cost - and counting only generation would call that
-- field finished while it had just gained content.
ALTER TABLE field_expansion ADD COLUMN failed_retried  integer;
ALTER TABLE field_expansion ADD COLUMN linked_existing integer;
