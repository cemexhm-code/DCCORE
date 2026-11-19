// Base de datos SQLite (un solo archivo en data/portal.db)
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'politicas'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'firmas'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'videos'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'portal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS empleados (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  numero    TEXT NOT NULL UNIQUE,
  nombre    TEXT NOT NULL,
  area      TEXT,
  creado    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sesiones (
  token        TEXT PRIMARY KEY,
  tipo         TEXT NOT NULL CHECK (tipo IN ('empleado','admin')),
  empleado_id  INTEGER REFERENCES empleados(id) ON DELETE CASCADE,
  creado       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS politicas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo       TEXT,
  titulo       TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT '1.0',
  descripcion  TEXT,
  area         TEXT,
  tipo         TEXT NOT NULL CHECK (tipo IN ('pdf','texto')),
  archivo      TEXT,
  contenido    TEXT,
  hash         TEXT NOT NULL,
  activa       INTEGER NOT NULL DEFAULT 1,
  creada       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS firmas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
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
  creada            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (politica_id, empleado_id)
);
`);

module.exports = { db, DATA_DIR };
