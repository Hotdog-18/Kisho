# KISHO 棋匠

友達と指せる将棋サイトです。合言葉の部屋で対局でき、AIとの練習、棋譜の振り返り、独自レーティング KRS が付いています。

- 依存ライブラリなし。HTML / CSS / JavaScript だけで動きます (ビルド不要)
- PC・タブレット・スマホに対応
- 駒と盤のデザインを選べます (駒6種・盤6種)

## 機能

| 機能 | 内容 |
| --- | --- |
| ルール | 二歩・打ち歩詰め・行き所のない駒・成り (強制/任意)・千日手・連続王手の千日手・入玉宣言(27点法)・持将棋 |
| AIと指す | 10段階 (入門〜棋匠)。ブラウザ内の Web Worker で動くので、サーバーは不要 |
| 友達と指す | 合言葉の部屋。リアルタイム対局と通信将棋 (好きな時に1手ずつ)。チャット付き |
| 時計 | 持ち時間 + 秒読み / 切れ負け / 無制限 |
| 棋譜 | 自動保存、再生、KIF 形式でコピー・ダウンロード |
| AIによる振り返り | 一手ごとに最善手との差を評価 (最善・好手・緩手・疑問手・悪手)。勝率グラフ、最善手の矢印、正確度 |
| KRS | KISHO 独自のレーティング (下記) |

## KRS (KISHO RATING SYSTEM / 棋匠レーティング)

**KRS は KISHO 独自のレーティングです。日本将棋連盟などの公的な団体の段級位・レーティングとは関係ありません。**

チェスの Elo と同じ考え方です。

```
期待勝率 E = 1 / (1 + 10^((相手 - 自分) / 400))
新しい KRS = 今の KRS + K × (結果 - E)      結果: 勝ち=1 / 引き分け=0.5 / 負け=0
K = 40 (〜19局) / 28 (20〜59局) / 20 (60局〜)     最初は 1000 から
```

- AI のKRSは、AI同士で対戦させた結果から出した目安です (`tools/calibrate.js`)
- 「待った」を使った対局、同じ画面での対局、手数が少ない対局は反映されません
- 通信将棋では KRS は変わりません
- KRS はブラウザ (localStorage) に保存されます。ブラウザのデータを消すとリセットされます

## ローカルで動かす

```sh
cd kisho
python3 -m http.server 8000     # そのあと http://localhost:8000 を開く
```

`index.html` をダブルクリックして開いても動きます (その場合 AI は Web Worker を使わず画面の中で動くため、強いレベルでは考え中に少し固まります)。

## 友達とオンラインで対局できるようにする (Supabase・無料枠)

何も設定しなくても、同じブラウザの別タブ同士なら部屋が使えます (お試し用)。友達とつなぐには、無料の [Supabase](https://supabase.com) プロジェクトを用意します。

1. Supabase で新しいプロジェクトを作る
2. **SQL Editor** に `supabase/schema.sql` の中身を貼って Run (通信将棋の保存用。リアルタイム対局には不要)
3. **Project Settings → API** の `Project URL` と `anon public` キーを `js/config.js` に貼る
   - `service_role` キーは **絶対に** 書かないでください
4. リアルタイム対局は Supabase Realtime の Broadcast を使います。追加設定は要りません

合言葉は、そのまま送られず SHA-256 ハッシュにして使います。ただし、合言葉を知っている人は誰でも同じ部屋に入れます。強い合言葉にしてください。

### メール通知 (任意・通信将棋用)

1. [Resend](https://resend.com) で API キーを作る (無料枠あり)
2. Supabase CLI で関数をデプロイ

   ```sh
   supabase functions deploy notify
   supabase secrets set RESEND_API_KEY=... NOTIFY_FROM="KISHO <noreply@あなたのドメイン>"
   ```
3. `js/config.js` の `notifyFunction` を `true` にする

通知は同じ宛先に10分に1通までです。

## 公開する

静的ファイルだけなので、GitHub Pages でそのまま公開できます (Settings → Pages → ブランチを選ぶ)。サーバー側の処理は Supabase の Edge Function だけです。

## テスト

```sh
node tests/perft.js 5     # 初期局面から5手先までの合法手の数が公開されている正解値と一致するか
node tests/rules.js       # 二歩・打ち歩詰め・成り・千日手・SFEN 往復など
node tests/ai.js          # AI・KRS・振り返り
```

画面の動作確認は Playwright で行いました (`tests/ui.js` `tests/ui2.js` `tests/room.js` `tests/misc.js`。要 `python3 -m http.server 8765`)。

## 構成

```
index.html
css/style.css
js/shogi.js    将棋のルールエンジン (盤面・合法手・千日手・KIF出力)
js/ai.js       探索AI (アルファベータ + 反復深化 + 置換表) と棋譜の解析
js/krs.js      KRS の計算
js/worker.js   AI を別スレッドで動かす
js/themes.js   駒と盤のデザイン一覧 (見た目は css/style.css)
js/app.js      画面と対局の進行
js/room.js     合言葉の部屋
js/net.js      通信 (Supabase / 同じブラウザ内)
js/config.js   Supabase の設定
supabase/      schema.sql と メール通知の Edge Function
tools/calibrate.js   AI同士の対戦で強さを測る
```

## 既知の制限

- AI は「駒の価値 + 位置」だけの簡単な評価で動いています。プロや強い将棋ソフトのような強さはなく、練習相手向けです。振り返りの評価も同じAIによる目安です
- リアルタイム対局の途中でページを再読み込みすると、その対局は続けられません (通信将棋は続きから再開できます)
- KRS や対局結果は各自のブラウザで計算されるので、友達同士で遊ぶ前提です。不正を防ぐ仕組みはありません
- Supabase とメール通知の部分は、この環境からは実際のサーバーに接続できないため、コードのみで動作未確認です。同じブラウザ内モードでは動作を確認しています
