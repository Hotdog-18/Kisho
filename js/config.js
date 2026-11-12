/*
 * KISHO 設定ファイル
 * 友達とオンラインで対局するには、無料の Supabase プロジェクトの値を入れてください (手順は README.md)。
 * 空のままだと、同じブラウザの別タブ同士でだけ部屋が使えます (お試し用)。
 * anon key は公開しても問題ない種類のキーです。service_role key は絶対にここへ書かないでください。
 */
window.KISHO_CONFIG = {
  supabaseUrl: '',      // 例: https://xxxxxxxx.supabase.co
  supabaseAnonKey: '',  // Project Settings → API → anon public
  notifyFunction: false // メール通知(Edge Function 'notify')をデプロイしたら true
};
