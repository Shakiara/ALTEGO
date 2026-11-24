# ALTEGO - Avatar Accessories

Aplicación académica de **Shakiara Feliciano Navarro**, desarrollada individualmente para COMP 2053. Permite explorar accesorios 3D, publicar variantes de color, participar en la comunidad y realizar adquisiciones simuladas.

## Compatibilidad oficial

Esta versión de ALTEGO está diseñada y validada para **Windows**. La Dev Console gráfica está desarrollada en **C# y WPF** y es exclusiva de Windows. Se conserva la consola de texto mediante `npm run console`, también dentro del entorno Windows soportado.

Aunque Angular, Node.js, MySQL y MongoDB son tecnologías multiplataforma, **macOS y Linux no son sistemas oficialmente compatibles con esta versión del proyecto**. Las instrucciones de instalación y arranque de este documento corresponden a Windows.

## Requisitos

- **Sistema operativo:** Windows.
- **Node.js y npm:** Node 22.22.3 o posterior de la rama 22, 24.15.0 o posterior de la rama 24, o 26 o posterior. Usar una versión LTS compatible. npm viene con Node; las dependencias quedan fijadas mediante lockfiles.
- **MySQL Server 8.0** y **MongoDB Community Server**, encendidos antes de instalar e iniciar ALTEGO.
- **MySQL Workbench** y **MongoDB Compass con su consola mongosh integrada** para seguir la instalación manual. No es necesario instalar MongoDB Shell por separado.
- **Navegador moderno** con WebGL para los modelos 3D.
- **Dev Console gráfica:** Windows con .NET Framework, su compilador C# y WPF. No necesita .NET SDK. La consola de texto permite iniciar la aplicación en Windows sin abrir la interfaz gráfica; no implica compatibilidad con macOS o Linux.

No se requieren Angular CLI global, ni Blender. Angular utiliza la dependencia local. Se necesita acceso a Internet para reinstalar paquetes npm; los recursos académicos GLB/PNG están incluidos.

## Quick Start - instalación manual desde cero

Usar una carpeta nueva y bases vacías. **Nunca ejecutar los inicializadores sobre una instalación con datos.** Si ya existen las bases predeterminadas, elegir otros nombres y utilizarlos coherentemente en los scripts y `.env`.

1. En MySQL Workbench, abrir y ejecutar **database/mysql.sql** completo. Crea la base `tienda_avatares_2053`, sus relaciones, índices, triggers, Admin y dos productos académicos.
2. Conectarse al servidor MongoDB desde **MongoDB Compass** y abrir su consola integrada **Open MongoDB shell** (mongosh). Seleccionar una base nueva; ejecutar este comando por separado y pulsar Enter:

   ```javascript
   use tienda_avatares_2053
   ```

   Abrir **database/mongodb.js** en un editor de texto, seleccionar y copiar **todo** su contenido. Pegar el archivo completo en la entrada de la consola integrada y pulsar Enter para ejecutarlo como un único bloque, incluidas sus llaves exteriores. No ejecutarlo línea por línea ni utilizar comandos para cargar archivos. No se necesita MongoDB Shell independiente ni PowerShell para este paso.

   El resultado debe identificar la base seleccionada, las colecciones `resenas` y `academic_products`, `academicProducts: 2` y `reviews: 0`. Si se eligió otro nombre, utilizar ese mismo destino en `MONGODB_DATABASE`. El script rechaza cualquier base que ya contenga colecciones; si falla, revisar el mensaje y conservar el destino parcial sin repetirlo ni borrar datos.

3. Copiar `.env.example` a `.env`. Configurar `MYSQL_PASSWORD` con la contraseña del MySQL local y revisar los nombres y conexiones de ambas bases. No cambiar el código para configurar credenciales.
4. Desde la raíz del proyecto, instalar las dependencias:

   ```sh
   npm ci
   ```

   El script raíz instala también backend y frontend mediante sus lockfiles. No ejecutar este comando mientras los servidores utilizan esos paquetes.

5. Completar exclusivamente la semilla recién instalada y preparar su Storage:

   ```sh
   npm run setup -- --initialize
   ```

   Este paso verifica el esquema y los datos iniciales antes de copiar los recursos académicos. Rechaza instalaciones utilizadas y nunca restablece cuentas. Los archivos se crean dentro del Storage local; no se distribuyen datos activos.

