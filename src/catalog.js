const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS status (
  n_url       INTEGER PRIMARY KEY,
  status      TEXT NOT NULL,
  ext         TEXT,
  tentativas  INTEGER DEFAULT 0,
  marcar_db   INTEGER DEFAULT 0,
  uploaded    INTEGER DEFAULT 0,
  erro        TEXT,
  ts          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_status ON status(status);
CREATE INDEX IF NOT EXISTS idx_upload ON status(uploaded);
CREATE INDEX IF NOT EXISTS idx_marcar ON status(marcar_db);
`;

function abrirCatalogo(caminho) {
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const upsert = db.prepare(`
    INSERT INTO status (n_url, status, ext, tentativas, marcar_db, uploaded, erro, ts)
    VALUES (@n_url, @status, @ext, @tentativas, @marcar_db, @uploaded, @erro, @ts)
    ON CONFLICT(n_url) DO UPDATE SET
      status=excluded.status, ext=excluded.ext, tentativas=excluded.tentativas,
      marcar_db=excluded.marcar_db, uploaded=excluded.uploaded, erro=excluded.erro, ts=excluded.ts
  `);

  function marcar(nUrl, status, campos = {}) {
    upsert.run({
      n_url: nUrl, status,
      ext: campos.ext ?? null,
      tentativas: campos.tentativas ?? 0,
      marcar_db: campos.marcar_db ?? 0,
      uploaded: campos.uploaded ?? 0,
      erro: campos.erro ?? null,
      ts: campos.ts ?? Math.floor(Date.now() / 1000),
    });
  }

  function obterStatus(nUrl) {
    return db.prepare('SELECT * FROM status WHERE n_url=?').get(nUrl) || null;
  }

  function jaProcessado(nUrl) {
    const r = db.prepare("SELECT status FROM status WHERE n_url=?").get(nUrl);
    return !!r && (r.status === 'baixada' || r.status === 'sem_imagem');
  }

  const inserirExistentesTx = db.transaction((nUrls) => {
    for (const n of nUrls) marcar(n, 'baixada', { uploaded: 1 });
  });
  function inserirExistentes(nUrls) { inserirExistentesTx(nUrls); }

  function pendentesParaUpload() {
    return db.prepare("SELECT n_url, ext FROM status WHERE status='baixada' AND uploaded=0").all();
  }
  function pendentesParaMarcarDb() {
    return db.prepare("SELECT n_url FROM status WHERE marcar_db=1").all().map(r => r.n_url);
  }

  const confirmarUploadTx = db.transaction((nUrls) => {
    const st = db.prepare('UPDATE status SET uploaded=1 WHERE n_url=?');
    for (const n of nUrls) st.run(n);
  });
  function confirmarUpload(nUrls) { confirmarUploadTx(nUrls); }

  const confirmarMarcacaoTx = db.transaction((nUrls) => {
    const st = db.prepare('UPDATE status SET marcar_db=0 WHERE n_url=?');
    for (const n of nUrls) st.run(n);
  });
  function confirmarMarcacaoDb(nUrls) { confirmarMarcacaoTx(nUrls); }

  function estatisticas() {
    const rows = db.prepare('SELECT status, COUNT(*) c FROM status GROUP BY status').all();
    const out = {};
    for (const r of rows) out[r.status] = r.c;
    return out;
  }

  function fechar() { db.close(); }

  return {
    marcar, obterStatus, jaProcessado, inserirExistentes,
    pendentesParaUpload, pendentesParaMarcarDb,
    confirmarUpload, confirmarMarcacaoDb, estatisticas, fechar,
  };
}

module.exports = { abrirCatalogo };
