import crypto from "node:crypto";
import { z } from "zod";
import {
  AppError,
  NotFoundError,
  offsetOf,
  pageResult,
  paginationSchema,
  type Page,
} from "./domain.js";
import { query, transaction } from "./db.js";

export const studioConversationStatusSchema = z.enum([
  "active",
  "archived",
  "deleted",
]);
export const studioMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export const studioMessageStatusSchema = z.enum([
  "pending",
  "streaming",
  "completed",
  "failed",
  "cancelled",
]);

export const createStudioConversationSchema = z.object({
  tenantId: z.string().uuid(),
  agentSlug: z.string().trim().min(2).max(120),
  title: z.string().trim().min(1).max(160).optional(),
});
export const updateStudioConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    status: studioConversationStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "至少提供一个更新字段。");
export const appendStudioMessageSchema = z.object({
  role: studioMessageRoleSchema,
  content: z.string().trim().min(1).max(50_000),
  status: studioMessageStatusSchema.default("completed"),
  taskId: z.string().trim().max(200).optional(),
  errorCode: z.string().trim().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  clientRequestId: z.string().uuid().optional(),
});
export const updateStudioMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(50_000).optional(),
    status: studioMessageStatusSchema.optional(),
    taskId: z.string().trim().max(200).nullable().optional(),
    errorCode: z.string().trim().max(120).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "至少提供一个更新字段。");
export const studioConversationQuerySchema = paginationSchema.extend({
  tenantId: z.string().uuid(),
  agentSlug: z.string().trim().min(2).max(120).optional(),
  status: studioConversationStatusSchema.optional(),
  search: z.string().trim().max(160).optional(),
  labelId: z.string().uuid().optional(),
});
export const createStudioLabelSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().trim().min(1).max(48),
  color: z
    .enum(["blue", "cyan", "purple", "gold", "green", "red", "gray"])
    .default("blue"),
});
export const replaceStudioConversationLabelsSchema = z.object({
  labelIds: z.array(z.string().uuid()).max(12),
});
export const forkStudioConversationSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  throughSequence: z.number().int().min(0).optional(),
});
export const studioMessageFeedbackSchema = z.object({
  rating: z.union([z.literal(-1), z.literal(1)]),
  note: z.string().trim().max(2_000).optional(),
});

