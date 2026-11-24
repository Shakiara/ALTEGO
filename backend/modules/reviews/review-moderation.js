// ALTEGO necesita resolver los reportes y la moderación de reseñas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {ObjectId} from 'mongodb';
import {reviewActionsReady} from "../../infrastructure/schema/readiness.js";
import {adminError} from '../administration/admin-audit.js';
export function reviewKey(value){if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw adminError(400,'Invalid review identifier.');return /^[a-f0-9]{24}$/i.test(value)?{$in:[value,new ObjectId(value)]}:value;}
export async function findReview(mongo,value){const docs=await mongo.collection('resenas').find({_id:reviewKey(value)}).limit(2).toArray();if(docs.length>1)throw adminError(409,'The review identity is ambiguous.');return docs[0]||null;}
export async function reviewTarget(sql,review){
 const [[account]]=Number.isSafeInteger(review.user_id)?await sql.execute('SELECT id FROM users WHERE id=?',[review.user_id]):[[]];const author=account?.id??null;
 await sql.execute('INSERT INTO review_moderation_targets(review_id,product_id,author_id,label,is_anonymous) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[String(review._id),review.producto_id,author,review.comentario.slice(0,160),review.is_anonymous===true]);
 const [[target]]=await sql.execute('SELECT * FROM review_moderation_targets WHERE BINARY review_id=BINARY ? FOR UPDATE',[String(review._id)]);
 if(!target||target.review_id!==String(review._id)||target.product_id!==review.producto_id||target.author_id!==author||Boolean(target.is_anonymous)!==(review.is_anonymous===true))throw adminError(409,'The review reference requires verification.');return target;
}
export async function reviewHidden(sql,review){if(!await reviewActionsReady(sql))return false;return Boolean((await sql.execute("SELECT m.id FROM review_moderation_targets t JOIN moderation_removals m ON m.entity_type='review' AND m.entity_id=t.id AND m.restored_at IS NULL WHERE BINARY t.review_id=BINARY ?",[String(review._id)]))[0].length);}
export function anonymousReviewHidden(target,viewer){return target?.is_anonymous&&viewer.role!=='admin'&&viewer.id!==target.author_id;}
