// Seletor de backend de rede: 'tor' (padrão, daily/atualizações) ou 'proxy' (re-raspagem em massa).
// Ambos expõem a MESMA interface ({ circuitos, proximoCircuito, podeRotacionar, registrarRotacao, newnym }),
// então o resto da ferramenta (runner/despacho-runner) não muda.
const { criarPool } = require('./tor-pool');
const { criarPoolProxy } = require('./proxy-pool');

function criarPoolBackend(cfg) {
  return cfg.backend === 'proxy' ? criarPoolProxy(cfg) : criarPool(cfg);
}

module.exports = { criarPoolBackend };
