# ALTEGO - Avatar Accessories

ALTEGO es un proyecto que consiste en una tienda virtual de accesorios 3D inspirada en el UGC de Roblox, donde los usuarios pueden explorar, publicar y adquirir accesorios de forma simulada.

## Tecnologías utilizadas

- Angular
- Node.js y Express
- MySQL
- MongoDB
- C# y WPF

## Requisitos

- Windows
- Node.js 22.22.3 o una versión LTS compatible más reciente
- MySQL Server 8.0 y MySQL Workbench
- MongoDB Community Server y MongoDB Compass

## Instalación

### 1. MySQL

Abrir MySQL Workbench y ejecutar el archivo `database/mysql.sql`.

### 2. MongoDB

Abrir MongoDB Compass, conectarse al servidor y abrir la consola integrada (MongoDB Shell).

Ejecutar:

```javascript
use tienda_avatares_2053
```

Copiar y pegar todo el contenido del archivo `database/mongodb.js` en la consola y ejecutarlo como un solo bloque.

### 3. Configuración

Crear una copia del archivo `.env.example` con el nombre `.env`.

Modificar `MYSQL_PASSWORD` con la contraseña de MySQL y verificar que las conexiones y los nombres de las bases de datos sean correctos.

### 4. Instalar dependencias

Desde la carpeta principal del proyecto, ejecutar:

```bash
npm ci
```

### 5. Inicializar el proyecto

```bash
npm run setup -- --initialize
```

Este comando importa los recursos iniciales al Storage y elimina la carpeta `seed-assets/` una vez completada la inicialización.

Los pasos de instalación deben realizarse con bases de datos nuevas.

### 6. Ejecutar el proyecto

```bash
npm start
```

En ALTEGO Dev Console, presionar **Start Servers** para iniciar el backend y el frontend.

Abrir en el navegador:

http://localhost:4200

También se puede utilizar la consola de texto:

```bash
npm run console
```

## Cuenta de administrador

| Username | Password |
| --- | --- |
| Admin | default |

## Documentación

- [Backend](docs/BACKEND.md)
- [Frontend](docs/FRONTEND.md)
- [Base de datos](docs/DATABASE.md)
- [Propuesta del proyecto](docs/propuesta.pdf)


## Tech Stack

### Frontend

![Angular](https://img.shields.io/badge/Angular-DD0031?style=flat-square&logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-663399?style=flat-square&logo=css&logoColor=white)

### Backend

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-333333?style=flat-square&logo=express&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)

### Database

![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=flat-square&logo=mysql&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)

### Dev Console & Scripts

![C#](https://img.shields.io/badge/C%23-68217A?style=flat-square&logoColor=white)
![WPF](https://img.shields.io/badge/WPF-512BD4?style=flat-square&logo=dotnet&logoColor=white)
![PowerShell](https://img.shields.io/badge/PowerShell-2671BE?style=flat-square&logoColor=white)


## Autora

Shakiara Feliciano Navarro

Proyecto individual — COMP 2053 (Full-Stack).