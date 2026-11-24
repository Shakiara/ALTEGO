// ALTEGO necesita resolver la validación de las variables de configuración.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export function readConfig(env = process.env) {
  function port(name, fallback) {
    const raw = env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
      throw new Error(`${name} must be a port between 1 and 65535.`);
    }
    return Number(raw);
  }
  if (env.MYSQL_PASSWORD === undefined || env.MYSQL_PASSWORD === 'replace_with_local_password') {
    throw new Error('Set MYSQL_PASSWORD in the project .env file or environment.');
  }
  return {
    port: port('PORT', 3000),
    mysql: {
      host: env.MYSQL_HOST || '127.0.0.1',
      port: port('MYSQL_PORT', 3306),
      user: env.MYSQL_USER || 'root',
      password: env.MYSQL_PASSWORD,
      database: env.MYSQL_DATABASE || 'tienda_avatares_2053',
      decimalNumbers: true,
      connectionLimit: 10,
      connectTimeout: 10000
    },
    mongo: {
      uri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
      database: env.MONGODB_DATABASE || 'tienda_avatares_2053'
    }
  };
}
