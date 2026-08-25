-- Labels are tenant-owned organizing metadata. They never alter the agent's
-- prompt and therefore remain safe to expose in the administration console.
CREATE TABLE studio_conversation_labels (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 48),
  color text NOT NULL DEFAULT 'blue' CHECK (color IN ('blue','cyan','purple','gold','green','red','gray')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);
CREATE TABLE studio_conversation_label_links (
  conversation_id uuid NOT NULL REFERENCES studio_conversations(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES studio_conversation_labels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(conversation_id, label_id)
);
CREATE INDEX studio_conversation_label_links_label_idx
  ON studio_conversation_label_links(label_id, conversation_id);
