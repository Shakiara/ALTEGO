# Frontend y páginas de ALTEGO

ALTEGO está diseñado principalmente para computadoras de escritorio. Cuenta con diseño responsive, pero la experiencia móvil puede presentar limitaciones respecto a escritorio, especialmente durante la carga de modelos 3D. La interfaz utiliza nombres en inglés y una identidad Soft Pastel, Clean Premium y frosted glass.

## Compatibilidad de la instalación

La instalación y ejecución de esta versión están diseñadas y validadas para Windows. Dev Console gráfica utiliza C# y WPF y es exclusiva de Windows; la consola de texto existente también pertenece al entorno soportado. macOS y Linux no son sistemas oficialmente compatibles con el proyecto completo, aunque Angular y Node.js sean multiplataforma. El acceso desde un navegador móvil por LAN no equivale a instalar ALTEGO en ese dispositivo.

## Páginas y navegación

| Sección | Propósito y acciones |
| --- | --- |
| Storefront | Explorar accesorios, buscar, filtrar por categoría y consultar tarjetas con variantes y previsualización 3D |
| Product Details | Girar el modelo, cambiar color, consultar información y reseñas, usar favoritos, Report y Add to Bag / In Bag |
| Discover Creators | Encontrar creadores y explorar sus accesorios publicados |
| Following Feed | Consultar novedades de cuentas seguidas y acceder a sus productos y conversaciones |
| My Account y perfiles públicos | Consultar Collection, Conversations y About; editar el perfil propio y seguir cuentas según permisos |
| My Favorites | Una tarjeta por accesorio; solo colores guardados; previsualizar un color no cambia favoritos y el corazón retira únicamente el seleccionado |
| Shopping Bag | Drawer lateral con una entrada por variante; cambiar color, retirar artículos y continuar a Checkout |
| Checkout | Formulario único, datos de facturación, reconocimiento de cambios y pagos explícitamente simulados; órdenes gratuitas sin paso de pago |
| Order Confirmed | Información histórica, precios, adquisición, Leave a Review cuando corresponde y Download All de la orden |
| My Orders | Historial privado con Confirmation y Download Order |
| My Collection | Biblioteca privada agrupada por producto, variantes y versiones, búsqueda, filtros laterales, ordenación, pins privados y descarga por producto |
| Settings | Account, Privacy, Security, Blocked Users y Activity Center; gestión de datos, privacidad, contraseña y sesiones |
| Notification Center | Avisos de interacción y acontecimientos integrados, con preferencias de notificación |

El menú del avatar reúne los accesos privados pertinentes, Creator Studio, Settings y Log Out. Admin Workspace aparece únicamente para personal autorizado. Los enlaces y restricciones se conservan independientemente de la organización de archivos fuente.

## Creator Studio

- **Dashboard:** indicadores y accesos al trabajo del creador, Community y Recent Activity.
- **My Products:** búsqueda y gestión de artículos, variantes, publicaciones, historial, Restore, Unlist y Move to Trash mediante acciones autorizadas.
- **Community:** My Posts y Recent Received para gestionar publicaciones y abrir sus conversaciones.
- **Analytics:** métricas calculadas con los datos existentes; no inventa ventas ni actividad.
- **Sales & Revenue:** ingresos, ventas, productos vendidos y adquisiciones gratuitas, períodos, productos, gráfico, rendimiento por variante e historial paginado. Conserva atribución histórica.
- **Account Status:** restricciones, sanciones y apelaciones de la cuenta.
- **Creator Verification:** elegibilidad y solicitudes según las reglas vigentes. Admin tiene verificación permanente.

## Administración

Admin Workspace integra Dashboard, Accounts y las herramientas autorizadas de moderación, auditoría, verificación y Storage. Los casos se consultan en listados y drawers; no se conceden permisos por mostrar estas páginas. Moderator tiene un alcance limitado y no puede modificar la identidad ni protección de Admin.

Las acciones administrativas sobre productos ajenos se gestionan en el workspace. Product Details no muestra un menú administrativo de tres puntos. El propietario conserva Edit Item y Move to Trash en lugar de Add to Bag.

## Organización técnica

`src/main.ts` declara la navegación; `src/app/app.ts` integra el shell y el menú global. `features/` agrupa páginas por responsabilidad, `core/` reúne autenticación y servicios compartidos, y `shared/` conserva componentes reutilizables, identidad, comunidad, productos y visor. CSS y plantillas permanecen junto a sus componentes cuando corresponde. `public/` contiene únicamente recursos estáticos distribuibles.

La configuración proxy conserva las solicitudes a `/api` en el mismo origen del navegador. Dev Console descubre la dirección LAN del equipo; las direcciones privadas de una computadora no se incrustan en la aplicación. Las guardas de navegación ayudan a la experiencia del usuario; la autorización definitiva siempre corresponde al backend.

Los drawers y menús conservan cierre con X, Escape y clic exterior, foco visible y restauración del foco. Los formularios sensibles protegen cambios sin guardar. Las animaciones deben respetar `prefers-reduced-motion`. La carga 3D debe mantener dimensiones válidas y estados de carga y error; Safari de iPhone puede tardar en cargar sin que eso implique automáticamente un fallo.

## Revisión de una instalación nueva

1. Abrir Storefront y los dos productos académicos; cambiar colores y manipular el visor.
2. Iniciar sesión con Admin y comprobar Creator Studio, Settings y Admin Workspace.
3. Crear cuentas y contenido solo en un entorno de evaluación si se desean probar flujos de comprador, comunidad o moderación.
4. Para pagos, utilizar exclusivamente las opciones ficticias indicadas por Checkout.

La propuesta académica describe el alcance entregado; no es una autorización para conectar pagos reales ni desplegar la autenticación académica en producción.

**Creadora de ALTEGO:** Shakiara Feliciano Navarro.
