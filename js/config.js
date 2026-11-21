/*
 * KISHO 設定ファイル
 * 友達とオンラインで対局するには、無料の Supabase プロジェクトの値を入れてください (手順は README.md)。
 * 空のままだと、同じブラウザの別タブ同士でだけ部屋が使えます (お試し用)。
 * anon key は公開しても問題ない種類のキーです。service_role key は絶対にここへ書かないでください。
 */
window.KISHO_CONFIG = {
  supabaseUrl: 'https://qexbgzkkckqckkpzyjce.supabase.co',
  supabaseAnonKey: 'sb_publishable_8o2abEVKXjsK43eWw-XIkQ_IZjHYdWV', // 公開してよい種類のキー (publishable)
  notifyFunction: false // メール通知(Edge Function 'notify')をデプロイしたら true
};
