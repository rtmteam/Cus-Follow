/**
 * Uniteam Android Native Bridge Helper Script
 *
 * يربط واجهة الويب بالجسر الأصلي المسجَّل من Java باسم window.AndroidBridge.
 *
 * ملاحظة مهمة: الفحص عن الجسر يتم عند كل استدعاء وليس مرة واحدة عند التحميل،
 * لأن تسجيل الجسر من الطرف الأصلي قد يكتمل بعد تنفيذ هذا الملف.
 */

(function () {
  'use strict';

  /** يعيد الجسر الأصلي إن كان متاحاً، وإلا null */
  function bridge() {
    var b = window.AndroidBridge;
    return (b && typeof b === 'object') ? b : null;
  }

  /** استدعاء آمن لدالة على الجسر مع قيمة افتراضية عند الفشل */
  function call(method, fallback) {
    var b = bridge();
    if (!b || typeof b[method] !== 'function') return fallback;
    try {
      var value = b[method]();
      return (value === undefined || value === null) ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  window.UniteamNative = {
    /**
     * معرّف الجهاز بالصيغة الموحّدة المستخدمة في كل التطبيق.
     * داخل الـ APK يعتمد على ANDROID_ID الثابت،
     * وعلى المتصفح يعود إلى الرمز المخزّن محلياً.
     */
    getDeviceId: function () {
      var androidId = call('getAndroidId', '');
      if (androidId && String(androidId).length > 5) {
        return 'android_' + androidId;
      }
      return localStorage.getItem('uniteam_device_token');
    },

    /** هل خيارات المطور أو تصحيح USB مفعّلان على الهاتف */
    isDeveloperMode: function () {
      if (bridge()) {
        return call('isDeveloperOptionsEnabled', false) === true;
      }
      return window.location.search.indexOf('dev_mode=true') !== -1;
    },

    /** تفاصيل نصية لسبب اعتبار الوضع وضع مطور */
    getDeveloperModeDetail: function () {
      return call('getDeveloperOptionsDetail', '');
    },

    /** هل يوجد نشاط موقع وهمي على الجهاز */
    isMockLocation: function () {
      return call('isMockLocationActive', false) === true;
    },

    /** تفاصيل نصية لسبب اعتبار الموقع وهمياً */
    getMockLocationDetail: function () {
      return call('getMockLocationDetail', '');
    },

    /** موديل الجهاز، لتمييز الأجهزة في لوحة المشرف */
    getDeviceModel: function () {
      return call('getDeviceModel', '');
    },

    /** ملخص حالة الأمان على الجهاز - يفيد في تفسير أي رفض غير متوقع */
    getSecurityDiagnostics: function () {
      return call('getSecurityDiagnostics', '');
    },

    /** هل نعمل داخل تطبيق APK مع جسر أصلي فعّال */
    isNativeApp: function () {
      return bridge() !== null;
    }
  };

  if (bridge()) {
    console.log('[Uniteam Native] تم ربط الجسر الأصلي بنجاح.');
  } else {
    console.log('[Uniteam Native] لا يوجد جسر أصلي - وضع المتصفح.');
  }
})();
