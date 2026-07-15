// Gera 2 WAVs curtos (PCM 16-bit mono) para o feedback do scanner.
// Rodar uma vez: node scripts/gen-beeps.mjs
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100;

function tone(freq, ms, vol = 0.6) {
  const n = Math.floor((SR * ms) / 1000);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 200, (n - i) / 200); // fade in/out anti-clique
    const s = Math.sin((2 * Math.PI * freq * i) / SR) * vol * env;
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2);
  }
  return buf;
}

function silence(ms) {
  return Buffer.alloc(Math.floor((SR * ms) / 1000) * 2);
}

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const outDir = path.resolve('assets/sounds');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'beep-success.wav'), wav(tone(1200, 120)));
fs.writeFileSync(
  path.join(outDir, 'beep-error.wav'),
  wav(Buffer.concat([tone(400, 100), silence(60), tone(400, 100)]))
);
console.log('Beeps gerados em', outDir);
