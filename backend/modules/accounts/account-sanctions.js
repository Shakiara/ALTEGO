// ALTEGO necesita resolver las restricciones activas sobre las cuentas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import { adminFoundationReady } from "../../infrastructure/schema/readiness.js";

export const sanctionReasons = ['community_guidelines', 'harassment', 'spam', 'fraud', 'security', 'other'];
export const sanctionFields = `id,kind,reason,explanation,issued_at,expires_at,lifted_at,
 (lifted_at IS NULL AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(6))) AS active`;
export const activeSuspension = `kind='suspension' AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(6))`;

export async function suspensionForLogin(sql, user) {
    if (user.role === 'admin' || !await adminFoundationReady(sql)) return null;
    const [[suspension]] = await sql.execute(`SELECT id FROM account_sanctions WHERE user_id=? AND ${activeSuspension} LIMIT 1`, [user.id]);
    if (!suspension) return null;
    const [history] = await sql.execute(`SELECT ${sanctionFields} FROM account_sanctions WHERE user_id=? ORDER BY (${activeSuspension}) DESC,id DESC LIMIT 50`, [user.id]);
    return history;
}
