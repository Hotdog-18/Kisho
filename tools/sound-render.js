// 駒音を OfflineAudioContext で書き出して WAV にする (調整用)
// 使い方: node tools/sound-render.js out.wav [JSON: tune]
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const out = process.argv[2] || 'clack.wav', tune = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<html></html>'); await p.addScriptTag({ path: path.join(__dirname, '../js/sound.js') });
  const arr = await p.evaluate(async (tune) => {
    const sr = 48000, ac = new OfflineAudioContext(1, sr * 0.5, sr);
    window.KishoSound.create(ac, ac.destination, tune).play(0.02, 1);
    const buf = await ac.startRendering(); return Array.from(buf.getChannelData(0));
  }, tune);
  const sr = 48000, n = arr.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  arr.forEach((v, i) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  fs.writeFileSync(out, buf); await b.close(); console.log('wrote', out);
})();
