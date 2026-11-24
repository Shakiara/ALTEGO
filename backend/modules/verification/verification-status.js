// ALTEGO necesita resolver el estado vigente de verificación de las cuentas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {adminFoundationReady} from "../../infrastructure/schema/readiness.js";
import {verificationMigration} from "../../infrastructure/schema/readiness.js";

export async function verificationReady(sql){
  const [[row]]=await sql.execute('SELECT id FROM schema_migrations WHERE id=?',[verificationMigration]);
  return Boolean(row);
}

export async function automaticAdminIds(sql,ids){
  if(!ids.length||!await adminFoundationReady(sql))return [];
  const [admins]=await sql.query("SELECT id FROM users WHERE role='admin' AND id IN (?)",[ids]);
  return admins.map(admin=>admin.id);
}

export async function verifiedCreatorIds(sql,ids){
  const users=[...new Set(ids.filter(id=>Number.isSafeInteger(id)&&id>0))];
  if(!users.length || !await verificationReady(sql))return new Set();
  const [rows]=await sql.query('SELECT verified_user FROM creator_verification_applications WHERE verified_user IN (?)',[users]);
  return new Set([...rows.map(row=>row.verified_user),...await automaticAdminIds(sql,users)]);
}

export async function isVerifiedCreator(sql,id){
  return (await verifiedCreatorIds(sql,[id])).has(id);
}

export async function pendingPublicationReview(sql,productId){
  if(!await verificationReady(sql))return null;
  const [[review]]=await sql.execute('SELECT * FROM product_publication_reviews WHERE pending_product=?',[productId]);
  return review ?? null;
}
