-- The browser may retry a request after a disconnect while the original write
-- already committed. A client operation id prevents duplicate user turns.
ALTER TABLE studio_messages
  ADD COLUMN client_request_id uuid;
CREATE UNIQUE INDEX studio_messages_conversation_client_request_idx
  ON studio_messages(conversation_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
