const { execFile } = require('child_process');

function montarSshArgs(ssh) {
  const args = [];
  if (ssh.key) args.push('-i', ssh.key);
  if (ssh.port) args.push('-p', String(ssh.port));
  args.push(`${ssh.user}@${ssh.host}`);
  return args;
}

// Roda um comando de shell — LOCALMENTE (modo servidor) ou no servidor via SSH (modo remoto).
// Mesmo comando, lugar diferente. opts._execFile permite injetar nos testes.
function criarExecutor(cfg, opts = {}) {
  const execFn = opts._execFile || execFile;
  return function rodar(comando) {
    return new Promise((resolve, reject) => {
      let bin, args;
      if (cfg.modo === 'servidor') { bin = 'bash'; args = ['-c', comando]; }
      else { bin = 'ssh'; args = [...montarSshArgs(cfg.ssh), comando]; }
      execFn(bin, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
  };
}

module.exports = { criarExecutor, montarSshArgs };
