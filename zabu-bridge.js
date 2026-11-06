/*!
 * Zabu Hediye Çarkı — Native köprüsü (Flutter WebView ⇄ Cocos oyunu)
 *
 * Güvenlik:
 *  - Sayfa HİÇBİR token / gizli anahtar tutmaz. Çevirmeyi Flutter kendi
 *    oturumuyla sunucuya gönderir; sonucu ve ödülü sunucu belirler.
 *  - Oyundan Flutter'a sadece izin verilen action'lar iletilir.
 *  - Eski sağlayıcının rapor / sıralama sunucularına istek gitmez.
 *
 * Akış:
 *  Flutter → window.__zabuInit(user)       : kullanıcı bilgisi, oyunu başlatır
 *  Flutter → window.__zabuEmit(event, p)   : gift_wheel_init / gift_wheel_bet / gift_wheel_diamond_sync
 *  Flutter → window.__zabuVisibility(bool) : popup görünür/gizli
 *  Flutter → window.__zabuRecords(id, res) : çevirme kayıtları cevabı
 *  Oyun    → ZabuBridge.postMessage(json)  : {type:'rtm'|'close'|'recharge'|'loaded'|'displayed'|'records'}
 */
(function () {
  'use strict';

  var GAME_ID = 28;
  var ALLOWED_ACTIONS = ['GiftWheel:init', 'GiftWheel:bet'];

  var user = null;
  var booted = false;
  var bootQueue = [];

  function post(msg) {
    try {
      if (window.ZabuBridge && typeof window.ZabuBridge.postMessage === 'function') {
        window.ZabuBridge.postMessage(JSON.stringify(msg));
      }
    } catch (e) { /* yok say */ }
  }

  function userJson() {
    if (!user) return '{}';
    return JSON.stringify({
      userId: user.userId,
      funId: user.userId,
      userName: user.name,
      nickName: user.name,
      avatar: user.avatar || '',
      token: 'zabu',            // gerçek token DEĞİL; oyun boş olmamasını bekliyor
      coin: user.coin || 0,
      gold: user.coin || 0,
      roomId: String(user.roomId || ''),
      uiLang: user.lang || 'tr',
      appVersion: '1.0.0',
      packageName: 'com.zabuchat.app'
    });
  }

  function safeStorageGet(k) {
    try { return window.localStorage.getItem('zabu_' + k) || ''; } catch (e) { return ''; }
  }
  function safeStorageSet(raw) {
    try {
      var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (o && o.key) window.localStorage.setItem('zabu_' + o.key, String(o.value == null ? '' : o.value));
    } catch (e) { /* yok say */ }
  }

  var noop = function () { return ''; };
  var close = function () { post({ type: 'close' }); return ''; };
  var recharge = function () { post({ type: 'recharge' }); return ''; };
  // Oyun "+" (coin ekle) için cüzdana yönlendirme ister
  var jump = function (action) {
    var a = String(action || '');
    if (/wallet|recharge|ActivityWallet/i.test(a) || a === '') recharge();
    return '';
  };

  // Bu oyunun SDK'sı senkron cevapları BASE64 kodlu {"params":"<json>"} bekliyor
  // (düz JSON gelirse atob hatası → kullanıcı bilgisi boş → dil İngilizce kalıyordu).
  function wrap(v) {
    var json = JSON.stringify({ params: typeof v === 'string' ? v : JSON.stringify(v) });
    try { return btoa(unescape(encodeURIComponent(json))); } catch (e) { return json; }
  }
  function wrapped(fn) { return function (p) { return wrap(fn(p)); }; }

  var api = {
    getUserInfo: userJson,
    getUserInfoNew: userJson,
    GetUserInfo: userJson,
    getUserCoin: function () { return user ? user.coin : 0; },
    getRoomId: function () { return user ? String(user.roomId || '') : ''; },
    getToken: function () { return 'zabu'; },
    getFunId: function () { return user ? user.userId : ''; },
    getAppVersionCode: function () { return '10000'; },
    isNativeAsset: function () { return false; },
    getAppPerformance: function () { return JSON.stringify({ memory: (user && user.memory) || 4096 }); },
    getDeviceMemory: function () { return (user && user.memory) || 4096; },
    // Kayıt isteği HostAddress + "/game/gift-wheel/bet-recored" → aynı origin'e gider, köprü yakalar
    getAppRequestHost: function () { return { live: location.origin, report: location.origin }; },
    getAppRequestHostNew: function () { return { live: location.origin, report: location.origin }; },
    getMicAndSoundState: function () { return JSON.stringify({ mic: false, sound: true }); },
    getWebLocalData: safeStorageGet,
    setNewWebLocalData: function (raw) { safeStorageSet(raw); return ''; },
    closePage: close,
    closePageNew: close,
    closeLoadingPage: function () { post({ type: 'loaded' }); return ''; },
    closeLoadingPageNew: function () { post({ type: 'loaded' }); return ''; },
    event_h5game_displayed: function () { post({ type: 'displayed' }); return ''; },
    event_webview_success: function () { post({ type: 'loaded' }); return ''; },
    popUpBottomRecharge: recharge,
    showRechargeDialog: recharge,
    jumpToTarget: function (action) { return jump(action); },
    actionRounter: function (action) { return jump(action); },
    requestMsg: function (raw) {
      var req = raw;
      if (typeof raw === 'string') {
        try { req = JSON.parse(raw); } catch (e) { return ''; }
      }
      if (!req || typeof req.action !== 'string') return '';
      if (ALLOWED_ACTIONS.indexOf(req.action) < 0) return '';
      post({ type: 'rtm', action: req.action, params: req.params || {} });
      return '';
    },
    h5ToNative: function (raw) {
      try {
        var o = JSON.parse(raw);
        if (!o) return '';
        var n = o.actionName;
        if (n === 'closePage') close();
        else if (n === 'event_h5game_displayed') post({ type: 'displayed' });
        else if (n === 'popUpBottomRecharge' || n === 'showRechargeDialog') recharge();
        else if (n === 'jumpToTarget') jump(o.params && o.params.action);
      } catch (e) { /* yok say */ }
      return '';
    }
  };

  ['getUserInfo', 'getUserInfoNew', 'GetUserInfo', 'getUserCoin', 'getRoomId', 'getToken', 'getFunId',
   'getAppVersionCode', 'isNativeAsset', 'getAppPerformance', 'getDeviceMemory', 'getMicAndSoundState',
   'getWebLocalData', 'getAppRequestHost', 'getAppRequestHostNew'].forEach(function (k) { api[k] = wrapped(api[k]); });

  window.fun = typeof Proxy === 'function'
    ? new Proxy(api, { get: function (t, k) { return k in t ? t[k] : noop; } })
    : api;

  // iOS / Android dışı yol: getter'lar window.prompt(method) ile çağrılır
  window.prompt = function (method, param) {
    if (typeof method !== 'string') return null;
    if (method === 'h5ToNative') return api.h5ToNative(param);
    if (Object.prototype.hasOwnProperty.call(api, method)) {
      try { return api[method](param); } catch (e) { return null; }
    }
    return null;
  };

  // ── Flutter → Oyun ────────────────────────────────────────────────────
  window.__zabuEmit = function (event, params) {
    if (typeof window.RTMResponseMsg !== 'function') return;
    try {
      window.RTMResponseMsg(JSON.stringify({ gameId: GAME_ID, events: [{ event: event, params: params || {} }] }));
    } catch (e) { /* yok say */ }
  };

  window.__zabuSetCoin = function (coin) {
    if (user) user.coin = coin;
  };

  window.__zabuVisibility = function (visible) {
    try {
      var cc = window.cc;
      if (!cc || !cc.game) return;
      if (visible) {
        if (cc.game.isPaused && cc.game.isPaused()) cc.game.resume();
        if (cc.Game && cc.Game.EVENT_SHOW) cc.game.emit(cc.Game.EVENT_SHOW);
      } else {
        if (cc.Game && cc.Game.EVENT_HIDE) cc.game.emit(cc.Game.EVENT_HIDE);
        cc.game.pause();
      }
    } catch (e) { /* yok say */ }
  };

  // ── Oyun içi HTTP istekleri ───────────────────────────────────────────
  // Kayıtlar Flutter'dan (kendi oturumuyla); sıralama / duyuru / rapor ağa çıkmadan boş.
  var HTTP_RE = /\/game\/gift-wheel\/|\/game\/operation\/|\/v2\/client-event\/report/;
  var httpSeq = 0;
  var httpPending = {};

  function fakeRespond(xhr, obj) {
    try {
      var body = xhr.responseType === 'json' ? obj : JSON.stringify(obj);
      Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
      Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
      Object.defineProperty(xhr, 'response', { value: body, configurable: true });
      if (xhr.responseType !== 'json') {
        Object.defineProperty(xhr, 'responseText', { value: body, configurable: true });
      }
    } catch (e) { /* yok say */ }
    setTimeout(function () {
      try { if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange(); } catch (e) { /* */ }
      try { if (typeof xhr.onload === 'function') xhr.onload(); } catch (e) { /* */ }
    }, 0);
  }

  // Sunucu kaydı → oyunun RecordItem biçimi
  function mapRecords(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var awards = [];
      var rw = r.rewards || [];
      for (var j = 0; j < rw.length; j++) awards.push({ url: (rw[j] && rw[j].icon) || '' });
      out.push({
        rid: r.short_id || '',
        type: Number(r.mode) || 0,
        betType: Number(r.bet_type) || 0,
        settleTime: Date.parse(r.created_at) || Date.now(),
        value: Number(r.value_total) || 0,
        awards: awards
      });
    }
    return out;
  }

  function handleFakeHttp(xhr, url) {
    if (url.indexOf('/bet-recored') < 0 || !window.ZabuBridge) {
      fakeRespond(xhr, url.indexOf('/v2/client-event/report') >= 0 ? { code: 200 } : { code: 404, message: 'disabled' });
      return;
    }
    var q = {};
    try { new URL(url, location.href).searchParams.forEach(function (v, k) { q[k] = v; }); } catch (e) { /* */ }
    var page = Math.max(1, parseInt(q.page, 10) || 1); // oyun sayfaları 1'den sayıyor
    var size = Math.min(Math.max(parseInt(q.size, 10) || 10, 1), 20);
    var id = ++httpSeq;
    httpPending[id] = { xhr: xhr, page: page, size: size };
    httpPending[id].timer = setTimeout(function () {
      if (httpPending[id]) { delete httpPending[id]; fakeRespond(xhr, { code: 500, message: 'timeout' }); }
    }, 10000);
    post({ type: 'records', id: id, offset: (page - 1) * size, limit: size + 1 });
  }

  window.__zabuRecords = function (id, res) {
    var p = httpPending[id];
    if (!p) return;
    delete httpPending[id];
    clearTimeout(p.timer);
    if (!res || res.ok !== true) { fakeRespond(p.xhr, { code: 500, message: 'error' }); return; }
    var list = res.records || [];
    fakeRespond(p.xhr, {
      code: 200,
      data: { page: p.page, more: list.length > p.size, records: mapRecords(list.slice(0, p.size)) }
    });
  };

  var xOpen = XMLHttpRequest.prototype.open;
  var xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__zabuUrl = (typeof url === 'string' && HTTP_RE.test(url)) ? url : null;
    return xOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__zabuUrl) { handleFakeHttp(this, this.__zabuUrl); return; }
    return xSend.apply(this, arguments);
  };
  // fetch ile giden rapor istekleri de ağa çıkmasın
  if (typeof window.fetch === 'function') {
    var oFetch = window.fetch;
    window.fetch = function (input, init) {
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      if (HTTP_RE.test(u)) {
        return Promise.resolve(new Response(JSON.stringify({ code: 200 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return oFetch.apply(this, arguments);
    };
  }

  // ── Oyun yamaları (paket dosyalarına dokunmadan) ──────────────────────
  // Uzak resim yüklendikten sonra özel materyal (yuvarlak/gri) yeniden atanır;
  // aksi halde bazı cihazlarda ödül/avatar resmi boş çiziliyordu (Greedy'de görüldü).
  var patched = { sprite: false };
  function tryPatch() {
    var cc = window.cc;
    if (!cc || !cc.js || typeof cc.js.getClassByName !== 'function') return false;
    if (!patched.sprite) {
      var SA = cc.js.getClassByName('SpriteAdapter');
      if (SA && SA.prototype && typeof SA.prototype.setSpiteFrame === 'function') {
        var origSet = SA.prototype.setSpiteFrame;
        SA.prototype.setSpiteFrame = function (frame) {
          var r = origSet.apply(this, arguments);
          try {
            var sp = this.sprite;
            var mat = sp && sp.customMaterial;
            if (mat && frame) { sp.customMaterial = null; sp.customMaterial = mat; }
          } catch (e) { /* */ }
          return r;
        };
        patched.sprite = true;
      }
    }
    return patched.sprite;
  }

  // Ekran uyumu: alan tasarım oranından (750×1334) kısaysa SHOW_ALL, değilse oyunun kendi FIXED_WIDTH ayarı (yanlar kesilmez)
  var lastPolicy = null;
  function fitScreen() {
    var cc = window.cc;
    if (!cc || !cc.view || !cc.ResolutionPolicy || !cc.game || !cc.game.inited) return false;
    var w = window.innerWidth || 1, h = window.innerHeight || 1;
    var tall = h / w >= (1334 / 750) - 0.02;
    var pol = tall ? cc.ResolutionPolicy.FIXED_WIDTH : cc.ResolutionPolicy.SHOW_ALL;
    if (pol !== lastPolicy) {
      try { cc.view.setDesignResolutionSize(750, 1334, pol); lastPolicy = pol; } catch (e) { /* */ }
    }
    return true;
  }
  var fitTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitScreen, 120);
  });

  // Dil: bu oyunda initLang() hiç çağrılmıyor → hep İngilizce kalıyordu.
  // Oyun paketi kayıt olunca biz çağırıp ekrandaki yazıları yeniletiyoruz.
  var langDone = false;
  var langBusy = false;
  function tryLang() {
    if (langDone || langBusy || !window.System || typeof window.System.has !== 'function') return langDone;
    if (!window.System.has('chunks:///_virtual/GameInit.ts')) return false;
    langBusy = true;
    Promise.all([
      window.System.import('chunks:///_virtual/GameInit.ts'),
      window.System.import('chunks:///_virtual/LanguageData.ts')
    ]).then(function (mods) {
      try {
        if (mods[0] && typeof mods[0].initLang === 'function') mods[0].initLang();
        var LD = mods[1] && mods[1].LanguageData;
        if (LD && LD.instance && typeof LD.instance.updateSceneRenderers === 'function') LD.instance.updateSceneRenderers();
      } catch (e) { /* */ }
      langDone = true;
    }).catch(function () { langBusy = false; });
    return false;
  }

  var patchTries = 0;
  var patchTimer = setInterval(function () {
    var fitted = lastPolicy !== null || fitScreen();
    var lang = tryLang();
    if ((tryPatch() && fitted && lang) || ++patchTries > 600) clearInterval(patchTimer);
  }, 200);

  // ── Boot kilidi: kullanıcı bilgisi gelmeden Cocos yüklenmez ─────────────
  window.__zabuBoot = function (fn) {
    if (booted) { fn(); } else { bootQueue.push(fn); }
  };

  window.__zabuInit = function (u) {
    if (!u || !u.userId) return;
    user = u;
    if (booted) return;
    booted = true;
    var q = bootQueue.splice(0);
    for (var i = 0; i < q.length; i++) { try { q[i](); } catch (e) { console.error(e); } }
  };

  setTimeout(function () {
    if (!booted && !window.ZabuBridge) {
      console.warn('[ZabuBridge] Flutter köprüsü yok — oyun yalnızca Zabu uygulaması içinde çalışır.');
    }
  }, 3000);
})();
