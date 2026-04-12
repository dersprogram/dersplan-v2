import { auth } from "./firebase.js";
import {
  GoogleAuthProvider,
  EmailAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  fetchSignInMethodsForEmail,
  linkWithPopup,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

(function(){
  const STORAGE_KEY = "ayarlar";
  const DEFAULT_APP_DATA = {
    settings: {
      start: "08:15",
      duration: 40,
      break: 10,
      lunch: 45,
      lunchNo: 5,
      timeMode: "Giris-Cikis",
      role: "teacher",
      studentClass: "",
      userType: "guest",
      name: "",
      email: "",
      password: "",
      firebaseUid: "",
      authProvider: ""
    },
    activeDays: [0, 1, 2, 3, 4],
    classes: [],
    lessons: [],
    schedule: {},
    lastColor: "#ff7a00"
  };
  const PLACEHOLDER_VALUES = [
    "YOUR_API_KEY",
    "YOUR_AUTH_DOMAIN",
    "YOUR_PROJECT_ID",
    "YOUR_STORAGE_BUCKET",
    "YOUR_MESSAGING_SENDER_ID",
    "YOUR_APP_ID"
  ];

  let authReadyPromise = null;
  let authPersistencePromise = null;
  let googleLoginPromise = null;
  let authStateBound = false;
  let currentFirebaseUser = null;
  const googleProvider = new GoogleAuthProvider();
  const AppAuth = { user: null };

  // ─── Yardımcı fonksiyonlar ───────────────────────────────────────────────

  function safeJsonParse(value, fallback){
    try{
      const parsed = JSON.parse(value);
      return parsed === null ? fallback : parsed;
    }catch(e){
      return fallback;
    }
  }

  function cloneDefaultAppData(){
    return JSON.parse(JSON.stringify(DEFAULT_APP_DATA));
  }

  function ensureAppData(appData){
    const next = Object.assign(cloneDefaultAppData(), appData || {});
    next.settings = Object.assign({}, DEFAULT_APP_DATA.settings, next.settings || {});
    next.activeDays = Array.isArray(next.activeDays) ? next.activeDays : DEFAULT_APP_DATA.activeDays.slice();
    next.classes  = Array.isArray(next.classes)  ? next.classes  : [];
    next.lessons  = Array.isArray(next.lessons)  ? next.lessons  : [];
    next.schedule = next.schedule && typeof next.schedule === "object" ? next.schedule : {};
    return next;
  }

  function loadAppData(){
    return ensureAppData(safeJsonParse(localStorage.getItem(STORAGE_KEY), null));
  }

  function saveAppData(appData){
    const next = ensureAppData(appData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function hasPlaceholderConfig(){
    const config = auth?.app?.options || {};
    return Object.values(config).some(function(v){
      return PLACEHOLDER_VALUES.includes(String(v || "").trim());
    });
  }

  function resolveAuthProvider(firebaseUser, fallback){
    const pid = firebaseUser?.providerData?.[0]?.providerId || "";
    if(pid === "google.com") return "google";
    if(pid === "password")   return "firebase";
    return String(fallback || "").trim() || "firebase";
  }

  function isGuest(appData){
    return ensureAppData(appData).settings.userType === "guest";
  }

  // ─── Hata mesajları ──────────────────────────────────────────────────────

  function getFirebaseErrorMessage(error){
    const code = String(error?.code || "");

    // Provider çakışması — özel nesne taşıyoruz
    if(error?.type === "provider-mismatch"){
      return error.userMessage || "Bu hesap farklı bir yöntemle oluşturuldu.";
    }

    const messages = {
      "auth/wrong-password"            : "Şifre yanlış.",
      "auth/invalid-credential"        : "Şifre yanlış veya hesap farklı bir yöntemle oluşturuldu.",
      "auth/user-not-found"            : "Bu e-posta ile kayıtlı hesap yok.",
      "auth/email-already-in-use"      : "Bu e-posta zaten kayıtlı.",
      "auth/invalid-email"             : "Geçerli bir e-posta girin.",
      "auth/weak-password"             : "Şifre en az 6 karakter olmalı.",
      "auth/network-request-failed"    : "Bağlantı hatası. İnternet bağlantınızı kontrol edin.",
      "auth/popup-closed-by-user"      : "Giriş penceresi kapatıldı.",
      "auth/popup-blocked"             : "Popup engellendi. Lütfen tarayıcınızın popup engelleyicisini bu site için kapatın.",
      "auth/cancelled-popup-request"   : "Giriş isteği iptal edildi.",
      "auth/account-exists-with-different-credential": "Bu e-posta farklı bir giriş yöntemiyle kayıtlı.",
      "auth/credential-already-in-use" : "Bu hesap zaten başka bir kullanıcıya bağlı.",
      "auth/requires-recent-login"     : "Bu işlem için tekrar giriş yapmanız gerekiyor.",
      "auth/too-many-requests"         : "Çok fazla deneme yapıldı. Lütfen biraz bekleyin."
    };

    return messages[code] || "Bir hata oluştu.";
  }

  // ─── Kullanıcı durumu uygulama ───────────────────────────────────────────

  function createAppUserRecord(appData, firebaseUser){
    if(!firebaseUser) return null;
    const next = ensureAppData(appData);
    return {
      uid:   firebaseUser.uid   || next.settings.firebaseUid || "",
      email: firebaseUser.email || next.settings.email       || "",
      name:  next.settings.name || (firebaseUser.email || "").split("@")[0] || "Kullanıcı"
    };
  }

  function applyAuthenticatedUser(appData, firebaseUser, extras){
    const next    = ensureAppData(appData);
    const options = extras || {};
    const incomingName = String(options.name || "").trim();
    const resolvedName = incomingName || next.settings.name ||
                         (firebaseUser?.email || "").split("@")[0] || "Kullanıcı";

    next.settings.userType     = "registered";
    next.settings.name         = resolvedName;
    next.settings.email        = firebaseUser?.email || String(options.email || "").trim() || next.settings.email || "";
    next.settings.password     = "";
    next.settings.firebaseUid  = firebaseUser?.uid   || String(options.uid   || "").trim() || next.settings.firebaseUid || "";
    next.settings.authProvider = String(options.provider || "").trim() ||
                                 resolveAuthProvider(firebaseUser, "firebase");

    currentFirebaseUser = firebaseUser || currentFirebaseUser;
    AppAuth.user = createAppUserRecord(next, firebaseUser || currentFirebaseUser);

    if(options.persist !== false) saveAppData(next);
    return next;
  }

  function applyGuestUser(appData, options){
    const next   = ensureAppData(appData);
    const config = Object.assign({ persist: true, clearIdentity: false }, options || {});

    next.settings.userType     = "guest";
    next.settings.password     = "";
    next.settings.firebaseUid  = "";
    next.settings.authProvider = "";
    if(config.clearIdentity){
      next.settings.name  = "";
      next.settings.email = "";
    }

    currentFirebaseUser = null;
    AppAuth.user        = null;

    if(config.persist !== false) saveAppData(next);
    return next;
  }

  function syncFromStorage(){
    const appData = loadAppData();
    if(isGuest(appData)){
      AppAuth.user = null;
      return appData;
    }
    AppAuth.user = {
      uid:   appData.settings.firebaseUid || "",
      email: appData.settings.email       || "",
      name:  appData.settings.name        || (appData.settings.email || "").split("@")[0] || "Kullanıcı"
    };
    return appData;
  }

  // ─── Auth hazırlık ───────────────────────────────────────────────────────

  function ensureAuthConfigured(){
    if(authPersistencePromise) return authPersistencePromise;
    authPersistencePromise = setPersistence(auth, browserLocalPersistence)
      .catch(function(error){
        error.userMessage = getFirebaseErrorMessage(error);
        throw error;
      });
    return authPersistencePromise;
  }

  function ensureAuthReady(){
    if(authReadyPromise) return authReadyPromise;

    authReadyPromise = ensureAuthConfigured().then(function(){
      return new Promise(function(resolve, reject){
        if(authStateBound){
          resolve(syncFromStorage());
          return;
        }

        authStateBound = true;
        onAuthStateChanged(auth, function(firebaseUser){
          currentFirebaseUser = firebaseUser || null;
          let appData = loadAppData();

          if(firebaseUser){
            appData = applyAuthenticatedUser(appData, firebaseUser, {
              name:     firebaseUser.displayName || appData.settings.name,
              email:    firebaseUser.email       || appData.settings.email,
              provider: resolveAuthProvider(firebaseUser, appData.settings.authProvider || "firebase"),
              persist:  true
            });
          }else{
            appData = syncFromStorage();
          }

          resolve(appData);
        }, function(error){
          if(error){
            error.userMessage = getFirebaseErrorMessage(error);
            reject(error);
            return;
          }
          resolve(syncFromStorage());
        });
      });
    });

    return authReadyPromise;
  }

  // ─── window.open guard yönetimi ──────────────────────────────────────────

  function suspendGuard(){
    if(window.AppShell && typeof window.AppShell.suspendExternalNavigationGuard === "function"){
      window.AppShell.suspendExternalNavigationGuard();
    }else{
      window.__shellExternalGuardSuspended = true;
    }
  }

  function resumeGuard(){
    if(window.AppShell && typeof window.AppShell.resumeExternalNavigationGuard === "function"){
      window.AppShell.resumeExternalNavigationGuard();
    }else{
      window.__shellExternalGuardSuspended = false;
    }
  }

  // ─── Provider tespiti ────────────────────────────────────────────────────
  // Verilen e-postaya hangi giriş yöntemlerinin kayıtlı olduğunu döndürür.
  // Örnek: ["google.com"] / ["password"] / ["google.com","password"] / []

  async function getProviderMethodsForEmail(email){
    try{
      return await fetchSignInMethodsForEmail(auth, email);
    }catch(e){
      return [];
    }
  }

  // ─── E-posta / Şifre ile kayıt ───────────────────────────────────────────

  async function registerWithEmail(email, password){
    if(hasPlaceholderConfig()){
      throw new Error("Firebase ayarları eksik. assets/js/firebase.js içini doldurun.");
    }
    try{
      await ensureAuthConfigured();

      // Aynı e-posta Google ile kayıtlıysa kullanıcıyı yönlendir
      const methods = await getProviderMethodsForEmail(email);
      if(methods.includes("google.com") && !methods.includes("password")){
        const err = new Error(
          "Bu e-posta Google hesabıyla kayıtlı. " +
          "Google butonu ile giriş yapabilirsiniz."
        );
        err.code = "auth/account-exists-with-google";
        err.userMessage = err.message;
        err.type = "provider-mismatch";
        err.suggestedProvider = "google";
        throw err;
      }

      const credential = await createUserWithEmailAndPassword(auth, email, password);
      currentFirebaseUser = credential.user;
      return credential.user;
    }catch(error){
      if(!error.userMessage) error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  // ─── E-posta / Şifre ile giriş ───────────────────────────────────────────

  async function loginWithEmail(email, password){
    if(hasPlaceholderConfig()){
      throw new Error("Firebase ayarları eksik. assets/js/firebase.js içini doldurun.");
    }
    try{
      await ensureAuthConfigured();

      // Provider kontrolü — şifre girmeden önce yanlış yöntemi engelle
      const methods = await getProviderMethodsForEmail(email);

      if(methods.length > 0 && !methods.includes("password")){
        const providerLabel = methods.includes("google.com") ? "Google" : methods[0];
        const err = new Error(
          "Bu hesap " + providerLabel + " ile oluşturuldu. " +
          (providerLabel === "Google"
            ? "Google butonu ile giriş yapın."
            : "Doğru yöntemle giriş yapın.")
        );
        err.code = "auth/account-exists-with-different-credential";
        err.userMessage = err.message;
        err.type = "provider-mismatch";
        err.suggestedProvider = methods.includes("google.com") ? "google" : null;
        throw err;
      }

      const credential = await signInWithEmailAndPassword(auth, email, password);
      currentFirebaseUser = credential.user;
      return credential.user;
    }catch(error){
      if(!error.userMessage) error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  // ─── Google ile giriş ────────────────────────────────────────────────────
  // Her ortamda popup kullanılır (GitHub Pages, mobil, localhost).
  // Hesap zaten şifre ile kayıtlıysa kullanıcıya bilgi verilir.

  async function loginWithGoogle(){
    if(googleLoginPromise) return googleLoginPromise;

    if(hasPlaceholderConfig()){
      throw new Error("Firebase ayarları eksik. assets/js/firebase.js içini doldurun.");
    }

    googleLoginPromise = (async function(){
      try{
        await ensureAuthConfigured();
        suspendGuard();

        let result;
        try{
          result = await signInWithPopup(auth, googleProvider);
        }catch(popupError){
          // Hesap şifre ile kayıtlı → kullanıcıya açıkla
          if(popupError.code === "auth/account-exists-with-different-credential"){
            const email = popupError.customData?.email || "";
            const methods = email ? await getProviderMethodsForEmail(email) : [];

            if(methods.includes("password")){
              const mergeErr = new Error(
                "Bu e-posta (" + email + ") şifre ile kayıtlı. " +
                "Şifrenizle giriş yapın. Daha sonra hesap ayarlarından " +
                "Google hesabını da ekleyebilirsiniz."
              );
              mergeErr.code = "auth/account-exists-with-different-credential";
              mergeErr.userMessage = mergeErr.message;
              mergeErr.type = "provider-mismatch";
              mergeErr.suggestedProvider = "password";
              mergeErr.email = email;
              throw mergeErr;
            }
          }
          throw popupError;
        }

        resumeGuard();
        currentFirebaseUser = result.user;
        const appData = loadAppData();
        applyAuthenticatedUser(appData, result.user, {
          name:     result.user.displayName || appData.settings.name,
          email:    result.user.email       || appData.settings.email,
          provider: "google",
          persist:  true
        });
        return result.user;

      }catch(error){
        resumeGuard();
        if(!error.userMessage) error.userMessage = getFirebaseErrorMessage(error);
        throw error;
      }finally{
        googleLoginPromise = null;
      }
    })();

    return googleLoginPromise;
  }

  // ─── Hesap birleştirme ───────────────────────────────────────────────────
  // Şifre ile giriş yapmış kullanıcı, Google hesabını da bağlamak isterse çağrılır.
  // Settings sayfasında "Google Hesabını Bağla" butonu eklenebilir.

  async function linkGoogleToCurrentUser(){
    try{
      await ensureAuthConfigured();
      const user = auth.currentUser || currentFirebaseUser;
      if(!user){
        const err = new Error("Önce giriş yapmanız gerekiyor.");
        err.userMessage = err.message;
        throw err;
      }

      suspendGuard();
      const result = await linkWithPopup(user, googleProvider);
      resumeGuard();

      const appData = loadAppData();
      applyAuthenticatedUser(appData, result.user, {
        name:     result.user.displayName || appData.settings.name,
        email:    result.user.email       || appData.settings.email,
        provider: "google",
        persist:  true
      });
      return result.user;
    }catch(error){
      resumeGuard();
      if(!error.userMessage) error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  // ─── Diğer işlemler ──────────────────────────────────────────────────────

  async function logoutCurrentUser(){
    try{
      await ensureAuthConfigured();
      await signOut(auth);
      currentFirebaseUser = null;
      AppAuth.user = null;
      return null;
    }catch(error){
      error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  async function restoreAuthSession(){
    return ensureAuthReady();
  }

  async function reauthenticateEmailUser(currentPassword){
    await ensureAuthConfigured();
    const user = auth.currentUser || currentFirebaseUser;
    if(!user || !user.email){
      const error = new Error("Bir hata oluştu.");
      error.code = "auth/no-current-user";
      error.userMessage = error.message;
      throw error;
    }
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    return user;
  }

  // Google kullanıcısı için yeniden doğrulama (hesap silme vb. için)
  async function reauthenticateGoogleUser(){
    await ensureAuthConfigured();
    const user = auth.currentUser || currentFirebaseUser;
    if(!user){
      const error = new Error("Bir hata oluştu.");
      error.userMessage = error.message;
      throw error;
    }
    suspendGuard();
    try{
      await reauthenticateWithPopup(user, googleProvider);
      resumeGuard();
      return user;
    }catch(error){
      resumeGuard();
      error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  async function changeCurrentUserPassword(currentPassword, newPassword){
    try{
      const user = await reauthenticateEmailUser(currentPassword);
      await updatePassword(user, newPassword);
      return user;
    }catch(error){
      if(!error.userMessage) error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  async function deleteCurrentUser(currentPassword){
    try{
      const provider = resolveAuthProvider(auth.currentUser || currentFirebaseUser, "");
      if(provider === "google"){
        // Google kullanıcısı — popup ile yeniden doğrula
        const user = await reauthenticateGoogleUser();
        await deleteUser(user);
      }else{
        // E-posta/şifre kullanıcısı
        const user = await reauthenticateEmailUser(currentPassword);
        await deleteUser(user);
      }
      currentFirebaseUser = null;
      AppAuth.user = null;
      return null;
    }catch(error){
      if(!error.userMessage) error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  // ─── AppAuth nesnesi ─────────────────────────────────────────────────────

  Object.assign(AppAuth, {
    ready: ensureAuthReady(),
    isGuest,
    applyAuthenticatedUser,
    applyGuestUser,
    syncFromStorage,
    restoreAuthSession,
    registerWithEmail,
    loginWithEmail,
    loginWithGoogle,
    linkGoogleToCurrentUser,   // Yeni: şifre hesabına Google bağlama
    logoutCurrentUser,
    changeCurrentUserPassword,
    deleteCurrentUser,
    getFirebaseErrorMessage,
    getProviderMethodsForEmail // Yeni: provider sorgulama
  });

  window.AppAuth         = AppAuth;
  window.loginWithGoogle = loginWithGoogle;

  window.addEventListener("storage", function(event){
    if(event.key === STORAGE_KEY) syncFromStorage();
  });
})();
