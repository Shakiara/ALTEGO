// ALTEGO necesita resolver la visibilidad autorizada de conversaciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {moderationMigration} from "../../infrastructure/schema/readiness.js";
import {blockError} from '../social/social-blocks.js';

export async function moderationReady(sql) {
  const [[marker]] = await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [moderationMigration]);
  return Boolean(marker);
}

export function visiblePost(alias) {
  return 'NOT EXISTS (SELECT 1 FROM conversation_hidden_posts hidden WHERE hidden.post_id='+alias+'.id)';
}

export async function postVisibility(sql, alias) {
  return await moderationReady(sql) ? visiblePost(alias) : 'TRUE';
}

export const publicComment = `c.hidden_at IS NULL AND (c.root_id IS NULL OR EXISTS
  (SELECT 1 FROM conversation_comments root WHERE root.id=c.root_id AND root.hidden_at IS NULL))`;

export const missingConversation = () => blockError(404, 'CONVERSATION_NOT_FOUND', 'Content not found.');

export async function readConversation(pool, operation) {
  const sql = await pool.getConnection();
  try {
    await sql.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const result = await operation(sql);
    await sql.commit();
    return result;
  } catch (error) {
    await sql.rollback();
    throw error;
  } finally {
    sql.release();
  }
}
