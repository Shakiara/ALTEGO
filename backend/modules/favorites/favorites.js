// ALTEGO necesita resolver las variantes guardadas como favoritas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {requireUser,requireLiveSession} from '../accounts/auth.js';
import {decorateProduct} from '../products/product-dto.js';
import {productPublicFilter} from '../administration/admin-audit.js';
import {isVerifiedCreator} from '../verification/verification-status.js';
import {validAssetId} from '../../infrastructure/storage/storage-resolver.js';
import {favoritesMigration} from "../../infrastructure/schema/readiness.js";
const fail=(status,message)=>Object.assign(Error(message),{status});
const parse=v=>typeof v==='string'?JSON.parse(v):v;
async function publicProduct(sql,productId,{lock=false}={}){
 const [rows]=await sql.execute(`SELECT p.id,p.owner_id,p.status,p.current_version_id,COALESCE(up.display_name,u.username) creator_name,c.nombre category,v.snapshot
 FROM productos p JOIN users u ON u.id=p.owner_id LEFT JOIN user_profiles up ON up.user_id=u.id JOIN product_versions v ON v.id=p.current_version_id AND v.product_id=p.id
 JOIN categorias c ON c.id=COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.snapshot,'$.category_id')),p.categoria_id)
 WHERE p.id=? AND p.status IN ('Published','Unlisted') AND p.purged_at IS NULL`+await productPublicFilter(sql)+(lock?' FOR UPDATE':''),[productId]);
 const row=rows[0];if(!row)return null;
 return decorateProduct({...parse(row.snapshot),id:row.id,owner_id:row.owner_id,creator_name:row.creator_name,category:row.category,status:row.status,current_version_id:row.current_version_id,verified_creator:await isVerifiedCreator(sql,row.owner_id)});
}
export function installFavorites(app,pool){
 const base='/api/account/favorites';
 app.use(base,requireUser,async(req,res,next)=>{
  const [rows]=await pool.execute('SELECT id FROM schema_migrations WHERE id=?',[favoritesMigration]);
  res.set('Cache-Control','no-store');
  if(!rows.length)return res.status(503).json({error:'Favorites are not available yet. Please try again later.'});next();
 });
 app.get(base+'/state',async(req,res)=>{
  const [rows]=await pool.execute('SELECT product_id,variant_id FROM product_favorites WHERE user_id=? ORDER BY id',[req.user.id]);
  res.json({items:rows});
 });
 app.get(base,async(req,res)=>{
  if(Object.keys(req.query).some(k=>!['page','category'].includes(k))||req.query.page!==undefined&&!/^[1-9]\d{0,5}$/.test(req.query.page))throw fail(400,'Choose a valid favorites page.');
  const category=Number(req.query.category||0);if(!Number.isSafeInteger(category)||category<0)throw fail(400,'Choose a valid favorites category.');
  const sql=await pool.getConnection();try{
   await sql.beginTransaction();
   const from=" FROM product_favorites f JOIN productos p ON p.id=f.product_id LEFT JOIN product_versions pv ON pv.id=p.current_version_id WHERE f.user_id=?",categoryId="COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pv.snapshot,'$.category_id')),p.categoria_id)",where=from+(category?' AND '+categoryId+'=?':''),args=[req.user.id,...(category?[category]:[])];
   const [[count]]=await sql.execute('SELECT COUNT(DISTINCT f.product_id) total,COUNT(*) colors'+where,args);
   const [categoryCounts]=await sql.execute('SELECT '+categoryId+' category_id,COUNT(DISTINCT f.product_id) total'+from+' GROUP BY '+categoryId,[req.user.id]);
   const total=Number(count.total),pages=Math.ceil(total/24),page=Math.min(Number(req.query.page||1),Math.max(1,pages));
   const [groups]=await sql.query('SELECT f.product_id,MAX(f.id) latest'+where+' GROUP BY f.product_id ORDER BY latest DESC LIMIT 24 OFFSET ?',[...args,(page-1)*24]);
   const items=[];
   for(const group of groups){
    const product=await publicProduct(sql,group.product_id);
    const [saved]=await sql.execute('SELECT variant_id,created_at FROM product_favorites WHERE user_id=? AND product_id=? ORDER BY id DESC',[req.user.id,group.product_id]);
    const variants=saved.map(s=>{const v=product?.variants.find(v=>v.id===s.variant_id);return v?{...v,available:true,saved_at:s.created_at}:{id:s.variant_id,name:'Unavailable color',hex:'#d8d3dc',is_default:false,available:false,saved_at:s.created_at,texture_url:null};});
    items.push({product:product?{...product,variants}:null,product_id:group.product_id,variants,initial_variant_id:saved[0].variant_id});
   }
   await sql.commit();res.json({items,total,total_colors:Number(count.colors),page,total_pages:pages,category_counts:categoryCounts});
  }catch(e){await sql.rollback();throw e;}finally{sql.release();}
 });
 for(const method of ['put','delete'])app[method](base+'/:id/:variantId',async(req,res)=>{
  if(!validAssetId(req.params.variantId))throw fail(400,'Choose a valid color variant.');
  if(req.body&&Object.keys(req.body).length)throw fail(400,'Unexpected favorites fields.');
  const sql=await pool.getConnection();try{
   await sql.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await sql.beginTransaction();

   await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[req.user.id]);
   await sql.execute('SELECT id FROM productos WHERE id=? FOR UPDATE',[req.recordId]);
   await requireLiveSession(sql,req);
   if(method==='put'){
    const product=await publicProduct(sql,req.recordId);
    if(!product?.variants.some(v=>v.id===req.params.variantId))throw fail(404,'This item or color is unavailable.');
    const [[variant]]=await sql.execute('SELECT product_id FROM variants WHERE id=?',[req.params.variantId]);
    if(variant?.product_id!==req.recordId)throw fail(404,'This color does not belong to the item.');
    await sql.execute('INSERT INTO product_favorites(user_id,product_id,variant_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE variant_id=VALUES(variant_id)',[req.user.id,req.recordId,req.params.variantId]);
   }else await sql.execute('DELETE FROM product_favorites WHERE user_id=? AND product_id=? AND variant_id=?',[req.user.id,req.recordId,req.params.variantId]);
   await sql.commit();res.json({product_id:req.recordId,variant_id:req.params.variantId,saved:method==='put'});
  }catch(e){await sql.rollback();throw e;}finally{sql.release();}
 });
}
