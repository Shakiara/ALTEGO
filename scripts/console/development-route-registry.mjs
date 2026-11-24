// ALTEGO necesita resolver el inventario de rutas reales sin ejecutar sus operaciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
if(process.env.ALTEGO_ROUTE_INVENTORY!=='1')throw Error('Inventory child only.');
const {createApp}=await import('../../backend/app.js');let reads=0;
const sql={execute:async statement=>{if(!statement.startsWith('SELECT id FROM schema_migrations'))throw Error('Unexpected inventory database access');reads++;return [[]];},query:async statement=>{if(statement!=='SELECT id,username FROM users')throw Error('Unexpected inventory database access');reads++;return [[]];}};
const app=createApp(sql,{collection:()=>({})});await new Promise(r=>setImmediate(r));const routes=[];
for(const layer of app.router.stack){if(!layer.route)continue;const route=layer.route;if(typeof route.path!=='string')throw Error('Unsupported Express route');for(const [method,enabled]of Object.entries(route.methods)){if(enabled)routes.push({type:'API',method:method.toUpperCase(),path:route.path,authenticated:route.stack.some(s=>/require|admin|permission|session/i.test(s.handle.name))});}}
if(reads!==3||!routes.length)throw Error('Unexpected inventory registration');process.stdout.write(JSON.stringify(routes));
