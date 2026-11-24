# Bases de datos y recursos

La instalación de esta versión de ALTEGO está diseñada y validada para Windows. Aunque MySQL y MongoDB son multiplataforma, macOS y Linux no forman parte de la compatibilidad oficial del proyecto. Dev Console gráfica utiliza C# y WPF y es exclusiva de Windows; la consola de texto existente se conserva para ese mismo entorno.

ALTEGO combina MySQL para las relaciones y transacciones, MongoDB para documentos y un Storage local para GLB, PNG e índices derivados. El navegador solo se comunica con Express; nunca recibe credenciales de bases de datos.

## Inicializadores canónicos

`database/` contiene exactamente `README.md`, `mysql.sql` y `mongodb.js`. Son fuentes revisadas para instalaciones académicas nuevas, no exportaciones de una base activa. La ruta manual de MongoDB consiste en seleccionar una base nueva en la consola mongosh integrada de Compass y pegar allí el contenido completo de mongodb.js como un único bloque. Usa operaciones de base de datos con espera explícita, sin acceso a archivos locales ni necesidad de MongoDB Shell independiente o PowerShell. Rechaza cualquier destino con colecciones y muestra un resumen al finalizar. El instalador opcional de Dev Console extrae el mismo contrato delimitado y lo aplica mediante el driver existente; no evalúa el bloque de la consola ni requiere Compass.

MySQL crea 71 tablas y tres triggers. Incluye claves primarias, foráneas, índices únicos, restricciones, collations y las estructuras necesarias para todas las funcionalidades entregadas. Los marcadores de compatibilidad indican el baseline estructural equivalente; no representan actividad personal ni ejecutan backfills históricos.

MongoDB crea `resenas` con validación e índice por producto y fecha, inicialmente sin reseñas, y `academic_products` con dos documentos que referencian los productos MySQL. Estos documentos satisfacen la referencia académica entre bases; no simulan compras ni opiniones de clientes.

## Grupos de relaciones

- **Identidad:** users, sesiones, handles permanentes, perfiles, privacidad, notificaciones, seguimiento y bloqueos.
- **Catálogo:** categorias y productos; cada producto pertenece a su creador y categoría.
- **Recursos:** assets, product_files y enlaces de representaciones; validación y deduplicación mediante hash dentro de cada producto.
- **Versiones:** product_versions y version_variants conservan snapshots publicados y sus referencias exactas. Las restauraciones registran su procedencia.
- **Adquisición:** orders, order_items y acquisitions mantienen comprador, variante, versión original, precios históricos y atribución del creador. La propiedad es independiente por variante.
- **Checkout:** cotizaciones, intentos idempotentes y preferencias de facturación conforme al contrato vigente; no se guardan tarjetas, CVV ni credenciales PayPal.
- **Comunidad y administración:** publicaciones, interacciones, encuestas, reportes, casos, sanciones, apelaciones, auditoría y verificación.
- **Storage:** diarios de incorporación, mantenimiento, referencias, cuotas y retención. La purga no invalida recursos protegidos por adquisiciones.

Las reseñas MongoDB referencian productos y autores según su contrato. Verified Purchase se determina mediante las adquisiciones del servidor; editar una reseña no cambia autor, fecha original, orden ni propiedad.

## Semilla académica

La instalación crea únicamente un Admin, con credenciales académicas documentadas en el README, perfil vacío, Settings predeterminados y verificación automática. No incorpora cuentas de demostración adicionales, sesiones, ventas, órdenes, sanciones ni historial de la creadora.

Se incluyen **Hair 1**, gratuito, con 12 colores, y **Hair 2**, de precio académico USD 2.99, con 17 colores. Sus dos GLB y 29 PNG están en `seed-assets/`; el manifiesto conserva tamaño, SHA-256 y referencias. Los archivos de Blender originales no son una dependencia de la instalación.

