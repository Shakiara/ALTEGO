# Backend de ALTEGO

## Plataforma soportada y Dev Console

Esta versión está diseñada y validada para Windows. La Dev Console gráfica conserva su implementación en C# y WPF, exclusiva de Windows; `npm start` abre esa interfaz y `npm run console` mantiene la consola de texto existente dentro del mismo entorno soportado. No se ha migrado la arquitectura de la consola.

La portabilidad de Node.js, Express, Angular, MySQL y MongoDB no equivale a compatibilidad del proyecto completo: macOS y Linux no son sistemas oficialmente compatibles con esta versión. Los procedimientos de instalación, configuración y supervisión se documentan para Windows.

## Responsabilidades y configuración

Node.js y Express validan las operaciones y conectan la interfaz con MySQL, MongoDB y los archivos GLB/PNG. `server.js` abre las conexiones; `app.js` compone los módulos HTTP. `config.js` carga el `.env` de la raíz y `environment.js` valida sus valores. No se requieren configuraciones privadas adicionales por módulo.

Los módulos están agrupados en `modules/`: accounts, administration, catalog, collection, commerce, conversations, discovery, favorites, products, reviews, social, studio y verification. `infrastructure/` reúne Storage, red y disponibilidad del esquema. `core/` conserva validadores compartidos. Los nombres públicos de rutas y los contratos de permisos no dependen de esa distribución física.

## API y permisos

| Área | Operaciones principales |
| --- | --- |
| Categorías y catálogo | Listar, buscar, filtrar y consultar productos disponibles |
| Cuentas y perfiles | Registro, login, sesiones, perfil y Settings |
| Productos y versiones | Crear borradores, editar variantes, publicar, restaurar y administrar Trash |
| Comunidad | Publicaciones, encuestas, comentarios, respuestas, reacciones y menciones |
| Reviews | Consultar, publicar, editar, eliminar y reportar reseñas |
| Commerce | Bolsa, cotización, checkout simulado, órdenes, confirmación y propiedad |
| My Collection | Agrupación privada, filtros, pins y ZIP por producto adquirido |
| Administración | Cuentas, sanciones, apelaciones, reportes y verificación |

La API comprueba la sesión y los permisos en el servidor. La ocultación de un botón en Angular no concede ni revoca autorización. Admin, Moderator, autor y propietario tienen alcances distintos; un identificador manipulado no permite acceder a recursos de otra cuenta. Las escrituras verifican también el origen permitido. Las contraseñas y tokens no deben aparecer en logs ni respuestas públicas.

El proyecto utiliza autenticación académica y pagos ficticios. No está preparado para producción pública ni para datos financieros reales. El arranque conserva la prohibición de `NODE_ENV=production`.

## Contratos funcionales que deben conservarse

- El username canónico es permanente. Display Name se administra por separado. Admin conserva su identidad y Verified Creator automático.
- Las cuentas nuevas siguen al Admin principal mediante la política social existente, dentro de su transacción. Esta relación no concede acceso privado ni evita restricciones sociales.
- Privacidad, bloqueos, suspensiones y permisos se comprueban en backend, incluso en solicitudes directas.
- Solo el autor edita una reseña. Autor y personal autorizado pueden eliminarla; nadie puede reportar su propia reseña. Los reportes no borran automáticamente contenido ni revelan al autor la identidad del denunciante. Verified Purchase procede de una adquisición válida.
- La bolsa identifica cada entrada por producto y variante, sin cantidades. La selección utiliza la última versión publicada. El servidor revalida disponibilidad, propiedad, versión y precio antes de confirmar.
- La adquisición de una variante es única y permanente e incluye sus actualizaciones futuras. El historial conserva la versión realmente adquirida y los precios de la orden. Transacciones, claves únicas e idempotencia impiden adquisiciones y órdenes duplicadas.
- La confirmación y los ZIP históricos solo son accesibles al comprador autenticado. My Orders descarga órdenes completas con Receipt.pdf; My Collection agrupa descargas por producto y variantes propias, incluso entre órdenes, sin duplicar GLB idénticos.
- Un producto restringido por moderación permanece visible en My Collection y puede previsualizarse, pero sus descargas se bloquean mientras dure la restricción.

## Storage y versiones

Los identificadores de recursos se resuelven mediante registros del servidor; no se aceptan rutas arbitrarias enviadas por clientes. Se verifican tipo, propietario, tamaño y SHA-256, y se rechazan enlaces simbólicos y rutas que salgan de Storage.

