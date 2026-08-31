/**
 * يلتقطه Vite تلقائياً فيمرّ كل ملف CSS على Tailwind ثم autoprefixer.
 * autoprefixer مطلوب هنا تحديداً لأن التطبيق يعمل داخل WebView أندرويد،
 * وبعض إصدارات النظام القديمة تحتاج بادئات لخصائص التخطيط.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
