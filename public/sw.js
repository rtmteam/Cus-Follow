
// رفع الرقم يمسح كل النسخ القديمة من الكاش عند التفعيل.
// ارفعه بعد أي تعديل على ملف يحمل الاسم نفسه ولا يتغير اسمه مع البناء.
const CACHE_NAME = 'uniteam-cache-v8';

// التخزين المسبق يقتصر على صفحة الدخول لتعمل دون اتصال.
// لا يُخزَّن هنا manifest.json ولا ملفات الأيقونات: أسماؤها ثابتة،
// فلو خُزّنت مسبقاً ظلّت النسخة القديمة تُخدَم بعد كل تحديث.
const urlsToCache = [
  './index.html',
  './offline.html'
];

// ملفات تُجلب من الشبكة أولاً دائماً، والكاش احتياط عند انقطاع الاتصال فقط.
// السبب أن أسماءها لا تتغير مع البناء، فلا وسيلة للمتصفح لاكتشاف تحديثها.
const NETWORK_FIRST = [
  'android-bridge.js',   // جسر كشف وضع المطور والموقع الوهمي
  'server-config.json',  // إعدادات الاتصال بالخادم
  'manifest.json',       // يحدد أيقونة التطبيق المثبّت واسمه
  'icon.png',
  'icon-192.png',
  'icon-maskable.png',
  'favicon.png'
];

function isNetworkFirst(url) {
  for (let i = 0; i < NETWORK_FIRST.length; i++) {
    if (url.indexOf(NETWORK_FIRST[i]) !== -1) return true;
  }
  return false;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames.map((cacheName) => {
          // تُحذف نسخ Uniteam القديمة فقط، ولا تُمسّ أي تطبيق آخر
          // يشترك معنا في النطاق نفسه على GitHub Pages.
          if (cacheName !== CACHE_NAME && cacheName.indexOf('uniteam') === 0) {
            return caches.delete(cacheName);
          }
          return null;
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // 1) ملفات ثابتة الاسم: الشبكة أولاً
  if (isNetworkFirst(url)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 2) التنقّل بين الصفحات
  //
  //    الشبكة أولاً، لكن مع فحص رمز الاستجابة أيضاً لا الأخطاء الشبكية وحدها.
  //    السبب أن إيقاف نشر الموقع يجعل الخادم يعيد 404 ومعه صفحة خطأ كاملة،
  //    وهذه استجابة "ناجحة" تقنياً فلا يلتقطها catch، فتظهر صفحة الخادم للموظف.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(function (response) {
          if (response && response.ok) {
            return response;
          }
          // الخادم رد بخطأ (404 عند إيقاف النشر، أو 5xx عند تعطّله)
          return caches.match('./offline.html', { ignoreSearch: true })
            .then(function (page) { return page || response; });
        })
        .catch(function () {
          // فشل شبكي حقيقي: لا اتصال بالإنترنت
          return caches.match('./offline.html', { ignoreSearch: true })
            .then(function (page) {
              return page || caches.match('./index.html', { ignoreSearch: true });
            });
        })
    );
    return;
  }

  // 3) ملفات الكود: تُخدَم من الكاش فوراً وتُحدَّث في الخلفية.
  //    آمن هنا لأن Vite يضيف بصمة للاسم مع كل بناء، فالملف الجديد عنوان جديد.
  if (
      url.indexOf('esm.sh') !== -1 ||
      url.endsWith('.tsx') ||
      url.endsWith('.ts') ||
      url.endsWith('.js') ||
      url.endsWith('.css')
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        });
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 4) ما تبقّى: الكاش أولاً
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
