// Base de datos Postgres (en Vercel: Neon desde Storage → Marketplace; crea DATABASE_URL)
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) console.warn('⚠️  Falta DATABASE_URL (conexión a Postgres).');

const local = /localhost|127\.0\.0\.1/.test(url || '');
const pool = new Pool({
  connectionString: url,
  ssl: local ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
});

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS empleados (
  id      SERIAL PRIMARY KEY,
  numero  TEXT NOT NULL UNIQUE,
  nombre  TEXT NOT NULL,
  area    TEXT,
  creado  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sesiones (
  token        TEXT PRIMARY KEY,
  tipo         TEXT NOT NULL CHECK (tipo IN ('empleado','admin')),
  empleado_id  INTEGER REFERENCES empleados(id) ON DELETE CASCADE,
  creado       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS politicas (
  id           SERIAL PRIMARY KEY,
  codigo       TEXT,
  titulo       TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT '1.0',
  descripcion  TEXT,
  area         TEXT,
  tipo         TEXT NOT NULL CHECK (tipo IN ('pdf','texto')),
  archivo      TEXT,
  contenido    TEXT,
  hash         TEXT NOT NULL,
  activa       BOOLEAN NOT NULL DEFAULT true,
  creada       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS firmas (
  id                SERIAL PRIMARY KEY,
  folio             TEXT NOT NULL UNIQUE,
  politica_id       INTEGER NOT NULL REFERENCES politicas(id),
  empleado_id       INTEGER NOT NULL REFERENCES empleados(id),
  nombre_firmante   TEXT NOT NULL,
  frase             TEXT NOT NULL,
  firma_archivo     TEXT NOT NULL,
  video_archivo     TEXT NOT NULL,
  video_tipo        TEXT,
  hash_politica     TEXT NOT NULL,
  hash_firma        TEXT NOT NULL,
  hash_video        TEXT NOT NULL,
  segundos_lectura  INTEGER,
  ip                TEXT,
  user_agent        TEXT,
  creada            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (politica_id, empleado_id)
);`;

let listo;
function preparar() {
  if (!listo) listo = pool.query(ESQUEMA).catch((e) => { listo = null; throw e; });
  return listo;
}

async function q(sql, params = []) {
  await preparar();
  return (await pool.query(sql, params)).rows;
}
const uno = async (sql, params) => (await q(sql, params))[0];

module.exports = { q, uno, pool };
