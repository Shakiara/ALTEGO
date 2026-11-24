// ALTEGO necesita resolver la lista explícita de archivos distribuibles.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url));
const documents=['BACKEND.md','DATABASE.md','FRONTEND.md','propuesta.pdf'];
const rootFiles=['README.md','package.json','package-lock.json','.gitignore','.env.example'];
const exact={backend:['app.js','server.js','config.js','environment.js','package.json','package-lock.json'],frontend:['angular.json','tsconfig.json','tsconfig.app.json','proxy.conf.cjs','package.json','package-lock.json'],database:['README.md','mysql.sql','mongodb.js']};
const directories=['backend/core','backend/modules','backend/infrastructure','frontend/src','frontend/public','seed-assets','scripts/console','scripts/run','scripts/setup','scripts/maintenance'];
const forbidden=n=>['node_modules','dist','.angular','.git','backups','tests','coverage','.cache','.vite','logs','test-results'].includes(n)||/^\.env(?:\.|$)/.test(n)||/\.(?:log|tmp|temp|bak|exe|dll|pdb|zip)$/.test(n);

export async function deliveryFiles(root=project){
 const files=[];
 async function add(relative){const full=path.join(root,relative),stat=await fs.lstat(full);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Delivery requires regular files: '+relative);files.push(relative.replaceAll('\\','/'));}
 async function walk(relative){for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){if(forbidden(entry.name))throw Error('Generated or private content inside a source directory: '+relative+'/'+entry.name);const file=relative+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Delivery does not follow links.');if(entry.isDirectory())await walk(file);else await add(file);}}
 for(const file of rootFiles)await add(file);
 for(const [folder,names]of Object.entries(exact))for(const name of names)await add(folder+'/'+name);
 const actual=await fs.readdir(path.join(root,'docs'));if(actual.sort().join(',')!==[...documents].sort().join(','))throw Error('docs must contain exactly the four approved documents.');
 const db=await fs.readdir(path.join(root,'database'));if(db.sort().join(',')!==[...exact.database].sort().join(','))throw Error('database must contain exactly its three canonical files.');
 for(const name of documents)await add('docs/'+name);
 for(const directory of directories)await walk(directory);
 await add('scripts/package-files.mjs');
 return files.sort();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify({files:await deliveryFiles()},null,2));
