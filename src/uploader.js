const { spawn } = require('child_process');

function montarArgsRsync({ staging, ssh, remoteImageDir }) {
  const stagingSrc = staging.endsWith('/') ? staging : staging + '/';
  const sshParts = ['ssh'];
  if (ssh.key) sshParts.push('-i', ssh.key);
  if (ssh.port) sshParts.push('-p', String(ssh.port));
  const destino = `${ssh.user}@${ssh.host}:${remoteImageDir.replace(/\/?$/, '/')}`;
  return ['-a', '-e', sshParts.join(' '), stagingSrc, destino];
}

function sincronizar(cfg, opts = {}) {
  const spawnFn = opts._spawn || spawn;
  const args = montarArgsRsync({
    staging: cfg.localStaging, ssh: cfg.ssh, remoteImageDir: cfg.remoteImageDir,
  });
  return new Promise((resolve, reject) => {
    const p = spawnFn('rsync', args, { stdio: 'inherit' });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`rsync saiu com código ${code}`)));
  });
}

module.exports = { montarArgsRsync, sincronizar };