Las carpetas de creadores contienen productos, archivos por hash, índices derivados, versiones y cargas. Los originales GLB y texturas PNG conservan sus referencias; los snapshots publicados no se modifican retroactivamente. Restore crea una nueva publicación. Trash permite recuperación durante el período vigente; la purga lógica no destruye los recursos necesarios para adquisiciones existentes. Los recursos compartidos por versiones no se retiran mientras tengan referencias protegidas.

Los índices JSON son derivados de MySQL, no una segunda autoridad de negocio. Las operaciones de incorporación, retención y recuperación conservan sus diarios. Las herramientas de `scripts/maintenance/` requieren revisión de destino y respaldo; no se ejecutan automáticamente para instalar una copia nueva.

## Instalación y mantenimiento

El baseline canónico está en `database/mysql.sql`; MongoDB utiliza `database/mongodb.js`. El instalador explícito de `scripts/setup/` comprueba destinos y equivalencia estructural antes de declarar lista una instalación. No ejecuta la cadena histórica de migraciones sobre datos existentes. Las comprobaciones de disponibilidad del runtime son de solo lectura.

Se conservan tres módulos de compatibilidad bajo `infrastructure/schema/compatibility/` porque todavía los usan herramientas explícitas de mantenimiento. No forman parte del arranque ni de la inicialización nueva. No llamar esas operaciones para actualizar una instalación sin un plan y respaldo verificados.

Consultar el [README](../README.md) para requisitos y comandos y [DATABASE.md](DATABASE.md) para relaciones y datos iniciales. La documentación histórica y las evidencias externas no son dependencias de ejecución.

## Carpetas legibles y contenido por versión (037)

`product-layout.js` centraliza las ubicaciones. MySQL conserva el nombre de carpeta inmutable en product_storage.directory_name y la primera incorporación física de cada hash en product_files.storage_version. El patrón nuevo es `{username}/{slug-inicial}--p{id}/versions/v{n}/{glb|png}/{sha256}.{ext}`; el username es permanente y la propiedad se verifica por IDs internos. No se aceptan rutas del navegador. Slugs limitados y normalizados, IDs positivos, hash, comprobaciones de propietario y rechazo de enlaces protegen las ubicaciones.

Al incorporar un archivo se reserva la próxima versión de publicación; GLB/PNG idénticos ya registrados reutilizan su ubicación original. Un archivo incorporado en un borrador puede permanecer recuperable aunque no llegue a publicarse: el historial publicado siempre se consulta en MySQL, no se deduce de las carpetas. Las publicaciones de metadatos conservan snapshots e índices JSON, pero no crean directorios binarios vN ni duplican recursos. Los índices metadata.json y versions/vN.json incluyen las rutas de los recursos y permiten relacionar nombres/IDs de colores con los archivos de su snapshot.

Resolución, cuotas, cuarentena/recuperación y purga utilizan la misma distribución. Las adquisiciones, moderación y autorizaciones mantienen sus verificaciones existentes; el cambio de ruta no cambia propiedad ni versiones adquiridas. Se admite el formato anterior cuando directory_name es NULL. Preparar el esquema no traslada por sí solo archivos históricos; no se reubican respaldos automáticamente.

El importador académico usa el resolutor común y los mismos registros assets/product_files/asset_file_links/version_variants. Las semillas solo se leen durante instalación; el runtime no tiene un segundo almacén académico.

Las reservas de carpeta y de primera incorporación del hash se registran como operaciones completadas en creator_storage_operations mediante una conexión independiente antes de escribir archivos. Sobreviven a un rollback del guardado: un reintento, un cambio de nombre o una publicación intermedia reutilizan el destino reservado. No constituyen publicaciones ni adquisiciones adicionales.

## Recursos de inicialización

El instalador comprueba los 31 archivos (dos GLB y 29 PNG), sus hashes, los snapshots y las referencias de los dos productos y sus 29 variantes en el Storage definitivo. Su última operación retira únicamente `seed-assets/` de esa copia instalada. Si la inicialización falla, conserva o restaura las semillas; nunca vacía destinos existentes. Una instalación ya inicializada se detecta sin volver a crear ni modificar datos.

Después, el arranque, Dev Console, Verify Installation, las vistas previas, las variantes, las versiones y las descargas utilizan Storage y las bases; no necesitan las semillas. `npm ci` y `npm run build` tampoco dependen de ellas. Para otra instalación completamente nueva, recuperar `seed-assets/` desde el ZIP original o el repositorio y elegir bases y Storage nuevos.