6. Iniciar ambos servidores desde la raíz:

   ```sh
   npm start
   ```

   En Windows se abre ALTEGO Dev Console. Utilizar **Start Servers** si aún están detenidos. Abrir **http://localhost:4200**. MySQL y MongoDB deben seguir encendidos.

### Cuenta académica inicial

- Username de acceso: **Admin** (identificador canónico `admin`).
- Email académico: **admin@altego.test**.
- Contraseña académica inicial: **default**.


## Instalación opcional desde Dev Console

Después de instalar Node, MySQL y MongoDB, ejecutar `npm start`. En **Setup & Installation**, comprobar requisitos, instalar dependencias, configurar conexiones y seleccionar **Initialize Databases** con nombres nuevos y Storage nuevo. Esta opción utiliza los mismos inicializadores que la instalación manual y exige confirmación explícita. **No inicializa, actualiza ni sobrescribe bases existentes.** Si ya se ejecutaron ambos scripts manualmente, completar el paso 5 del Quick Start y utilizar **Verify Installation**.

Alternativa por terminal para destinos todavía inexistentes:

```sh
npm ci
npm run setup -- --new
npm run console
```

La consola de texto muestra sus controles de inicio y detención. Para salir, utilizar el control de cierre o Ctrl+C; no cerrar MySQL/MongoDB para detener solamente ALTEGO.

## Configuración y acceso LAN

`.env` en la raíz es la fuente de configuración local. Backend, proxy y consola leen ese archivo; las variables del entorno tienen prioridad. No distribuir `.env` ni copiar contraseñas al frontend. `.env.example` es una plantilla segura.

| Variable | Uso |
| --- | --- |
| MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE | Conexión MySQL local |
| MONGODB_URI, MONGODB_DATABASE | Conexión y base documental |
| PORT, WEB_PORT | Puertos de Express y Angular; predeterminados 3000 y 4200 |
| ALTEGO_STORAGE_ROOT | Destino opcional; vacío utiliza `storage/` junto al proyecto |
| FRONTEND_ORIGIN | Origen local adicional autorizado, si se usa otro puerto |

Desde el equipo anfitrión se utiliza `localhost:4200`. Con Dev Console, Angular escucha también en las interfaces de red disponibles: otro dispositivo de la misma red puede abrir la dirección LAN mostrada dinámicamente por la consola. No hay que incrustar una IPv4 en el código. El firewall del equipo debe permitir el puerto de Angular en la red privada. El backend y las bases no necesitan exponerse directamente a la red.

## Organización y documentación

```text
seed-assets/       Semillas distribuibles; se retiran al finalizar la inicialización
backend/           Express; módulos de dominio, infraestructura y validación
frontend/          Fuentes Angular, estilos, recursos y configuración
database/          mysql.sql, mongodb.js y README.md
scripts/           Arranque, Dev Console, instalación y mantenimiento
docs/              BACKEND.md, FRONTEND.md, DATABASE.md y propuesta.pdf
.env.example       Plantilla; crear .env únicamente en la instalación local
```

- [Backend y reglas de seguridad](docs/BACKEND.md).
- [Páginas, navegación y frontend](docs/FRONTEND.md).
- [Modelo de datos, recursos e instalación](docs/DATABASE.md).
- [Instrucciones de las bases](database/README.md).
- [Propuesta académica](docs/propuesta.pdf).

Dependencias, compilaciones, Storage, sesiones y configuraciones locales no forman parte de la distribución. Se generan al instalar o utilizar ALTEGO y quedan excluidos por `.gitignore`. Las pruebas y registros históricos del desarrollo se conservan fuera del proyecto y no son necesarios para ejecutarlo.

## Comandos útiles

```sh
npm start          # Dev Console gráfica en Windows
npm run console    # Consola de texto en Windows
npm run build      # Compilación Angular
npm run check:api  # Comprobaciones HTTP de solo lectura, con servidores iniciados
```

Las herramientas de mantenimiento requieren conocer sus opciones y respaldar los datos antes de operaciones con escritura. No son pasos de una instalación normal. No ejecutar purgas o restauraciones sobre datos que se deban conservar.

## Solución de problemas

