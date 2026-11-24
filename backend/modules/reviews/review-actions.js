// ALTEGO necesita resolver la edición y eliminación autorizada de reseñas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {requireUser} from '../accounts/auth.js';
import {reviewError,id} from '../../core/validation.js';
import {withSocialPair,assertSocialInteractionAllowed} from '../social/social-blocks.js';
import {staffRole,adminError} from '../administration/admin-audit.js';
import {removeContent} from '../administration/moderation-content.js';
import {attachCommunityReports} from '../conversations/community-reporting.js';
import {reviewActionsReady} from "../../infrastructure/schema/readiness.js";
import {findReview,reviewTarget,reviewHidden} from './review-moderation.js';
import {randomUUID} from 'node:crypto';
export function reviewCapabilities(viewer,review,ready=true){const own=!!viewer&&viewer.id===review.user_id;return {can_edit:ready&&own,can_delete:ready&&!!viewer&&(own||staffRole(viewer.role)),can_report:ready&&!!viewer&&!own};}
export function installReviewActions(app,pool,mongo,{visible,project}){
 const reviews=mongo.collection('resenas');
 const route=(method,suffix,run)=>app[method]('/api/reviews/:reviewId'+suffix,requireUser,async(req,res,next)=>{
  res.set('Cache-Control','private, no-store').vary('Cookie');try{
   if(!await reviewActionsReady(pool))throw adminError(503,'Review actions are not available yet.');
   const original=await findReview(mongo,req.params.reviewId);if(!original)throw adminError(404,'Review not found.');
   const [[owner]]=Number.isSafeInteger(original.user_id)?await pool.execute('SELECT id FROM users WHERE id=?',[original.user_id]):[[]];
   const result=await withSocialPair(pool,req,owner?.id??req.user.id,async sql=>{
    const [[actor]]=await sql.execute('SELECT id,role,username FROM users WHERE id=?',[req.user.id]);if(!actor)throw adminError(401,'Your session has expired.');
    const review=await findReview(mongo,req.params.reviewId);if(!review)throw adminError(404,'Review not found.');
    if(review.user_id!==original.user_id||review.producto_id!==original.producto_id)throw adminError(409,'The review reference changed.');
    const [[product]]=await sql.execute('SELECT * FROM productos WHERE id=?',[id(review.producto_id)]);
    if(!product||!visible(req,product))throw adminError(404,'Review not found.');
    return run(req,sql,actor,review,product);
   });
   if(result===null)return res.status(204).end();res.status(method==='post'?201:200).json(result);
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message,code:error.code});next(error);}
 });
 route('put','',async(req,sql,actor,review,product)=>{
  if(actor.id!==review.user_id)throw adminError(403,'Only the author can edit this review.');
  if(review.deleted_at||await reviewHidden(sql,review))throw adminError(409,'This review is no longer available for editing.');
  const body=req.body||{};if(Object.keys(body).some(k=>!['rating','comment','revision'].includes(k)))throw adminError(400,'Only the rating and comment may be edited.');
  const error=reviewError({product_id:product.id,author:actor.username,rating:body.rating,comment:body.comment});if(error)throw adminError(400,error);
  if(!Number.isSafeInteger(body.revision)||body.revision<0)throw adminError(400,'Include the review revision.');
  if(body.revision!==(review.revision??0))throw adminError(409,'This review changed. Reload it before editing.');
  if(product.owner_id)await assertSocialInteractionAllowed(sql,actor.id,product.owner_id);
  if(review.calificacion===body.rating&&review.comentario===body.comment.trim())return project(sql,review,actor);
  const updated=await reviews.findOneAndUpdate({_id:review._id,user_id:actor.id,deleted_at:{$exists:false},...(review.revision===undefined?{revision:{$exists:false}}:{revision:body.revision})},{$set:{calificacion:body.rating,comentario:body.comment.trim(),edited_at:new Date()},$inc:{revision:1}},{returnDocument:'after'});
  if(!updated)throw adminError(409,'This review changed. Reload it before editing.');return project(sql,updated,actor);
 });
 route('delete','',async(req,sql,actor,review)=>{
  const body=req.body||{};if(body.confirm!==true||Object.keys(body).some(k=>!['confirm','reason','explanation'].includes(k)))throw adminError(400,'Confirm the review deletion.');
  const own=review.user_id===actor.id;if(!own&&!staffRole(actor.role))throw adminError(403,'You cannot delete this review.');
  if(own){if(!review.deleted_at)await reviews.updateOne({_id:review._id,user_id:actor.id,deleted_at:{$exists:false}},{$set:{deleted_at:new Date(),deleted_by:actor.id},$inc:{revision:1}});}
  else{const target=await reviewTarget(sql,review);if(!await reviewHidden(sql,review))await removeContent(sql,actor,'review',target.id,{confirm:true,reason:body.reason||'other',explanation:body.explanation});}
  return null;
 });
 route('post','/report',async(req,sql,actor,review)=>{
  if(actor.id===review.user_id)throw adminError(403,'You cannot report your own review.');
  if(review.deleted_at||await reviewHidden(sql,review))throw adminError(404,'Review not found.');
  const body=req.body||{};if(!['harassment','hate_speech','spam','inappropriate','violence','other'].includes(body.reason)||Object.keys(body).some(k=>!['reason','description'].includes(k))||body.description!==undefined&&(typeof body.description!=='string'||body.description.length>500))throw adminError(400,'Choose a report reason and use up to 500 characters for details.');
  const [[reviewAuthor]]=Number.isSafeInteger(review.user_id)?await sql.execute('SELECT id FROM users WHERE id=?',[review.user_id]):[[]];if(reviewAuthor)await assertSocialInteractionAllowed(sql,actor.id,review.user_id);
  const target=await reviewTarget(sql,review);
  try{await sql.execute("INSERT INTO conversation_reports(public_id,reporter_id,content_type,target_id,reason,explanation) VALUES (?,?,'review',?,?,?)",[randomUUID(),actor.id,target.id,body.reason,body.description?.trim()||null]);}catch(error){if(error.code==='ER_DUP_ENTRY')throw adminError(409,'You already have an active report for this review.');throw error;}
  await attachCommunityReports(sql,{type:'review',targetId:target.id,publicId:String(review._id),ownerId:target.author_id});return {submitted:true};
 });
}
