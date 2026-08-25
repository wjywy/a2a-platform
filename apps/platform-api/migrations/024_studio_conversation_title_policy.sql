-- A custom title is a user decision and must survive the first appended
-- message.  Older rows default to stable titles; new rows opt into one-time
-- automatic titling explicitly at creation time.
ALTER TABLE studio_conversations
  ADD COLUMN title_is_auto boolean NOT NULL DEFAULT false;
