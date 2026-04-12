import { auth } from "./firebase.js";
import {
  GoogleAuthProvider,
  EmailAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  getRedirectResult,
  reauthenticateWithCredential,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ✅ signInWithRedirect import'u kaldırıldı — artık her ortamda popup kullanılıyor.

(function(){
  const STORAGE_KEY = "ayarlar";
  const REDIRECT_PENDING_KEY = "appAuthRedirectPending";
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
  const AppAuth = {
    user: null
  };

  function safeJsonParse(value, fallback){
    try{
      const parsed = JSON.parse(value);
      return parsed === null ? fallback : parsed;
    }catch(error){
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
    next.classes = Array.isArray(next.classes) ? next.classes : [];
    next.lessons = Array.isArray(next.lessons) ? next.lessons : [];
    next.schedule = next.schedule && typeof next.schedule === "object" ? next.schedule : {};
    return next;
  }

  function loadAppData(){
    return ensureAppData(safeJsonParse(localStorage.getItem(STORAGE_KEY), null));
  }

  function clearRedirectPending(){
    sessionStorage.removeItem(REDIRECT_PENDING_KEY);
  }

  function saveAppData(appData){
    const next = ensureAppData(appData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function hasPlaceholderConfig(){
    const config = auth?.app?.options || {};
    return Object.values(config).some(function(value){
      return PLACEHOLDER_VALUES.includes(String(value || "").trim());
    });
  }

  function getFirebaseErrorMessage(error){
    const code = String(error?.code || "");
    const fallback = "Bir hata oluştu";

    if(code === "auth/wrong-password" || code === "auth/invalid-credential"){
      return "Şifre yanlış";
    }
    if(code === "auth/user-not-found"){
      return "Bu e-posta ile kayıtlı kullanıcı yok.";
    }
    if(code === "auth/email-already-in-use"){
      return "Bu e-posta zaten kayıtlı.";
    }
    if(code === "auth/invalid-email"){
      return "Geçerli bir e-posta girin.";
    }
    if(code === "auth/weak-password"){
      return "Şifre en az 6 karakter olmalı";
    }
    if(code === "auth/network-request-failed"){
      return "Google oturumu başlatılamadı. İnternet/VPN engeli veya Firebase Authorized Domains ayarını kontrol edin.";
    }
    if(code === "auth/popup-closed-by-user"){
      return "Bir hata oluştu";
    }
    if(code === "auth/popup-blocked"){
      // ✅ Kullanıcıya daha açıklayıcı mesaj
      return "Popup engellendi. Lütfen tarayıcınızın popup engelleyicisini bu site için kapatın.";
    }
    if(code === "auth/cancelled-popup-request"){
      return "Bir hata oluştu";
    }

    return fallback;
  }

  function createAppUserRecord(appData, firebaseUser){
    if(!firebaseUser) return null;

    const next = ensureAppData(appData);
    return {
      uid: firebaseUser.uid || next.settings.firebaseUid || "",
      email: firebaseUser.email || next.settings.email || "",
      name: next.settings.name || (firebaseUser.email || "").split("@")[0] || "Kullanıcı"
    };
  }

  function resolveAuthProvider(firebaseUser, fallbackProvider){
    const providerId = firebaseUser?.providerData?.[0]?.providerId || "";
    if(providerId === "google.com") return "google";
    if(providerId === "password") return "firebase";
    return String(fallbackProvider || "").trim() || "firebase";
  }

  function isGuest(appData){
    return ensureAppData(appData).settings.userType === "guest";
  }

  function applyAuthenticatedUser(appData, firebaseUser, extras){
    const next = ensureAppData(appData);
    const options = extras || {};
    const incomingName = String(options.name || "").trim();
    const resolvedName = incomingName || next.settings.name || (firebaseUser?.email || "").split("@")[0] || "Kullanıcı";

    next.settings.userType = "registered";
    next.settings.name = resolvedName;
    next.settings.email = firebaseUser?.email || String(options.email || "").trim() || next.settings.email || "";
    next.settings.password = "";
    next.settings.firebaseUid = firebaseUser?.uid || String(options.uid || "").trim() || next.settings.firebaseUid || "";
    next.settings.authProvider = String(options.provider || "").trim() || resolveAuthProvider(firebaseUser, "firebase");

    currentFirebaseUser = firebaseUser || currentFirebaseUser;
    AppAuth.user = createAppUserRecord(next, firebaseUser || currentFirebaseUser);

    if(options.persist !== false){
      saveAppData(next);
    }

    return next;
  }

  function applyGuestUser(appData, options){
    const next = ensureAppData(appData);
    const settings = next.settings;
    const config = Object.assign({ persist: true, clearIdentity: false }, options || {});

    settings.userType = "guest";
    settings.password = "";
    settings.firebaseUid = "";
    settings.authProvider = "";
    if(config.clearIdentity){
      settings.name = "";
      settings.email = "";
    }

    currentFirebaseUser = null;
    AppAuth.user = null;

    if(config.persist !== false){
      saveAppData(next);
    }

    return next;
  }

  function syncFromStorage(){
    const appData = loadAppData();
    if(isGuest(appData)){
      AppAuth.user = null;
      return appData;
    }

    AppAuth.user = {
      uid: appData.settings.firebaseUid || "",
      email: appData.settings.email || "",
      name: appData.settings.name || (appData.settings.email || "").split("@")[0] || "Kullanıcı"
    };
    return appData;
  }

  function ensureAuthConfigured(){
    if(authPersistencePromise) return authPersistencePromise;

    authPersistencePromise = setPersistence(auth, browserLocalPersistence)
      .catch(function(error){
        error.userMessage = getFirebaseErrorMessage(error);
        throw error;
      });

    return authPersistencePromise;
  }

  // ✅ Redirect akışı tamamen kaldırıldı. Artık sadece popup kullanılıyor.
  // handleRedirectSignInResult() yerine doğrudan onAuthStateChanged dinleniyor.

  function ensureAuthReady(){
    if(authReadyPromise) return authReadyPromise;

    authReadyPromise = ensureAuthConfigured()
      .then(function(){
        // Sayfada kalan eski redirect pending flag'ini temizle
        clearRedirectPending();

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
                name: firebaseUser.displayName || appData.settings.name,
                email: firebaseUser.email || appData.settings.email,
                provider: resolveAuthProvider(firebaseUser, appData.settings.authProvider || "firebase"),
                persist: true
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

  async function registerWithEmail(email, password){
    if(hasPlaceholderConfig()){
      throw new Error("Firebase ayarları eksik. assets/js/firebase.js içini doldurun.");
    }

    try{
      await ensureAuthConfigured();
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      currentFirebaseUser = credential.user;
      return credential.user;
    }catch(error){
      error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  async function loginWithEmail(email, password){
    if(hasPlaceholderConfig()){
      throw new Error("Firebase ayarları eksik. assets/js/firebase.js içini doldurun.");
    }

    try{
      await ensureAuthConfigured();
      const credential = await signInWithEmailAndPassword(auth, email, password);
      currentFirebaseUser = credential.user;
      return credential.user;
    }catch(error){
      error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

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
      const error = new Error("Bir hata oluştu");
      error.code = "auth/no-current-user";
      error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }

    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    return user;
  }

  async function changeCurrentUserPassword(currentPassword, newPassword){
    try{
      const user = await reauthenticateEmailUser(currentPassword);
      await updatePassword(user, newPassword);
      return user;
    }catch(error){
      error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  async function deleteCurrentUser(currentPassword){
    try{
      const user = await reauthenticateEmailUser(currentPassword);
      await deleteUser(user);
      currentFirebaseUser = null;
      AppAuth.user = null;
      return null;
    }catch(error){
      error.userMessage = getFirebaseErrorMessage(error);
      throw error;
    }
  }

  // ✅ DÜZELTME: Her ortamda (localhost, GitHub Pages, mobil) popup kullanılıyor.
  // Redirect akışı kaldırıldı — cross-origin sorunlarına neden oluyordu.
  // app-shell.js'deki window.open guard'ı popup öncesi askıya alınıyor.
  async function loginWithGoogle(){
    if(googleLoginPromise){
      return googleLoginPromise;
    }

    if(hasPlaceholderConfig()){
      throw new Error("Firebase ayarları eksik. assets/js/firebase.js içini doldurun.");
    }

    googleLoginPromise = (async function(){
      try{
        await ensureAuthConfigured();

        // ✅ app-shell.js'deki window.open override'ını geçici olarak kaldır.
        // Google popup'ı window.open ile açılıyor; guard engelliyordu.
        if(window.AppShell && typeof window.AppShell.suspendExternalNavigationGuard === "function"){
          window.AppShell.suspendExternalNavigationGuard();
        }else{
          window.__shellExternalGuardSuspended = true;
        }

        const result = await signInWithPopup(auth, googleProvider);

        // Guard'ı geri aç
        if(window.AppShell && typeof window.AppShell.resumeExternalNavigationGuard === "function"){
          window.AppShell.resumeExternalNavigationGuard();
        }else{
          window.__shellExternalGuardSuspended = false;
        }

        clearRedirectPending();
        currentFirebaseUser = result.user;
        const appData = loadAppData();
        applyAuthenticatedUser(appData, result.user, {
          name: result.user.displayName || appData.settings.name,
          email: result.user.email || appData.settings.email,
          provider: "google",
          persist: true
        });
        return result.user;

      }catch(error){
        // Hata durumunda da guard'ı geri aç
        if(window.AppShell && typeof window.AppShell.resumeExternalNavigationGuard === "function"){
          window.AppShell.resumeExternalNavigationGuard();
        }else{
          window.__shellExternalGuardSuspended = false;
        }

        clearRedirectPending();
        error.userMessage = getFirebaseErrorMessage(error);
        throw error;
      }finally{
        googleLoginPromise = null;
      }
    })();

    return googleLoginPromise;
  }

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
    logoutCurrentUser,
    changeCurrentUserPassword,
    deleteCurrentUser,
    getFirebaseErrorMessage
  });

  window.AppAuth = AppAuth;
  window.loginWithGoogle = loginWithGoogle;

  window.addEventListener("storage", function(event){
    if(event.key === STORAGE_KEY){
      syncFromStorage();
    }
  });
})();
