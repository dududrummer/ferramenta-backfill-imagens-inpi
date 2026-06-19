const crypto = require('crypto');

function temPrefixo(buf, bytes) {
  if (buf.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[i] !== bytes[i]) return false;
  return true;
}

function detectarExt(buf) {
  if (!buf || buf.length === 0) return null;
  if (temPrefixo(buf, [0xFF, 0xD8, 0xFF])) return 'jpg';
  if (temPrefixo(buf, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'png';
  if (temPrefixo(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (temPrefixo(buf, [0x42, 0x4D])) return 'bmp';
  if (buf.length >= 12 &&
      temPrefixo(buf, [0x52, 0x49, 0x46, 0x46]) &&            // 'RIFF'
      buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function ehImagemValida(buf) {
  return detectarExt(buf) !== null;
}

function ehPlaceholder(buf, hashesConhecidos) {
  if (!hashesConhecidos || hashesConhecidos.length === 0) return false;
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  return hashesConhecidos.includes(hash);
}

module.exports = { detectarExt, ehImagemValida, ehPlaceholder };
