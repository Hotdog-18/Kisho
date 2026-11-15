/* 駒音「パシッ!」
 * 録音した本物の駒音を測って作った。特徴:
 *  - 約16msおきの3連打(強・中・弱)。「パ・シ・ッ」に聞こえる
 *  - 音の中心は約10kHzの高域。低い成分(トッ)はほぼ無い
 *  - 約130msでほぼ消える
 * 音程が動く音は使わず、ノイズをフィルタに通して作る(だから「ピュウ」にならない)。 */
(function () {
  'use strict';
  // 録音を測ると、音は「ほぼ白色ノイズ(全帯域がほぼ平ら、高域がやや強い)」だった。
  // 3連打のあとに、高域寄りの余韻が約130msかけて消える。
  const HITS = [[0, 1.0], [0.015, 0.55], [0.030, 0.22]]; // [開始秒, 音量]
  const P = { hit: 0.55, hitTau: 0.005, air: 0.08, airF: 10000, tail: 0.05, tailTau: 0.032, tailF: 2000, master: 3.4 };

  function makeNoise(ac, sec) {
    const n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // ac: AudioContext か OfflineAudioContext。out: つなぎ先(省略で ac.destination)
  function create(ac, out, tune) {
    const p = Object.assign({}, P, tune || {});
    const noise = makeNoise(ac, 0.2);
    const bus = ac.createDynamicsCompressor(); bus.threshold.value = -4; bus.ratio.value = 4;
    const master = ac.createGain(); master.gain.value = p.master;
    bus.connect(master); master.connect(out || ac.destination);
    const voice = (at, type, f, q, vol, tau) => {
      const ns = ac.createBufferSource(); ns.buffer = noise;
      const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ac.createGain(); g.gain.setValueAtTime(vol, at); g.gain.setTargetAtTime(0, at, tau); // 指数で減衰
      ns.connect(fl); fl.connect(g); g.connect(bus); ns.start(at); ns.stop(at + tau * 7);
    };
    return {
      play(t0, v) {
        const t = (t0 === undefined ? ac.currentTime : t0) + 0.003, k = v || (0.97 + Math.random() * 0.06);
        HITS.forEach(([dt, amp]) => {
          voice(t + dt, 'highpass', 250, 0.7, amp * p.hit, p.hitTau);              // 全帯域のパチッ
          voice(t + dt, 'bandpass', p.airF * k, 0.8, amp * p.air, p.hitTau * 1.4); // 高域の「シャ」
        });
        voice(t + HITS[2][0], 'highpass', p.tailF * k, 0.7, p.tail, p.tailTau);    // 余韻
      },
    };
  }
  window.KishoSound = { create, params: P };
})();