Después de importar ambos scripts manualmente, `npm run setup -- --initialize` comprueba la semilla intacta y copia esos recursos al Storage nuevo. `--new` es la alternativa explícita para bases todavía inexistentes. Ambos modos rechazan datos utilizados y no restablecen credenciales. El arranque de Express no ejecuta migraciones ni aprovisionamiento académico.

## Seguridad operativa

- Mantener `.env` y Storage fuera de Git y del paquete. El destino predeterminado de ejecución se crea localmente al instalar.
- No ejecutar scripts de instalación sobre bases existentes. Ante un fallo DDL puede existir un destino parcial: detenerse, conservarlo y revisar el error; no improvisar borrados o reinicializaciones.
- No copiar una base activa para distribuir ALTEGO. Los respaldos operativos deben permanecer fuera del proyecto.
- Probar purgas, sanciones, compras y restauraciones en bases y Storage separados, configurados antes de importar módulos.
- Las restricciones de integridad, unicidad e idempotencia se validan en el servidor; los valores del navegador no sustituyen los registros persistidos.

Consultar [database/README.md](../database/README.md) y el [README principal](../README.md) para los pasos de instalación.

## Ubicaciones físicas de productos (037)

El baseline agrega directory_name nullable a product_storage y storage_version nullable a product_files, manteniendo las 71 tablas y los tres triggers. El esquema incremental es aditivo e idempotente; no modifica órdenes, adquisiciones, snapshots ni credenciales. Se verificó su equivalencia con el SQL completo en aislamiento. No se aplicó a la base principal.

Las carpetas nuevas se organizan como `storage/{username}/{slug-inicial}--p{id}/versions/v{n}/{glb|png}/{sha256}.{ext}`. La identidad estable es el ID, no el título actual. La ubicación se fija en la primera incorporación; los cambios posteriores de nombre no renuevan la carpeta. Cada hash se registra una sola vez dentro del producto, con su incorporación física. Las versiones publicadas reutilizan esos registros; los índices de cada snapshot indican las rutas reales de GLB y PNG y sus variantes.

No confundir storage_version con acquired_version_id o version_number: estos últimos conservan la publicación histórica real. La carpeta de una incorporación en borrador puede contener archivos que todavía no se han publicado. Precio, texto y visibilidad no crean directorios binarios; los metadatos y snapshots continúan en MySQL. Los recursos que protegen adquisiciones permanecen accesibles aun después de la purga lógica, conforme a las restricciones de moderación.

Los dos productos académicos se importan con storage_version 1 y directorios hair-1--p1 y hair-2--p2 dentro de admin. seed-assets es un paquete de semillas reproducibles, no un Storage de ejecución. Sus archivos no se utilizan como fallback de previews ni descargas una vez inicializado el sistema.

Los registros antiguos con directory_name NULL conservan su distribución anterior y no se mueven al arrancar. La recuperación del archivo personal y cualquier traslado de esos datos requieren un procedimiento de respaldo/traslado específico; nunca ejecutar el inicializador limpio sobre una instalación utilizada.

Las reservas de carpeta y de primera incorporación del hash se registran como operaciones completadas en creator_storage_operations mediante una conexión independiente antes de escribir archivos. Sobreviven a un rollback del guardado: un reintento, un cambio de nombre o una publicación intermedia reutilizan el destino reservado. No constituyen publicaciones ni adquisiciones adicionales.

## Recursos de inicialización

El instalador comprueba los 31 archivos (dos GLB y 29 PNG), sus hashes, los snapshots y las referencias de los dos productos y sus 29 variantes en el Storage definitivo. Su última operación retira únicamente `seed-assets/` de esa copia instalada. Si la inicialización falla, conserva o restaura las semillas; nunca vacía destinos existentes. Una instalación ya inicializada se detecta sin volver a crear ni modificar datos.

Después, el arranque, Dev Console, Verify Installation, las vistas previas, las variantes, las versiones y las descargas utilizan Storage y las bases; no necesitan las semillas. `npm ci` y `npm run build` tampoco dependen de ellas. Para otra instalación completamente nueva, recuperar `seed-assets/` desde el ZIP original o el repositorio y elegir bases y Storage nuevos.