type ConversationRow = {
  id: string;
  tenant_id: string;
  agent_slug: string;
  title: string;
  title_is_auto: boolean;
  status: "active" | "archived" | "deleted";
  last_task_id: string | null;
  message_count: number;
  last_message_at: Date | null;
  archived_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  preview: string | null;
};
type MessageRow = {
  id: string;
  conversation_id: string;
  sequence: number;
  role: "user" | "assistant" | "system";
  content: string;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  task_id: string | null;
  error_code: string | null;
  metadata: Record<string, unknown>;
  client_request_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type StudioConversation = {
  id: string;
  tenantId: string;
  agentSlug: string;
  title: string;
  status: ConversationRow["status"];
  lastTaskId?: string;
  messageCount: number;
  lastMessageAt?: string;
  archivedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  preview?: string;
  labels?: StudioLabel[];
};
export type StudioLabel = {
  id: string;
  tenantId: string;
  name: string;
  color: "blue" | "cyan" | "purple" | "gold" | "green" | "red" | "gray";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type StudioMessage = {
  id: string;
  conversationId: string;
  sequence: number;
  role: MessageRow["role"];
  content: string;
  status: MessageRow["status"];
  taskId?: string;
  errorCode?: string;
  metadata: Record<string, unknown>;
  clientRequestId?: string;
  createdAt: string;
  updatedAt: string;
};
export type StudioConversationDetail = StudioConversation & {
  messages: StudioMessage[];
};
export type StudioConversationEvent = {
  id: number;
  conversationId: string;
  actorId: string;
  kind: string;
  messageId?: string;
  detail: Record<string, unknown>;
  createdAt: string;
};
export type StudioMessageFeedback = {
  messageId: string;
  rating: -1 | 1;
  note?: string;
  updatedAt: string;
};
export type StudioMessageRevision = {
  id: string;
  messageId: string;
  revision: number;
  content: string;
  editedBy: string;
  createdAt: string;
};

const conversationSelect = `SELECT c.*,
  (SELECT m.content FROM studio_messages m WHERE m.conversation_id=c.id ORDER BY m.sequence DESC LIMIT 1) AS preview
  FROM studio_conversations c`;
const mapConversation = (row: ConversationRow): StudioConversation => ({
  id: row.id,
  tenantId: row.tenant_id,
  agentSlug: row.agent_slug,
  title: row.title,
  status: row.status,
  lastTaskId: row.last_task_id ?? undefined,
  messageCount: Number(row.message_count),
  lastMessageAt: row.last_message_at?.toISOString(),
  archivedAt: row.archived_at?.toISOString(),
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  preview: row.preview?.replace(/\s+/g, " ").slice(0, 200),
});
const mapMessage = (row: MessageRow): StudioMessage => ({
  id: row.id,
  conversationId: row.conversation_id,
  sequence: row.sequence,
  role: row.role,
  content: row.content,
  status: row.status,
  taskId: row.task_id ?? undefined,
  errorCode: row.error_code ?? undefined,
  metadata: row.metadata ?? {},
  clientRequestId: row.client_request_id ?? undefined,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
const mapLabel = (row: {
  id: string;
  tenant_id: string;
  name: string;
  color: StudioLabel["color"];
  created_by: string;
  created_at: Date;
  updated_at: Date;
}): StudioLabel => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  color: row.color,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
const titleFor = (value: string) =>
  value.trim().replace(/\s+/g, " ").slice(0, 160) || "新对话";

async function writeConversationEvent(
  conversationId: string,
  tenantId: string,
  actorId: string,
  kind: string,
  detail: Record<string, unknown> = {},
  messageId?: string,
) {
  await query(
    `INSERT INTO studio_conversation_events(conversation_id,tenant_id,actor_id,kind,message_id,detail)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      conversationId,
      tenantId,
      actorId,
      kind,
      messageId ?? null,
      JSON.stringify(detail),
    ],
  );
}

export async function createStudioConversation(
  raw: unknown,
  actorId: string,
): Promise<StudioConversation> {
  const input = createStudioConversationSchema.parse(raw);
  const id = crypto.randomUUID();
  const rows = await query<ConversationRow>(
    `${conversationSelect} WHERE c.id=$1`,
    [id],
  );
  if (rows[0])
    throw new AppError(
      409,
      "STUDIO_CONVERSATION_CONFLICT",
      "会话 ID 冲突，请重试。",
    );
  const inserted = await query<ConversationRow>(
    `INSERT INTO studio_conversations(id,tenant_id,agent_slug,title,title_is_auto,created_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *,NULL::text AS preview`,
    [
      id,
      input.tenantId,
      input.agentSlug,
      titleFor(input.title ?? "新对话"),
      input.title === undefined,
      actorId,
    ],
  );
  const conversation = mapConversation(inserted[0]);
  await writeConversationEvent(
    conversation.id,
    conversation.tenantId,
    actorId,
    "conversation_created",
    { agentSlug: conversation.agentSlug, title: conversation.title },
  );
  return conversation;
}

export async function searchStudioConversations(
  raw: unknown,
): Promise<Page<StudioConversation>> {
  const input = studioConversationQuerySchema.parse(raw);
  const values: unknown[] = [input.tenantId];
  const clauses = ["c.tenant_id=$1"];
  const add = (clause: string, value: unknown) => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  if (input.agentSlug) add("c.agent_slug=?", input.agentSlug);
  if (input.labelId)
    add(
      "EXISTS (SELECT 1 FROM studio_conversation_label_links sll WHERE sll.conversation_id=c.id AND sll.label_id=?)",
      input.labelId,
    );
  if (input.status) add("c.status=?", input.status);
  else clauses.push("c.status <> 'deleted'");
  if (input.search) {
    values.push(`%${input.search}%`);
    const titleParam = values.length;
    values.push(`%${input.search}%`);
    const messageParam = values.length;
    clauses.push(
      `(c.title ILIKE $${titleParam} OR EXISTS (SELECT 1 FROM studio_messages sm WHERE sm.conversation_id=c.id AND sm.content ILIKE $${messageParam}))`,
    );
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = await query<{ count: string }>(
    `SELECT count(*) FROM studio_conversations c ${where}`,
    values,
  );
  const paged = [...values, input.pageSize, offsetOf(input)];
  const rows = await query<ConversationRow>(
    `${conversationSelect} ${where} ORDER BY COALESCE(c.last_message_at,c.created_at) DESC LIMIT $${paged.length - 1} OFFSET $${paged.length}`,
    paged,
  );
  return pageResult(rows.map(mapConversation), Number(total[0].count), input);
}

export async function getStudioConversation(
  id: string,
  tenantId: string,
): Promise<StudioConversationDetail> {
  const conversations = await query<ConversationRow>(
    `${conversationSelect} WHERE c.id=$1 AND c.tenant_id=$2`,
    [id, tenantId],
  );
  if (!conversations[0]) throw new NotFoundError("会话", id);
  const messages = await query<MessageRow>(
    "SELECT * FROM studio_messages WHERE conversation_id=$1 ORDER BY sequence",
    [id],
  );
  const labels = await listConversationLabels(id, tenantId);
  return {
    ...mapConversation(conversations[0]),
    messages: messages.map(mapMessage),
    labels,
  };
}

export async function listStudioLabels(
  tenantId: string,
): Promise<StudioLabel[]> {
  const rows = await query<{
    id: string;
    tenant_id: string;
    name: string;
    color: StudioLabel["color"];
    created_by: string;
    created_at: Date;
    updated_at: Date;
  }>(
    "SELECT * FROM studio_conversation_labels WHERE tenant_id=$1 ORDER BY name",
    [tenantId],
  );
  return rows.map(mapLabel);
}

export async function createStudioLabel(
  raw: unknown,
  actorId: string,
): Promise<StudioLabel> {
  const input = createStudioLabelSchema.parse(raw);
  const rows = await query<{
    id: string;
    tenant_id: string;
    name: string;
    color: StudioLabel["color"];
    created_by: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO studio_conversation_labels(id,tenant_id,name,color,created_by)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [crypto.randomUUID(), input.tenantId, input.name, input.color, actorId],
  );
  return mapLabel(rows[0]);
}

export async function deleteStudioLabel(id: string, tenantId: string) {
  const rows = await query<{ id: string }>(
    "DELETE FROM studio_conversation_labels WHERE id=$1 AND tenant_id=$2 RETURNING id",
    [id, tenantId],
  );
  if (!rows[0]) throw new NotFoundError("会话标签", id);
}

export async function listConversationLabels(
  conversationId: string,
  tenantId: string,
): Promise<StudioLabel[]> {
  const rows = await query<{
    id: string;
    tenant_id: string;
    name: string;
    color: StudioLabel["color"];
    created_by: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT l.* FROM studio_conversation_labels l
     JOIN studio_conversation_label_links link ON link.label_id=l.id
     JOIN studio_conversations c ON c.id=link.conversation_id
     WHERE link.conversation_id=$1 AND c.tenant_id=$2 ORDER BY l.name`,
    [conversationId, tenantId],
  );
  return rows.map(mapLabel);
}

export async function replaceStudioConversationLabels(
  conversationId: string,
  tenantId: string,
  raw: unknown,
  actorId: string,
): Promise<StudioLabel[]> {
  const input = replaceStudioConversationLabelsSchema.parse(raw);
  return transaction(async (client) => {
    const conversation = await client.query<{ id: string }>(
      "SELECT id FROM studio_conversations WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
      [conversationId, tenantId],
    );
    if (!conversation.rows[0]) throw new NotFoundError("会话", conversationId);
    if (input.labelIds.length) {
      const labels = await client.query<{ id: string }>(
        "SELECT id FROM studio_conversation_labels WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
        [tenantId, input.labelIds],
      );
      if (labels.rows.length !== input.labelIds.length)
        throw new AppError(
          400,
          "STUDIO_LABEL_TENANT_MISMATCH",
          "标签不属于当前租户。",
        );
    }
    await client.query(
      "DELETE FROM studio_conversation_label_links WHERE conversation_id=$1",
      [conversationId],
    );
    for (const labelId of input.labelIds) {
      await client.query(
        "INSERT INTO studio_conversation_label_links(conversation_id,label_id) VALUES($1,$2)",
        [conversationId, labelId],
      );
    }
    await client.query(
      `INSERT INTO studio_conversation_events(conversation_id,tenant_id,actor_id,kind,detail)
       VALUES($1,$2,$3,'conversation_labeled',$4)`,
      [
        conversationId,
        tenantId,
        actorId,
        JSON.stringify({ labelIds: input.labelIds }),
      ],
    );
    const labels = await client.query<{
      id: string;
      tenant_id: string;
      name: string;
      color: StudioLabel["color"];
      created_by: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT l.* FROM studio_conversation_labels l
       JOIN studio_conversation_label_links link ON link.label_id=l.id WHERE link.conversation_id=$1 ORDER BY l.name`,
      [conversationId],
    );
    return labels.rows.map(mapLabel);
  });
}

export async function updateStudioConversation(
  id: string,
  tenantId: string,
  raw: unknown,
  actorId = "system",
): Promise<StudioConversation> {
  const input = updateStudioConversationSchema.parse(raw);
  const rows = await query<ConversationRow>(
    `UPDATE studio_conversations SET
    title=COALESCE($3,title), title_is_auto=CASE WHEN $3 IS NULL THEN title_is_auto ELSE false END, status=COALESCE($4,status), archived_at=CASE WHEN $4='archived' THEN now() WHEN $4='active' THEN NULL ELSE archived_at END, updated_at=now()
    WHERE id=$1 AND tenant_id=$2 RETURNING *,NULL::text AS preview`,
    [
      id,
      tenantId,
      input.title ? titleFor(input.title) : null,
      input.status ?? null,
    ],
  );
  if (!rows[0]) throw new NotFoundError("会话", id);
  const conversation = mapConversation(rows[0]);
  const kind = input.status
    ? input.status === "archived"
      ? "conversation_archived"
      : input.status === "active"
        ? "conversation_restored"
        : "conversation_deleted"
    : "conversation_renamed";
  await writeConversationEvent(id, tenantId, actorId, kind, {
    title: conversation.title,
    status: conversation.status,
  });
  return conversation;
}

export async function appendStudioMessage(
  conversationId: string,
  tenantId: string,
  raw: unknown,
  actorId = "system",
): Promise<StudioMessage> {
  const input = appendStudioMessageSchema.parse(raw);
  return transaction(async (client) => {
    const conversation = await client.query<
      Pick<ConversationRow, "id" | "status" | "title_is_auto">
    >(
      "SELECT id,status,title_is_auto FROM studio_conversations WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
      [conversationId, tenantId],
    );
    if (!conversation.rows[0]) throw new NotFoundError("会话", conversationId);
    if (conversation.rows[0].status === "deleted")
      throw new AppError(
        409,
        "STUDIO_CONVERSATION_DELETED",
        "已删除的会话不能追加消息。",
      );
    if (input.clientRequestId) {
      const existing = await client.query<MessageRow>(
        `SELECT * FROM studio_messages
         WHERE conversation_id=$1 AND client_request_id=$2`,
        [conversationId, input.clientRequestId],
      );
      if (existing.rows[0]) return mapMessage(existing.rows[0]);
    }
    const sequence = await client.query<{ next: number }>(
      "SELECT COALESCE(max(sequence),0)+1 AS next FROM studio_messages WHERE conversation_id=$1",
      [conversationId],
    );
    const inserted = await client.query<MessageRow>(
      `INSERT INTO studio_messages(id,conversation_id,sequence,role,content,status,task_id,error_code,metadata,client_request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        crypto.randomUUID(),
        conversationId,
        sequence.rows[0].next,
        input.role,
        input.content,
        input.status,
        input.taskId ?? null,
        input.errorCode ?? null,
        JSON.stringify(input.metadata),
        input.clientRequestId ?? null,
      ],
    );
    await client.query(
      `UPDATE studio_conversations SET
      title=CASE WHEN message_count=0 AND $2='user' AND title_is_auto THEN $3 ELSE title END,
      title_is_auto=CASE WHEN message_count=0 AND $2='user' AND title_is_auto THEN false ELSE title_is_auto END,
      message_count=message_count+1,last_message_at=now(),last_task_id=COALESCE($4,last_task_id),updated_at=now() WHERE id=$1`,
      [
        conversationId,
        input.role,
        titleFor(input.content),
        input.taskId ?? null,
      ],
    );
    const message = mapMessage(inserted.rows[0]);
    await client.query(
      `INSERT INTO studio_conversation_events(conversation_id,tenant_id,actor_id,kind,message_id,detail)
       VALUES($1,$2,$3,'message_created',$4,$5)`,
      [
        conversationId,
        tenantId,
        actorId,
        message.id,
        JSON.stringify({ role: message.role, status: message.status }),
      ],
    );
    return message;
  });
}

export async function updateStudioMessage(
  conversationId: string,
  messageId: string,
  tenantId: string,
  raw: unknown,
  actorId = "system",
): Promise<StudioMessage> {
  const input = updateStudioMessageSchema.parse(raw);
  return transaction(async (client) => {
    const existing = await client.query<MessageRow>(
      `SELECT m.* FROM studio_messages m JOIN studio_conversations c ON c.id=m.conversation_id
       WHERE m.id=$1 AND m.conversation_id=$2 AND c.tenant_id=$3 FOR UPDATE`,
      [messageId, conversationId, tenantId],
    );
    if (!existing.rows[0]) throw new NotFoundError("消息", messageId);
    if (
      input.content !== undefined &&
      input.content !== existing.rows[0].content
    ) {
      const revision = await client.query<{ next: number }>(
        "SELECT COALESCE(max(revision),0)+1 AS next FROM studio_message_revisions WHERE message_id=$1",
        [messageId],
      );
      await client.query(
        `INSERT INTO studio_message_revisions(id,conversation_id,message_id,revision,content,edited_by)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          crypto.randomUUID(),
          conversationId,
          messageId,
          revision.rows[0].next,
          existing.rows[0].content,
          actorId,
        ],
      );
    }
    const values = [
      input.content ?? existing.rows[0].content,
      input.status ?? existing.rows[0].status,
      input.taskId === undefined ? existing.rows[0].task_id : input.taskId,
      input.errorCode === undefined
        ? existing.rows[0].error_code
        : input.errorCode,
      input.metadata === undefined
        ? JSON.stringify(existing.rows[0].metadata ?? {})
        : JSON.stringify(input.metadata),
      messageId,
    ];
    const updated = await client.query<MessageRow>(
      `UPDATE studio_messages SET content=$1,status=$2,task_id=$3,error_code=$4,metadata=$5,updated_at=now()
       WHERE id=$6 RETURNING *`,
      values,
    );
    const message = mapMessage(updated.rows[0]);
    await client.query(
      `INSERT INTO studio_conversation_events(conversation_id,tenant_id,actor_id,kind,message_id,detail)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        conversationId,
        tenantId,
        actorId,
        message.status === "cancelled"
          ? "message_cancelled"
          : "message_updated",
        messageId,
        JSON.stringify({
          status: message.status,
          edited: input.content !== undefined,
        }),
      ],
    );
    return message;
  });
}

export async function forkStudioConversation(
  conversationId: string,
  tenantId: string,
  raw: unknown,
  actorId: string,
): Promise<StudioConversationDetail> {
  const input = forkStudioConversationSchema.parse(raw);
  return transaction(async (client) => {
    const source = await client.query<ConversationRow>(
      "SELECT *,NULL::text AS preview FROM studio_conversations WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
      [conversationId, tenantId],
    );
    if (!source.rows[0]) throw new NotFoundError("会话", conversationId);
    const copied = await client.query<MessageRow>(
      `SELECT * FROM studio_messages WHERE conversation_id=$1
       ${input.throughSequence !== undefined ? "AND sequence <= $2" : ""} ORDER BY sequence`,
      input.throughSequence !== undefined
        ? [conversationId, input.throughSequence]
        : [conversationId],
    );
    const id = crypto.randomUUID();
    const title = titleFor(input.title ?? `${source.rows[0].title}（分支）`);
    const inserted = await client.query<ConversationRow>(
      `INSERT INTO studio_conversations(id,tenant_id,agent_slug,title,title_is_auto,created_by,message_count,last_message_at,last_task_id)
       VALUES($1,$2,$3,$4,false,$5,$6,CASE WHEN $6 > 0 THEN now() ELSE NULL END,$7)
       RETURNING *,NULL::text AS preview`,
      [
        id,
        tenantId,
        source.rows[0].agent_slug,
        title,
        actorId,
        copied.rows.length,
        copied.rows.at(-1)?.task_id ?? null,
      ],
    );
    const forkedMessages: MessageRow[] = [];
    for (const item of copied.rows) {
      const copiedMessage = await client.query<MessageRow>(
        `INSERT INTO studio_messages(id,conversation_id,sequence,role,content,status,task_id,error_code,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          crypto.randomUUID(),
          id,
          item.sequence,
          item.role,
          item.content,
          item.status,
          item.task_id,
          item.error_code,
          JSON.stringify(item.metadata ?? {}),
        ],
      );
      const forkedMessage = copiedMessage.rows[0];
      forkedMessages.push(forkedMessage);

      // Message edits are part of the conversation's explainability record.
      // A branch receives new message identities, so copy revisions onto the
      // corresponding new identity instead of silently losing edit history.
      const revisions = await client.query<{
        revision: number;
        content: string;
        edited_by: string;
        created_at: Date;
      }>(
        `SELECT revision,content,edited_by,created_at
         FROM studio_message_revisions
         WHERE conversation_id=$1 AND message_id=$2
         ORDER BY revision`,
        [conversationId, item.id],
      );
      for (const revision of revisions.rows) {
        await client.query(
          `INSERT INTO studio_message_revisions(
             id,conversation_id,message_id,revision,content,edited_by,created_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            crypto.randomUUID(),
            id,
            forkedMessage.id,
            revision.revision,
            revision.content,
            revision.edited_by,
            revision.created_at,
          ],
        );
      }
    }
    await client.query(
      `INSERT INTO studio_conversation_events(conversation_id,tenant_id,actor_id,kind,detail)
       VALUES($1,$2,$3,'conversation_forked',$4)`,
      [
        id,
        tenantId,
        actorId,
        JSON.stringify({ sourceConversationId: conversationId }),
      ],
    );
    return {
      ...mapConversation(inserted.rows[0]),
      messages: forkedMessages.map(mapMessage),
    };
  });
}

export async function recordStudioMessageFeedback(
  conversationId: string,
  messageId: string,
  tenantId: string,
  raw: unknown,
  actorId: string,
): Promise<StudioMessageFeedback> {
  const input = studioMessageFeedbackSchema.parse(raw);
  const rows = await query<{
    message_id: string;
    rating: -1 | 1;
    note: string | null;
    updated_at: Date;
  }>(
    `INSERT INTO studio_message_feedback(message_id,conversation_id,tenant_id,actor_id,rating,note)
     SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS(
       SELECT 1 FROM studio_messages m JOIN studio_conversations c ON c.id=m.conversation_id
       WHERE m.id=$1 AND m.conversation_id=$2 AND c.tenant_id=$3
     )
     ON CONFLICT(message_id) DO UPDATE SET rating=EXCLUDED.rating,note=EXCLUDED.note,actor_id=EXCLUDED.actor_id,updated_at=now()
     RETURNING message_id,rating,note,updated_at`,
    [
      messageId,
      conversationId,
      tenantId,
      actorId,
      input.rating,
      input.note ?? null,
    ],
  );
  if (!rows[0]) throw new NotFoundError("消息", messageId);
  await writeConversationEvent(
    conversationId,
    tenantId,
    actorId,
    "feedback_recorded",
    { rating: input.rating },
    messageId,
  );
  return {
    messageId: rows[0].message_id,
    rating: rows[0].rating,
    note: rows[0].note ?? undefined,
    updatedAt: rows[0].updated_at.toISOString(),
  };
}

export async function listStudioConversationEvents(
  conversationId: string,
  tenantId: string,
): Promise<StudioConversationEvent[]> {
  const rows = await query<{
    id: number;
    conversation_id: string;
    actor_id: string;
    kind: string;
    message_id: string | null;
    detail: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT e.* FROM studio_conversation_events e JOIN studio_conversations c ON c.id=e.conversation_id
     WHERE e.conversation_id=$1 AND c.tenant_id=$2 ORDER BY e.created_at DESC LIMIT 200`,
    [conversationId, tenantId],
  );
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    actorId: row.actor_id,
    kind: row.kind,
    messageId: row.message_id ?? undefined,
    detail: row.detail ?? {},
    createdAt: row.created_at.toISOString(),
  }));
}

export async function listStudioMessageRevisions(
  conversationId: string,
  messageId: string,
  tenantId: string,
): Promise<StudioMessageRevision[]> {
  const rows = await query<{
    id: string;
    message_id: string;
    revision: number;
    content: string;
    edited_by: string;
    created_at: Date;
  }>(
    `SELECT r.* FROM studio_message_revisions r
     JOIN studio_conversations c ON c.id=r.conversation_id
     WHERE r.conversation_id=$1 AND r.message_id=$2 AND c.tenant_id=$3
     ORDER BY r.revision DESC`,
    [conversationId, messageId, tenantId],
  );
  return rows.map((row) => ({
    id: row.id,
    messageId: row.message_id,
    revision: row.revision,
    content: row.content,
    editedBy: row.edited_by,
    createdAt: row.created_at.toISOString(),
  }));
}
