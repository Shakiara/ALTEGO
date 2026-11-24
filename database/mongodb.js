// ALTEGO necesita inicializar sus colecciones documentales en una base MongoDB nueva.
// Este bloque crea validaciones, índices y referencias académicas desde la consola integrada de Compass.
;(async () => {
 const altegoContract = /* ALTEGO_CONTRACT_START */
{
  "collections": [
    {
      "name": "resenas",
      "validator": {
        "$jsonSchema": {
          "bsonType": "object",
          "required": [
            "producto_id",
            "autor",
            "calificacion",
            "comentario",
            "creado_en"
          ],
          "properties": {
            "producto_id": {
              "bsonType": [
                "int",
                "long",
                "double"
              ],
              "minimum": 1
            },
            "autor": {
              "bsonType": "string",
              "minLength": 1,
              "maxLength": 80
            },
            "calificacion": {
              "enum": [
                1,
                2,
                3,
                4,
                5
              ]
            },
            "comentario": {
              "bsonType": "string",
              "minLength": 1,
              "maxLength": 2000
            },
            "creado_en": {
              "bsonType": "date"
            }
          }
        }
      },
      "indexes": [
        {
          "key": {
            "producto_id": 1,
            "creado_en": -1
          },
          "options": {
            "name": "producto_id_1_creado_en_-1"
          }
        }
      ],
      "documents": []
    },
    {
      "name": "academic_products",
      "validator": {
        "$jsonSchema": {
          "bsonType": "object",
          "required": [
            "_id",
            "product_id",
            "name"
          ],
          "properties": {
            "_id": {
              "bsonType": "string"
            },
            "product_id": {
              "bsonType": [
                "int",
                "long",
                "double"
              ]
            },
            "name": {
              "bsonType": "string"
            }
          }
        }
      },
      "indexes": [
        {
          "key": {
            "product_id": 1
          },
          "options": {
            "unique": true,
            "name": "academic_product_identity"
          }
        }
      ],
      "documents": [
        {
          "_id": "academic-hair-1",
          "product_id": 1,
          "name": "Hair 1",
          "description": "Academic sample accessory by Shakiara."
        },
        {
          "_id": "academic-hair-2",
          "product_id": 2,
          "name": "Hair 2",
          "description": "Academic sample accessory by Shakiara."
        }
      ]
    }
  ]
}
/* ALTEGO_CONTRACT_END */;
 const existingCollections = await db.getCollectionNames();
 if (existingCollections.length) throw new Error("Use a new, empty MongoDB database. Existing data is never replaced.");
 for (const spec of altegoContract.collections) {
  await db.createCollection(spec.name, {validator:spec.validator});
  const collection = db.getCollection(spec.name);
  for (const index of spec.indexes) await collection.createIndex(index.key,index.options);
  if (spec.documents.length) await collection.insertMany(spec.documents);
 }
 print(JSON.stringify({database:db.getName(),collections:await db.getCollectionNames(),academicProducts:await db.getCollection("academic_products").countDocuments({}),reviews:await db.getCollection("resenas").countDocuments({})}));
})();
