// ALTEGO necesita resolver las métricas e historial de ventas del creador.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {requireUser,requireLiveSession} from '../accounts/auth.js';
import {salesReady} from "../../infrastructure/schema/readiness.js";
const number=value=>{const result=Number(value||0);if(!Number.isSafeInteger(result)||result<0)throw Object.assign(Error('Sales totals require verification.'),{status:409});return result;};
export const salesFrom=` FROM order_items i JOIN orders o ON o.id=i.order_id AND o.buyer_id=i.buyer_id JOIN acquisitions a ON a.order_item_id=i.id AND a.user_id=i.buyer_id AND a.product_id=i.product_id AND a.variant_id=i.variant_id AND a.acquired_version_id=i.version_id `;
export function salesScope(creator,{start=null,end=null,productId=null,kind='all'}={}){let where=" WHERE i.creator_id=? AND i.acquired_version_number IS NOT NULL AND o.status='completed' AND o.completed_at IS NOT NULL";const values=[creator];if(start){where+=' AND o.completed_at>=?';values.push(start);}if(end){where+=' AND o.completed_at<=?';values.push(end);}else where+=' AND o.completed_at<=UTC_TIMESTAMP(3)';if(productId!==null){where+=' AND i.product_id=?';values.push(productId);}if(kind==='paid')where+=' AND i.price_cents>0';if(kind==='free')where+=' AND i.price_cents=0';return {where,values};}
export const salesMetrics=`COALESCE(SUM(CASE WHEN i.price_cents>0 THEN i.price_cents ELSE 0 END),0) total_revenue_cents,COALESCE(SUM(i.price_cents>0),0) total_sales,COUNT(DISTINCT CASE WHEN i.price_cents>0 THEN i.product_id END) products_sold,COALESCE(SUM(i.price_cents=0),0) free_acquisitions`;
export function normalizeSales(row){return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,number(value)]));}
export async function readSalesSummary(sql,creator,filters={}){if(!await salesReady(sql))return {ready:false,total_revenue_cents:0,total_sales:0,products_sold:0,free_acquisitions:0,currency:'USD'};const scope=salesScope(creator,filters);const [[row]]=await sql.execute('SELECT '+salesMetrics+salesFrom+scope.where,scope.values);return {ready:true,...normalizeSales(row),currency:'USD'};}

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const positive=value=>typeof value==='string'&&/^[1-9]\d{0,9}$/.test(value)&&Number(value)<=4294967295;
const iso=value=>new Date(value).toISOString();
const dateSql=value=>iso(value).slice(0,23).replace('T',' ');
export function parseSalesQuery(query,extra=[]){
 if(Object.keys(query).some(key=>!['period','product',...extra].includes(key)))throw fail('Unsupported sales filter.');
 const period=query.period??'30';if(!['7','30','90','all'].includes(period))throw fail('Invalid period.');
 const productId=query.product===undefined?null:positive(query.product)?Number(query.product):NaN;
 if(Number.isNaN(productId))throw fail('Invalid product.');
 const page=query.page===undefined?1:positive(query.page)?Number(query.page):NaN;if(!Number.isInteger(page)||page>1000000)throw fail('Invalid page.');
 const kind=query.kind??'all';if(!['all','paid','free'].includes(kind))throw fail('Invalid acquisition filter.');return {period,productId,page,kind};
}
export function salesRange(period,now){const end=new Date(now),start=period==='all'?null:new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),end.getUTCDate()-Number(period)+1));return {start:start?dateSql(start):null,end:dateSql(end)};}
export async function salesProductOptions(sql,creator){
 const [items]=await sql.execute(`WITH historical AS (SELECT i.product_id,i.product_name,ROW_NUMBER() OVER(PARTITION BY i.product_id ORDER BY o.completed_at DESC,i.id DESC) position ${salesFrom} ${salesScope(creator).where})
 SELECT p.id product_id,p.nombre product_name FROM productos p WHERE p.owner_id=? AND NOT EXISTS(SELECT 1 FROM historical h WHERE h.product_id=p.id)
 UNION ALL SELECT product_id,product_name FROM historical WHERE position=1 ORDER BY product_name,product_id`,[creator,creator]);return {items};
}
async function assertProduct(sql,creator,productId){if(productId===null)return;const [[row]]=await sql.execute(`SELECT 1 allowed WHERE EXISTS(SELECT 1 FROM productos WHERE id=? AND owner_id=?) OR EXISTS(SELECT 1 ${salesFrom} ${salesScope(creator,{productId}).where})`,[productId,creator,creator,productId]);if(!row)throw fail('Product not found.',404);}
export function timelinePlan(start,end){const days=Math.ceil((end-start)/86400000)+1,unit=days<=31?'day':days<=180?'week':days<=3650?'month':'year';return {unit,expression:unit==='day'?"DATE_FORMAT(o.completed_at,'%Y-%m-%d')":unit==='week'?"DATE_FORMAT(DATE_SUB(DATE(o.completed_at),INTERVAL WEEKDAY(o.completed_at) DAY),'%Y-%m-%d')":unit==='month'?"DATE_FORMAT(o.completed_at,'%Y-%m-01')":"DATE_FORMAT(o.completed_at,'%Y-01-01')"};}
function floorDate(value,unit){const d=new Date(value);d.setUTCHours(0,0,0,0);if(unit==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);if(unit==='month'||unit==='year')d.setUTCDate(1);if(unit==='year')d.setUTCMonth(0);return d;}
function nextDate(value,unit){const d=new Date(value);if(unit==='year')d.setUTCFullYear(d.getUTCFullYear()+1);else if(unit==='month')d.setUTCMonth(d.getUTCMonth()+1);else d.setUTCDate(d.getUTCDate()+(unit==='week'?7:1));return d;}
export async function readSalesOverview(sql,creator,filters){
 const summary=await readSalesSummary(sql,creator,filters),scope=salesScope(creator,filters);
 const [[first]]=await sql.execute("SELECT DATE_FORMAT(MIN(o.completed_at),'%Y-%m-%dT%H:%i:%s.%fZ') first_date"+salesFrom+scope.where,scope.values);
 const end=new Date(filters.end.replace(' ','T')+'Z'),start=filters.start?new Date(filters.start.replace(' ','T')+'Z'):first.first_date?new Date(first.first_date):end;
 const {unit,expression}=timelinePlan(start,end),[rows]=await sql.execute('SELECT '+expression+' bucket,COALESCE(SUM(i.price_cents),0) revenue_cents'+salesFrom+scope.where+' AND i.price_cents>0 GROUP BY bucket ORDER BY bucket',scope.values),totals=new Map(rows.map(r=>[r.bucket,number(r.revenue_cents)])),timeline=[];
 for(let date=floorDate(start,unit);date<=end;date=nextDate(date,unit)){const key=date.toISOString().slice(0,10),next=nextDate(date,unit);timeline.push({date:key,through:new Date(Math.min(next.getTime()-1,end.getTime())).toISOString().slice(0,10),revenue_cents:totals.get(key)||0});}
 return {...summary,timeline,interval:unit,range:{start:filters.start?iso(start):null,end:iso(end),timezone:'UTC'}};
}
const size=10;
export async function readSalesPage(sql,creator,filters,{page=1,kind='all',variants=null,history=false}={}){
 const scope=salesScope(creator,{...filters,kind,productId:variants??filters.productId});const group=variants!==null?'variant_id':'product_id';
 const [[count]]=await sql.execute('SELECT '+(history?'COUNT(*)':`COUNT(DISTINCT i.${group})`)+' total'+salesFrom+scope.where,scope.values);const total=number(count.total),pages=Math.max(1,Math.ceil(total/size));page=Math.min(page,pages);const offset=(page-1)*size;let rows;
 if(history){[rows]=await sql.execute(`SELECT i.product_id,i.product_name,i.variant_id,i.variant_name,i.acquired_version_number,DATE_FORMAT(o.completed_at,'%Y-%m-%dT%H:%i:%s.%fZ') acquired_at,i.price_cents ${salesFrom} ${scope.where} ORDER BY o.completed_at DESC,i.id DESC LIMIT ${size} OFFSET ${offset}`,scope.values);rows=rows.map(r=>({...r,price_cents:number(r.price_cents)}));}
 else{[rows]=await sql.execute(`WITH scoped AS (SELECT i.*,o.completed_at,ROW_NUMBER() OVER(PARTITION BY i.${group} ORDER BY o.completed_at DESC,i.id DESC) position ${salesFrom} ${scope.where}) SELECT ${group},MAX(CASE WHEN position=1 THEN ${variants!==null?'variant_name':'product_name'} END) name,COALESCE(SUM(price_cents),0) total_revenue_cents,COALESCE(SUM(price_cents>0),0) total_sales,COALESCE(SUM(price_cents=0),0) free_acquisitions FROM scoped GROUP BY ${group} ORDER BY total_revenue_cents DESC,${group} LIMIT ${size} OFFSET ${offset}`,scope.values);rows=rows.map(r=>({...r,total_revenue_cents:number(r.total_revenue_cents),total_sales:number(r.total_sales),free_acquisitions:number(r.free_acquisitions)}));}
 return {items:rows,total,page,pages,size};
}
export function installSalesInsights(app,pool){
 const route=(path,extra,run)=>app.get('/api/studio/sales/'+path,requireUser,async(req,res,next)=>{
  res.set('Cache-Control','private, no-store').vary('Cookie');let sql;try{const query=parseSalesQuery(req.query,extra);sql=await pool.getConnection();await sql.beginTransaction();await requireLiveSession(sql,req);if(!await salesReady(sql))throw fail('Sales insights are not available yet.',503);
   const [[clock]]=await sql.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ') now");const filters={...salesRange(query.period,clock.now),productId:query.productId};await assertProduct(sql,req.user.id,query.productId);
   const result=await run(sql,req.user.id,filters,query,req);await sql.commit();res.json(result);
  }catch(error){await sql?.rollback();next(error);}finally{sql?.release();}
 });
 route('overview',[],readSalesOverview);route('product-options',[],salesProductOptions);
 route('products',['page'],(sql,user,filters,q)=>readSalesPage(sql,user,filters,{page:q.page}));
 route('products/:productId/variants',['page'],async(sql,user,filters,q,req)=>{if(!positive(req.params.productId))throw fail('Invalid product.');const product=Number(req.params.productId);await assertProduct(sql,user,product);if(filters.productId!==null&&filters.productId!==product)throw fail('Product filters do not match.');return readSalesPage(sql,user,filters,{page:q.page,variants:product});});
 route('history',['page','kind'],(sql,user,filters,q)=>readSalesPage(sql,user,filters,{page:q.page,kind:q.kind,history:true}));
}