- **Conexión rechazada:** comprobar que los dos servicios de bases estén encendidos y que `.env` corresponda a sus puertos y credenciales.
- **Destino existente:** el instalador lo rechaza deliberadamente. Elegir un destino nuevo; no borrar una base para superar la comprobación.
- **Instalación parcial:** no repetir inicializadores sobre contenido existente. Revisar el error y conservar los datos antes de decidir su recuperación.
- **Paquetes ausentes:** ejecutar `npm ci` desde la raíz, con los servidores detenidos.
- **Puerto ocupado:** detener la instancia que corresponda o configurar otros puertos; no cerrar procesos ajenos.
- **Visor 3D:** comprobar WebGL y esperar a que termine la carga. En Safari de iPhone la carga puede tardar. La experiencia principal está diseñada para escritorio; el diseño móvil puede tener limitaciones.
- **Consola gráfica WPF no disponible en Windows:** utilizar `npm run console` para el modo de texto y revisar los componentes de .NET Framework. Este modo no habilita soporte para macOS o Linux.

**Antecedente de seguridad conservado:** El proyecto conserva como riesgo conocido once alertas altas de Picomatch en herramientas de desarrollo, pendientes de parche oficial. No se aplican actualizaciones mayores forzadas.

**Estado comprobado el 24/11/2026:** el aviso [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) fue retirado por no considerarse un problema de seguridad. El audit actual del frontend, incluidas las dependencias de desarrollo y el lockfile, devuelve cero alertas. El antecedente anterior se conserva como registro; no describe un aviso activo en esta comprobación. No se modificaron dependencias para obtener este resultado.

ALTEGO es un proyecto académico de uso local. Su autenticación académica y sus pagos simulados no están preparados para producción pública. No utilizar datos financieros reales ni publicar la instalación como un servicio de producción.

**Autora:** Shakiara Feliciano Navarro. Proyecto individual COMP 2053.

## Storage de productos

Las instalaciones nuevas utilizan `storage/{username}/{nombre-inicial}--p{id}/versions/v{n}/{glb|png}/{sha256}.{ext}`. El nombre legible se fija al incorporar el primer archivo; el ID estable evita colisiones y el título puede cambiar sin romper rutas. Solo los contenidos nuevos o modificados crean archivos en otra carpeta; precio, descripción, nombre o visibilidad se guardan en MySQL y no duplican binarios. Los índices derivados relacionan variantes, snapshots y rutas físicas.

`seed-assets/` contiene únicamente semillas para reconstruir instalaciones. El instalador verifica sus hashes e importa los dos productos al mismo Storage normal que las cargas de cualquier creador. Después, previews, versiones y descargas no leen esas semillas. No incluir Storage activo en Git ni en el ZIP.

El baseline incluye 037. Una instalación anterior requiere preparar el esquema con respaldo y revisión antes de activarlo; no ejecutar `setup` sobre datos utilizados. El resolutor conserva lectura del formato anterior y no mueve automáticamente recursos ni respaldos personales.

## Recursos de inicialización

El instalador comprueba los 31 archivos (dos GLB y 29 PNG), sus hashes, los snapshots y las referencias de los dos productos y sus 29 variantes en el Storage definitivo. Su última operación retira únicamente `seed-assets/` de esa copia instalada. Si la inicialización falla, conserva o restaura las semillas; nunca vacía destinos existentes. Una instalación ya inicializada se detecta sin volver a crear ni modificar datos.

Después, el arranque, Dev Console, Verify Installation, las vistas previas, las variantes, las versiones y las descargas utilizan Storage y las bases; no necesitan las semillas. `npm ci` y `npm run build` tampoco dependen de ellas. Para otra instalación completamente nueva, recuperar `seed-assets/` desde el ZIP original o el repositorio y elegir bases y Storage nuevos.

`seed-assets/` está incluido en el ZIP y en Git, y no se ignora. En un clon instalado, Git mostrará sus archivos rastreados como eliminados localmente: el instalador no hace commits, pushes ni cambios remotos. No incorporar esas eliminaciones a la distribución. Para preparar otra copia o volver a empaquetar, recuperar la carpeta del ZIP original o usar `git restore -- seed-assets` en el clon adecuado. La distribución limpia conserva las semillas y no contiene Storage activo.
