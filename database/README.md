# Inicialización de bases de ALTEGO

La instalación de esta versión de ALTEGO está diseñada y validada para Windows. Aunque MySQL y MongoDB son multiplataforma, macOS y Linux no forman parte de la compatibilidad oficial del proyecto. Dev Console gráfica utiliza C# y WPF y es exclusiva de Windows; la consola de texto existente se conserva para ese mismo entorno.

Usar solamente bases nuevas. No ejecutar estos archivos sobre una instalación que contenga cuentas o contenido que se deba conservar.

1. Con MySQL Server encendido, abrir `mysql.sql` en MySQL Workbench y ejecutar el archivo completo, deteniéndose ante cualquier error. Crea `tienda_avatares_2053`, 71 tablas, claves, índices, tres triggers, Admin y dos accesorios académicos.
2. Conectarse al servidor desde MongoDB Compass y abrir **Open MongoDB shell**, su consola mongosh integrada. Ejecutar `use tienda_avatares_2053` y pulsar Enter. Abrir `mongodb.js` en un editor de texto, copiarlo entero, pegarlo en la entrada de esa consola y pulsar Enter una vez para ejecutar el bloque completo, incluidas las llaves exteriores. No ejecutar líneas sueltas ni comandos de carga de archivos. No se requieren MongoDB Shell independiente ni PowerShell. Comprobar el resumen: colecciones `resenas` y `academic_products`, `academicProducts: 2` y `reviews: 0`. El script rechaza bases con colecciones existentes; ante un fallo, conservar el destino parcial y revisar el error.
3. Configurar el `.env` de la raíz y ejecutar `npm ci`.
4. Ejecutar `npm run setup -- --initialize` para verificar la semilla y preparar los recursos académicos en Storage nuevo.
5. Ejecutar `npm start` y abrir `http://localhost:4200`.

Si se eligen otros nombres, cambiar la base en las instrucciones `CREATE DATABASE` y `USE` del SQL, seleccionar ese destino en mongosh y usar los mismos nombres en `.env`.

Como alternativa, **Setup & Installation** de Dev Console o `npm run setup -- --new` pueden ejecutar los mismos inicializadores en destinos inexistentes. Nunca actualizan ni reinician bases existentes. No mezclar esta alternativa con una importación manual ya realizada.

Los archivos no contienen una copia de la base principal. Admin utiliza exclusivamente las credenciales académicas del README; no se incluyen otros usuarios, órdenes, adquisiciones ni sesiones. Los 31 recursos académicos distribuibles se verifican por hash antes de copiarlos. No es necesario disponer de Blender.

Si una operación falla, conservar el destino parcial y revisar el mensaje. No repetir el SQL sobre datos utilizados ni borrar una base para eludir las protecciones del instalador.

## Recursos de inicialización

El instalador comprueba los 31 archivos (dos GLB y 29 PNG), sus hashes, los snapshots y las referencias de los dos productos y sus 29 variantes en el Storage definitivo. Su última operación retira únicamente `seed-assets/` de esa copia instalada. Si la inicialización falla, conserva o restaura las semillas; nunca vacía destinos existentes. Una instalación ya inicializada se detecta sin volver a crear ni modificar datos.

Después, el arranque, Dev Console, Verify Installation, las vistas previas, las variantes, las versiones y las descargas utilizan Storage y las bases; no necesitan las semillas. `npm ci` y `npm run build` tampoco dependen de ellas. Para otra instalación completamente nueva, recuperar `seed-assets/` desde el ZIP original o el repositorio y elegir bases y Storage nuevos.
