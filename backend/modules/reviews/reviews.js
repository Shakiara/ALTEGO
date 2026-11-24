// ALTEGO necesita resolver las reseñas y calificaciones de productos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {installReviewActions,reviewCapabilities} from './review-actions.js';
import {reviewHidden} from './review-moderation.js';
import {reviewActionsReady} from "../../infrastructure/schema/readiness.js";
import {acquisitionReady} from "../../infrastructure/schema/readiness.js";
import {reviewEligibility} from '../commerce/acquisitions.js';
import {prepareReviewActivity,completeReviewActivity} from '../accounts/activity-reviews.js';
import {withSocialPair,assertSocialInteractionAllowed} from '../social/social-blocks.js';
import {ObjectId} from 'mongodb';
import {requireUser,requireAdmin} from '../accounts/auth.js';
import {visible} from '../products/products.js';
import {id,reviewError} from '../../core/validation.js';


export function publicReview(review,account){
 const anonymous=review.is_anonymous===true;
 const dto={_id:review._id,product_id:review.producto_id,author:anonymous?'Anonymous':review.author_username||review.autor,rating:review.calificacion,comment:review.comentario,created_at:review.creado_en,edited_at:review.edited_at??null,revision:review.revision??0,is_anonymous:anonymous};

 if(!anonymous&&(review.author_username||account?.username===review.autor)&&Number.isSafeInteger(review.user_id))dto.author_id=review.user_id;
 return dto;
}

