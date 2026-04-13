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
      start: "08:15", duration: 40, break: 10, lunch: 45, lunchNo: 5,
      timeMode: "Giris-Cikis", role: "teacher", studentClass: "",
      userType: "guest", name: "", email: "", password: "",
      firebaseUid: "", authProvider: ""
    },
    activeDays: [0, 1, 2, 3, 4],
    classes: [], lessons: [], schedule: {}, lastColor: "#ff7a00"
  };
  const PLACEHOLDER_VALUES = [
    "YOUR_API_KEY","YOUR_AUTH_DOMAIN","YOUR_PROJECT_ID",
    "YOUR_STORAGE_BUCKET","YOUR_MESSAGING_SENDER_ID","YOUR_APP_ID"
  ];

  let authReadyPromise = null;
  let authPersistencePromise = null;
  let googleLoginPromise = null;
  let authStateBound = false;
  let currentFirebaseUser = null;
  const googleProvider = new GoogleAuthProvider();
  const AppAuth = { user: null };

  // ─── Yardımcı ────────────────────────────────────────────────────────────

  function safeJsonParse(value, fallback){
    try{ const p = JSON.parse(value); return p === null ? fallback : p; }
    catch(e){ return fallback; }
  }
  function cloneDefaultAppData(){ return JSON.parse(JSON.stringify(DEFAULT_APP_DATA)); }
  function ensureAppData(appData){
    const next = Object.assign(cloneDefaultAppData(), appData || {});
    next.settings  = Object.assign({}, DEFAULT_APP_DATA.settings, next.settings || {});
    next.activeDays = Array.isArray(next.activeDays) ? next.activeDays : DEFAULT_APP_DATA.activeDays.slice();
    next.classes   = Array.isArray(next.classes)  ? next.classes  : [];
    next.lessons   = Array.isArray(next.lessons)  ? next.lessons  : [];
    next.schedule  = next.schedule && typeof next.schedule === "object" ? next.schedule : {};
    return next;
  }
  function loadAppData(){ return ensureAppData(safeJsonParse(localStorage.getItem(STORAGE_KEY), null)); }
  function saveAppData(appData){ const n = ensureAppData(appData); localStorage.setItem(STORAGE_KEY, JSON.stringify(n)); return n; }
  function hasPlaceholderConfig(){
    const c = auth?.app?.options || {};
    return Object.values(c).some(v => PLACEHOLDER_VALUES.includes(String(v||"").trim()));
  }
  function resolveAuthProvider(firebaseUser, fallback){
    const pid = firebaseUser?.providerData?.[0]?.providerId || "";
    if(pid === "google.com") return "google";
    if(pid === "password")   return "firebase";
    return String(fallback || "").trim() || "firebase";
  }
  function isGuest(appData){ return ensureAppData(appData).settings.userType === "guest"; }

  // ─── Hata mesajları ──────────────────────────────────────────────────────

  function getFirebaseErrorMessage(error){
    if(error?.type === "provider-mismatch") return error.userMessage || "Bu hesap farklı bir yöntemle oluşturuldu.";
    const code = String(error?.code || "");
    const map = {
      "auth/wrong-password"            : "Şifre yanlış.",
      "auth/invalid-credential"        : "Şifre yanlış veya hesap farklı bir yöntemle oluşturuldu.",
      "auth/user-not-found"            : "Bu e-posta ile kayıtlı hesap yok.",
      "auth/email-already-in-use"      : "Bu e-posta zaten kayıtlı.",
      "auth/invalid-email"             : "Geçerli bir e-posta girin.",
      "auth/weak-password"             : "Şifre en az 6 karakter olmalı.",
      "auth/network-request-failed"    : "Bağlantı hatası. İnternet bağlantınızı kontrol edin.",
      "auth/popup-closed-by-user"      : "Giriş penceresi kapatıldı.",
      "auth/popup-blocked"             : "Popup engellendi. Tarayıcınızın popup engelleyicisini bu site için kapatın.",
      "auth/cancelled-popup-request"   : "Giriş isteği iptal edildi.",
      "auth/account-exists-with-different-credential": "Bu e-posta farklı bir giriş yöntemiyle kayıtlı.",
      "auth/credential-already-in-use" : "Bu hesap zaten başka bir kullanıcıya bağlı.",
      "auth/requires-recent-login"     : "Bu işlem için tekrar giriş yapmanız gerekiyor.",
      "auth/too-many-requests"         : "Çok fazla deneme yapıldı. Lütfen biraz bekleyin."
    };
    return map[code] || "Bir hata oluştu.";
  }

  // ─── Kullanıcı durumu ────────────────────────────────────────────────────

  function createAppUserRecord(appData, firebaseUser){
    if(!firebaseUser) return null;
    const next = ensureAppData(appData);
    return {
      uid:   firebaseUser.uid   || next.settings.firebaseUid || "",
      email: firebaseUser.email || next.settings.email       || "",
      name:  next.settings.name || (firebaseUser.email||"").split("@")[0] || "Kullanıcı"
    };
  }

  function applyAuthenticatedUser(appData, firebaseUser, extras){
    const next = ensureAppData(appData);
    const opts = extras || {};
    const name = String(opts.name||"").trim() || next.settings.name || (firebaseUser?.email||"").split("@")[0] || "Kullanıcı";
    next.settings.userType     = "registered";
    next.settings.name         = name;
    next.settings.email        = firebaseUser?.email || String(opts.email||"").trim() || next.settings.email || "";
    next.settings.password     = "";
    next.settings.firebaseUid  = firebaseUser?.uid   || String(opts.uid||"").trim()   || next.settings.firebaseUid || "";
    next.settings.authProvider = String(opts.provider||"").trim() || resolveAuthProvider(firebaseUser, "firebase");
    currentFirebaseUser = firebaseUser || currentFirebaseUser;
    AppAuth.user = createAppUserRecord(next, firebaseUser || currentFirebaseUser);
    if(opts.persist !== false) saveAppData(next);
    return next;
  }

  function applyGuestUser(appData, options){
    const next = ensureAppData(appData);
    const cfg  = Object.assign({ persist: true, clearIdentity: false }, options || {});
    next.settings.userType = "guest"; next.settings.password = "";
    next.settings.firebaseUid = ""; next.settings.authProvider = "";
    if(cfg.clearIdentity){ next.settings.name = ""; next.settings.email = ""; }
    currentFirebaseUser = null; AppAuth.user = null;
    if(cfg.persist !== false) saveAppData(next);
    return next;
  }

  function syncFromStorage(){
    const appData = loadAppData();
    if(isGuest(appData)){ AppAuth.user = null; return appData; }
    AppAuth.user = {
      uid:   appData.settings.firebaseUid || "",
      email: appData.settings.email       || "",
      name:  appData.settings.name        || (appData.settings.email||"").split("@")[0] || "Kullanıcı"
    };
    return appData;
  }

  // ─── Auth hazırlık ───────────────────────────────────────────────────────

  function ensureAuthConfigured(){
    if(authPersistencePromise) return authPersistencePromise;
    authPersistencePromise = setPersistence(auth, browserLocalPersistence)
      .catch(e => { e.userMessage = getFirebaseErrorMessage(e); throw e; });
    return authPersistencePromise;
  }

  function ensureAuthReady(){
    if(authReadyPromise) return authReadyPromise;
    authReadyPromise = ensureAuthConfigured().then(() => new Promise((resolve, reject) => {
      if(authStateBound){ resolve(syncFromStorage()); return; }
      authStateBound = true;
      onAuthStateChanged(auth, firebaseUser => {
        currentFirebaseUser = firebaseUser || null;
        let appData = loadAppData();
        if(firebaseUser){
          appData = applyAuthenticatedUser(appData, firebaseUser, {
            name: firebaseUser.displayName || appData.settings.name,
            email: firebaseUser.email      || appData.settings.email,
            provider: resolveAuthProvider(firebaseUser, appData.settings.authProvider || "firebase"),
            persist: true
          });
        }else{
          appData = syncFromStorage();
        }
        resolve(appData);
      }, error => {
        if(error){ error.userMessage = getFirebaseErrorMessage(error); reject(error); return; }
        resolve(syncFromStorage());
      });
    }));
    return authReadyPromise;
  }

  // ─── Guard yönetimi ──────────────────────────────────────────────────────

  function suspendGuard(){
    if(window.AppShell?.suspendExternalNavigationGuard) window.AppShell.suspendExternalNavigationGuard();
    else window.__shellExternalGuardSuspended = true;
  }
  function resumeGuard(){
    if(window.AppShell?.resumeExternalNavigationGuard) window.AppShell.resumeExternalNavigationGuard();
    else window.__shellExternalGuardSuspended = false;
  }

  // ─── Provider sorgulama ──────────────────────────────────────────────────

  async function getProviderMethodsForEmail(email){
    try{ return await fetchSignInMethodsForEmail(auth, email); }
    catch(e){ return []; }
  }

  // ─── E-posta ile kayıt ───────────────────────────────────────────────────

  async function registerWithEmail(email, password){
    if(hasPlaceholderConfig()) throw new Error("Firebase ayarları eksik.");
    try{
      await ensureAuthConfigured();
      const methods = await getProviderMethodsForEmail(email);
      if(methods.includes("google.com") && !methods.includes("password")){
        const err = new Error("Bu e-posta Google hesabıyla kayıtlı. Google butonu ile giriş yapabilirsiniz.");
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

  // ─── E-posta ile giriş ───────────────────────────────────────────────────

  async function loginWithEmail(email, password){
    if(hasPlaceholderConfig()) throw new Error("Firebase ayarları eksik.");
    try{
      await ensureAuthConfigured();
      const methods = await getProviderMethodsForEmail(email);
      if(methods.length > 0 && !methods.includes("password")){
        const label = methods.includes("google.com") ? "Google" : methods[0];
        const err = new Error(
          "Bu hesap " + label + " ile oluşturuldu. " +
          (label === "Google" ? "Google butonu ile giriş yapın." : "Doğru yöntemle giriş yapın.")
        );
        err.code = "auth/account-exists-with-different-credential";
        err.userMessage = err.message;
        err.type = "provider-mismatch";
        err.suggestedProvider = methods.includes("google.com") ? "google" : null;
        throw err;
      }
      try{
        const credential = await signInWithEmailAndPassword(auth, email, password);
        currentFirebaseUser = credential.user;
        return credential.user;
      }catch(firebaseError){
        // auth/invalid-credential: şifre yanlış VEYA hesap Google ile açılmış olabilir.
        // fetchSignInMethodsForEmail devre dışıysa provider önceden tespit edilemiyor.
        // Hata sonrası tekrar provider sorgula.
        if(
          firebaseError.code === "auth/invalid-credential" ||
          firebaseError.code === "auth/wrong-password"
        ){
          const retryMethods = await getProviderMethodsForEmail(email);
          if(retryMethods.length > 0 && !retryMethods.includes("password")){
            const label = retryMethods.includes("google.com") ? "Google" : retryMethods[0];
            const err = new Error(
              "Bu hesap " + label + " ile oluşturuldu. " +
              (label === "Google" ? "Google butonu ile giriş yapın." : "Doğru yöntemle giriş yapın.")
            );
            err.code = "auth/account-exists-with-different-credential";
            err.userMessage = err.message;
            err.type = "provider-mismatch";
            err.suggestedProvider = retryMethods.includes("google.com") ? "google" : null;
            throw err;
          }
          firebaseError.userMessage = "Şifre yanlış.";
        }
        if(!firebaseError.userMessage) firebaseError.userMessage = getFirebaseErrorMessage(firebaseError);
        throw firebaseError;
      }
    }catch(error){
      if(!error.userMessage) error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  // ─── Google ile giriş ────────────────────────────────────────────────────

  async function loginWithGoogle(){
    if(googleLoginPromise) return googleLoginPromise;
    if(hasPlaceholderConfig()) throw new Error("Firebase ayarları eksik.");
    googleLoginPromise = (async () => {
      try{
        await ensureAuthConfigured();
        suspendGuard();
        let result;
        try{
          result = await signInWithPopup(auth, googleProvider);
        }catch(popupError){
          if(popupError.code === "auth/account-exists-with-different-credential"){
            const email = popupError.customData?.email || "";
            const methods = email ? await getProviderMethodsForEmail(email) : [];
            if(methods.includes("password")){
              const err = new Error(
                "Bu e-posta (" + email + ") şifre ile kayıtlı. " +
                "Şifrenizle giriş yapın. Daha sonra hesap ayarlarından Google'ı da ekleyebilirsiniz."
              );
              err.code = "auth/account-exists-with-different-credential";
              err.userMessage = err.message;
              err.type = "provider-mismatch";
              err.suggestedProvider = "password";
              err.email = email;
              throw err;
            }
          }
          throw popupError;
        }
        resumeGuard();
        currentFirebaseUser = result.user;
        const appData = loadAppData();
        applyAuthenticatedUser(appData, result.user, {
          name: result.user.displayName || appData.settings.name,
          email: result.user.email      || appData.settings.email,
          provider: "google", persist: true
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
  // Şifre ile giriş yapmış kullanıcının Google hesabını bağlaması için.

  async function linkGoogleToCurrentUser(){
    try{
      await ensureAuthConfigured();
      const user = auth.currentUser || currentFirebaseUser;
      if(!user){ const e = new Error("Önce giriş yapmanız gerekiyor."); e.userMessage = e.message; throw e; }
      suspendGuard();
      const result = await linkWithPopup(user, googleProvider);
      resumeGuard();
      const appData = loadAppData();
      applyAuthenticatedUser(appData, result.user, {
        name: result.user.displayName || appData.settings.name,
        email: result.user.email      || appData.settings.email,
        provider: "google", persist: true
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
      currentFirebaseUser = null; AppAuth.user = null;
      return null;
    }catch(error){ error.userMessage = getFirebaseErrorMessage(error); throw error; }
  }

  async function restoreAuthSession(){ return ensureAuthReady(); }

  async function reauthenticateEmailUser(currentPassword){
    await ensureAuthConfigured();
    const user = auth.currentUser || currentFirebaseUser;
    if(!user || !user.email){
      const e = new Error("Bir hata oluştu."); e.code = "auth/no-current-user"; e.userMessage = e.message; throw e;
    }
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
    return user;
  }

  async function reauthenticateGoogleUser(){
    await ensureAuthConfigured();
    const user = auth.currentUser || currentFirebaseUser;
    if(!user){ const e = new Error("Bir hata oluştu."); e.userMessage = e.message; throw e; }
    suspendGuard();
    try{ await reauthenticateWithPopup(user, googleProvider); resumeGuard(); return user; }
    catch(error){ resumeGuard(); error.userMessage = getFirebaseErrorMessage(error); throw error; }
  }

  async function changeCurrentUserPassword(currentPassword, newPassword){
    try{
      const user = await reauthenticateEmailUser(currentPassword);
      await updatePassword(user, newPassword);
      return user;
    }catch(error){ if(!error.userMessage) error.userMessage = getFirebaseErrorMessage(error); throw error; }
  }

  // Google kullanıcısı şifre gerekmez — popup ile doğrulama yapılır.
  async function deleteCurrentUser(currentPassword){
    try{
      const provider = resolveAuthProvider(auth.currentUser || currentFirebaseUser, "");
      if(provider === "google"){
        const user = await reauthenticateGoogleUser();
        await deleteUser(user);
      }else{
        const user = await reauthenticateEmailUser(currentPassword);
        await deleteUser(user);
      }
      currentFirebaseUser = null; AppAuth.user = null;
      return null;
    }catch(error){ if(!error.userMessage) error.userMessage = getFirebaseErrorMessage(error); throw error; }
  }

  // ─── AppAuth ─────────────────────────────────────────────────────────────

  Object.assign(AppAuth, {
    ready: ensureAuthReady(),
    isGuest, applyAuthenticatedUser, applyGuestUser, syncFromStorage,
    restoreAuthSession, registerWithEmail, loginWithEmail, loginWithGoogle,
    linkGoogleToCurrentUser, logoutCurrentUser, changeCurrentUserPassword,
    deleteCurrentUser, getFirebaseErrorMessage, getProviderMethodsForEmail
  });

  window.AppAuth = AppAuth;
  window.loginWithGoogle = loginWithGoogle;

  window.addEventListener("storage", e => { if(e.key === STORAGE_KEY) syncFromStorage(); });
})();
