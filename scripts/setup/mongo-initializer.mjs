// ALTEGO necesita resolver el contrato y la inicialización de colecciones MongoDB.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';
export async function mongoContract(){
 const source=await fs.readFile(new URL('../../database/mongodb.js',import.meta.url),'utf8');
 const parts=source.split('/* ALTEGO_CONTRACT_START */');
 if(parts.length!==2)throw Error('Invalid canonical MongoDB contract.');
 const tail=parts[1].split('/* ALTEGO_CONTRACT_END */');if(tail.length!==2)throw Error('Invalid canonical MongoDB contract.');
 const contract=JSON.parse(tail[0]);
 if(!Array.isArray(contract.collections)||contract.collections.map(c=>c.name).join(',')!=='resenas,academic_products')throw Error('Unexpected installation collections.');
 return contract;
}
export async function initializeMongo(database){
 if((await database.listCollections().toArray()).length)throw Error('MongoDB destination must be new and empty.');
 const contract=await mongoContract();
 for(const spec of contract.collections){await database.createCollection(spec.name,{validator:spec.validator});const collection=database.collection(spec.name);for(const index of spec.indexes)await collection.createIndex(index.key,index.options);if(spec.documents.length)await collection.insertMany(structuredClone(spec.documents));}
 return {collections:contract.collections.map(c=>c.name),seedDocuments:2};
}