export const canSeeAnonymousAuthor=(viewer,review)=>!!viewer&&(viewer.role==='admin'||viewer.id===review.user_id);
export function reviewForViewer(review,account,viewer){const dto=publicReview(review,account);if(review.is_anonymous===true&&canSeeAnonymousAuthor(viewer,review)&&account?.username&&account.id===review.user_id)dto.author_identity={id:account.id,username:account.username};return dto;}
export function verifiedReviewProjection(review,account,viewer,verifiedAuthors){return {...reviewForViewer(review,account,viewer),verified_purchase:verifiedAuthors.has(review.user_id)&&Boolean(review.author_username||account?.username===review.autor)};}
export function installReviews(app,sql,mongo){
 const reviews=mongo.collection('resenas');
 installReviewActions(app,sql,mongo,{visible,project:async(connection,review,viewer)=>{const [[account]]=Number.isSafeInteger(review.user_id)?await connection.execute('SELECT id,username FROM users WHERE id=?',[review.user_id]):[[]];const verified=new Set();if(Number.isSafeInteger(review.user_id)&&await reviewEligibility(connection,review.user_id,review.producto_id))verified.add(review.user_id);return {...verifiedReviewProjection(review,account,viewer,verified),permissions:reviewCapabilities(viewer,review)};}});
 app.get('/api/reviews',async(req,res)=>{
  res.set('Cache-Control','private, no-store');res.vary('Cookie');
  const productId=id(req.query.product_id);if(!productId)return res.status(400).json({error:'Include a valid product_id in the query.'});
  const[rows]=await sql.execute('SELECT * FROM productos WHERE id=?',[productId]);
  if(!rows.length||!visible(req,rows[0]))return res.status(404).json({error:'Product not found.'});
  let documents=await reviews.find({producto_id:productId,deleted_at:{$exists:false}}).sort({creado_en:-1}).toArray();
  const actionsReady=await reviewActionsReady(sql);if(actionsReady&&documents.length){const [hidden]=await sql.execute("SELECT t.review_id FROM review_moderation_targets t JOIN moderation_removals m ON m.entity_type='review' AND m.entity_id=t.id AND m.restored_at IS NULL WHERE t.product_id=?",[productId]);const removed=new Set(hidden.map(r=>r.review_id));documents=documents.filter(r=>!removed.has(String(r._id)));}
  const ids=[...new Set(documents.filter(r=>Number.isSafeInteger(r.user_id)&&((r.is_anonymous===true&&canSeeAnonymousAuthor(req.user,r))||(r.is_anonymous!==true&&!r.author_username))).map(r=>r.user_id))];
  const accounts=new Map();if(ids.length){const[users]=await sql.execute('SELECT id,username FROM users WHERE id IN ('+ids.map(()=>'?').join(',')+')',ids);for(const user of users)accounts.set(user.id,user);}
  const authors=[...new Set(documents.map(r=>r.user_id).filter(Number.isSafeInteger))],verified=new Set();
  if(authors.length&&await acquisitionReady(sql)){const [rights]=await sql.execute("SELECT DISTINCT a.user_id FROM acquisitions a JOIN order_items i ON i.id=a.order_item_id AND i.buyer_id=a.user_id AND i.product_id=a.product_id AND i.variant_id=a.variant_id JOIN orders o ON o.id=i.order_id AND o.buyer_id=a.user_id AND o.status='completed' WHERE a.product_id=? AND a.user_id IN ("+authors.map(()=>'?').join(',')+")",[productId,...authors]);for(const right of rights)verified.add(right.user_id);}
  res.json(documents.map(r=>({...verifiedReviewProjection(r,accounts.get(r.user_id),req.user,verified),permissions:reviewCapabilities(req.user,r,actionsReady)})));
 });
 app.post('/api/reviews',requireUser,async(req,res)=>{
  res.set('Cache-Control','private, no-store');res.vary('Cookie');
  const b=req.body||{};
  const error=reviewError({...b,author:req.user.username});if(error)return res.status(400).json({error});
  if(b.is_anonymous!==undefined&&typeof b.is_anonymous!=='boolean')return res.status(400).json({error:'Choose Public or Anonymous.'});
  const[rows]=await sql.execute('SELECT * FROM productos WHERE id=?',[id(b.product_id)]);
  if(!rows.length||!visible(req,rows[0]))return res.status(404).json({error:'Product not found.'});
  if(rows[0].status!=='Published')return res.status(409).json({error:'Only Published items accept new reviews.'});
  const review={producto_id:id(b.product_id),autor:req.user.username,author_username:req.user.username,user_id:req.user.id,is_anonymous:b.is_anonymous===true,origin:'academic_demo',verified_purchase:false,calificacion:b.rating,comentario:b.comment.trim(),creado_en:new Date()};
  const intent=await prepareReviewActivity(sql,req,rows[0],review);let saved=null;
  try{await withSocialPair(sql,req,rows[0].owner_id,async connection=>{
   await assertSocialInteractionAllowed(connection,req.user.id,rows[0].owner_id);
   review.verified_purchase=await reviewEligibility(connection,req.user.id,review.producto_id);review.origin=review.verified_purchase?'acquisition':'academic_demo';
   saved=await reviews.findOne({_id:new ObjectId(intent.review_id)});
   if(saved&&(saved.user_id!==req.user.id||saved.producto_id!==review.producto_id)){saved=null;throw Object.assign(Error('Review request conflict.'),{status:409,code:'REVIEW_REQUEST_CONFLICT'});}
   if(!saved){const document={...review,_id:new ObjectId(intent.review_id)};try{await reviews.insertOne(document);saved=document;}catch(error){saved=await reviews.findOne({_id:document._id}).catch(()=>null);if(!saved)throw error;}}
   await completeReviewActivity(connection,intent,saved);
  });}catch(error){

   if(!saved){if(error.status&&error.code)return res.status(error.status).json({error:error.message,code:error.code});throw error;}
   console.error('Review activity pending:',error.code||error.name);
  }
  if(saved.deleted_at||await reviewHidden(sql,saved))return res.status(409).json({error:'This review is no longer available.'});
  res.status(201).json({...reviewForViewer(saved,req.user,req.user),verified_purchase:await reviewEligibility(sql,req.user.id,review.producto_id),permissions:reviewCapabilities(req.user,saved,await reviewActionsReady(sql))});
 });


 app.get('/api/admin/reviews/:reviewId/identity',requireUser,requireAdmin,async(req,res)=>{
  res.set('Cache-Control','private, no-store');res.vary('Cookie');
  const value=req.params.reviewId;
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value))return res.status(400).json({error:'Invalid review identifier.'});
  const key=/^[a-f0-9]{24}$/i.test(value)?{$in:[value,new ObjectId(value)]}:value;
  const review=await reviews.findOne({_id:key});if(!review)return res.status(404).json({error:'Review not found.'});
  let account=null;if(Number.isSafeInteger(review.user_id)){const[users]=await sql.execute('SELECT id,username FROM users WHERE id=?',[review.user_id]);account=users[0]||null;}
  res.json({review_id:review._id,user_id:review.user_id??null,username:account?.username??null,stored_author:review.autor??null,is_anonymous:review.is_anonymous===true});
 });
}

