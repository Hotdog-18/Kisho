// AI用 Web Worker: 画面が固まらないよう、考える処理はここで行う
importScripts('shogi.js', 'ai.js');
const engine = new KishoAI.Engine(19);
onmessage = (e) => {
  const m = e.data;
  try {
    const out = KishoAI.runTask(engine, m, (i, n) => postMessage({ id: m.id, progress: [i, n] }));
    postMessage({ id: m.id, done: true, result: out });
  } catch (err) {
    postMessage({ id: m.id, done: true, error: String(err && err.message || err) });
  }
};
