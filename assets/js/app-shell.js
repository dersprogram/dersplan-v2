(function(){
  const APP_VERSION = "20260409-2";
  const THEME_KEY = "appTheme";
  const FONT_KEY = "appFontSize";
  const SETTINGS_KEY = "ayarlar";
  const DAY_NAMES = ["Pazartesi", "Sal\u0131", "\u00c7ar\u015famba", "Per\u015fembe", "Cuma", "Cumartesi", "Pazar"];
  const FONT_MAP = {
    small: "13px",
    medium: "15px",
    large: "18px"
  };

  function normalizeLocalDevOrigin(){
    if(window.location.hostname !== "127.0.0.1") return;

    const targetUrl = new URL(window.location.href);
    targetUrl.hostname = "localhost";
    window.location.replace(targetUrl.toString());
  }

  normalizeLocalDevOrigin();

  function normalizeTheme(theme){
    return theme === "light" ? "light" : "dark";
  }

  function normalizeFontSize(size){
    return Object.prototype.hasOwnProperty.call(FONT_MAP, size) ? size : "medium";
  }

  function safeJsonParse(value, fallback){
    try{
      const parsed = JSON.parse(value);
      return parsed === null ? fallback : parsed;
    }catch(error){
      return fallback;
    }
  }

  function getStoredTheme(){
    return normalizeTheme(localStorage.getItem(THEME_KEY) || "dark");
  }

  function getStoredFontSize(){
    return normalizeFontSize(localStorage.getItem(FONT_KEY) || "medium");
  }

  function loadAppData(){
    return safeJsonParse(localStorage.getItem(SETTINGS_KEY), null);
  }

  function saveAppData(appData){
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(appData));
    return appData;
  } 
 

  function isGuestUser(appData){
    return appData?.settings?.userType === "guest";
  }

  function syncAuthState(){
    if(window.AppAuth && typeof window.AppAuth.syncFromStorage === "function"){
      return window.AppAuth.syncFromStorage();
    }
    return loadAppData();
  }

  function getTodayDayIndex(){
    const mapJsToOur = [6, 0, 1, 2, 3, 4, 5];
    return mapJsToOur[new Date().getDay()];
  }

  function getTodayDayName(){
    return DAY_NAMES[getTodayDayIndex()];
  }

  function cloneRows(rows){
    return (rows || []).map(function(row){
      return Object.assign({}, row);
    });
  }

  function hashText(value){
    const text = String(value || "");
    let hash = 2166136261;
    for(let index = 0; index < text.length; index += 1){
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createSeededRandom(seed){
    let state = (Number(seed) >>> 0) || 1;
    return function(){
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function shuffledRows(rows, seedKey){
    const list = cloneRows(rows);
    if(list.length < 2) return list;

    const random = createSeededRandom(hashText(seedKey));
    for(let index = list.length - 1; index > 0; index -= 1){
      const swapIndex = Math.floor(random() * (index + 1));
      const temp = list[index];
      list[index] = list[swapIndex];
      list[swapIndex] = temp;
    }
    return list;
  }

  function getGuestSourceDayName(){
    return getTodayDayName();
  }

  function getActiveDayNames(appData){
    const activeIndexes = Array.isArray(appData?.activeDays) && appData.activeDays.length
      ? appData.activeDays
      : [0, 1, 2, 3, 4];

    return activeIndexes
      .map(function(index){
        return DAY_NAMES[index];
      })
      .filter(Boolean);
  }

  function isActiveDay(appData, dayName){
    const resolvedDay = String(dayName || "").trim();
    if(!resolvedDay) return false;
    return getActiveDayNames(appData).includes(resolvedDay);
  }

  function isGuestEditableDay(appData, dayName){
    if(!isGuestUser(appData)) return true;
    return String(dayName || "").trim() === getGuestSourceDayName();
  }

  function getScheduleRowsForDay(appData, dayName){
    const schedule = appData?.schedule || {};
    const resolvedDay = String(dayName || "").trim();
    const dayIsActive = isActiveDay(appData, resolvedDay);

    if(!dayIsActive){
      return [];
    }

    if(!isGuestUser(appData) || isGuestEditableDay(appData, resolvedDay)){
      return cloneRows(schedule[resolvedDay] || []);
    }

    // Guest user: only active days are visible, and non-today active days
    // mirror today's lessons with a day-specific mixed row order.
    const sourceDay = getGuestSourceDayName();
    const sourceRows = schedule[sourceDay] || [];
    return shuffledRows(sourceRows, resolvedDay);
  } 
 
  function applyTheme(theme, persist){
    const nextTheme = normalizeTheme(theme);
    document.documentElement.dataset.theme = nextTheme;

    if(persist !== false){
      localStorage.setItem(THEME_KEY, nextTheme);
    }

    syncThemeToggleButton();
    return nextTheme;
  }

  function applyFontSize(size, persist){
    const nextSize = normalizeFontSize(size);
    document.documentElement.style.setProperty("--base-font-size", FONT_MAP[nextSize]);

    if(persist !== false){
      localStorage.setItem(FONT_KEY, nextSize);
    }

    const fontCtrl = document.getElementById("fontSizeCtrl");
    if(fontCtrl){
      fontCtrl.value = nextSize;
    }

    return nextSize;
  }

  function toggleTheme(){
    const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    return applyTheme(nextTheme, true);
  }

  function syncThemeToggleButton(){
    const btn = document.getElementById("themeToggle");
    if(!btn) return;

    const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const nextThemeLabel = theme === "light" ? "Koyu temaya ge\u00e7" : "A\u00e7\u0131k temaya ge\u00e7";
    const nextThemeIcon = theme === "light" ? "dark_mode" : "light_mode";
    btn.innerHTML = '<span class="icon" aria-hidden="true">' + nextThemeIcon + "</span>";
    btn.setAttribute("aria-label", nextThemeLabel);
    btn.setAttribute("title", nextThemeLabel);
  }

  function initNavActive(){
    const navItems = document.querySelectorAll(".navItem");
    if(!navItems.length) return;

    const path = location.pathname.toLowerCase();
    let current = "index";

    if(path.includes("weekly")) current = "weekly";
    else if(path.includes("notes")) current = "notes";
    else if(path.includes("settings")) current = "settings";

    navItems.forEach(function(item){
      item.classList.toggle("active", item.dataset.nav === current);
    });
  }

  function bindNavClicks(){
    const pageSuffix = "?v=" + encodeURIComponent(APP_VERSION);
    const targets = {
      index: "index.html" + pageSuffix,
      weekly: "weekly.html" + pageSuffix,
      notes: "notes.html?mode=list&v=" + encodeURIComponent(APP_VERSION),
      settings: "settings.html" + pageSuffix
    };

    document.querySelectorAll(".navItem").forEach(function(item){
      if(item.dataset.shellBoundNav === "true") return;
      item.dataset.shellBoundNav = "true";

      item.addEventListener("click", function(){
        const next = targets[item.dataset.nav];
        if(next){
          location.replace(next);
        }
      });
    });
  }

  function bindThemeToggle(){
    const btn = document.getElementById("themeToggle");
    if(!btn || btn.dataset.shellBound === "true") return;

    btn.dataset.shellBound = "true";
    btn.addEventListener("click", function(){
      toggleTheme();
    });
    syncThemeToggleButton();
  }

  const EXTERNAL_NAV_ALLOWLIST = [
    "accounts.google.com",
    ".google.com",
    ".firebaseapp.com"
  ];

  function isAllowedExternalHost(hostname){
    const normalizedHost = String(hostname || "").toLowerCase();
    if(!normalizedHost) return false;

    return EXTERNAL_NAV_ALLOWLIST.some(function(allowedHost){
      if(allowedHost.startsWith(".")){
        const suffix = allowedHost.slice(1);
        return normalizedHost === suffix || normalizedHost.endsWith("." + suffix);
      }

      return normalizedHost === allowedHost;
    });
  }

  function isBlockedExternalUrl(url){
    if(!url) return false;
    if(window.__shellExternalGuardSuspended === true) return false;

    try{
      const parsed = new URL(url, window.location.href);
      const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
      const isSameOrigin = parsed.origin === window.location.origin;
      if(!isHttp || isSameOrigin) return false;

      return !isAllowedExternalHost(parsed.hostname);
    }catch(error){
      return false;
    }
  }

  function suspendExternalNavigationGuard(){
    window.__shellExternalGuardSuspended = true;
  }

  function resumeExternalNavigationGuard(){
    window.__shellExternalGuardSuspended = false;
  }

  function bindExternalNavigationGuard(){
    if(document.documentElement.dataset.shellExternalGuard === "true") return;
    document.documentElement.dataset.shellExternalGuard = "true";

    const nativeOpen = window.open;
    if(typeof nativeOpen === "function" && window.__shellOpenPatched !== true){
      window.__shellOpenPatched = true;
      window.open = function(url){
        if(isBlockedExternalUrl(url)){
          return null;
        }
        return nativeOpen.apply(window, arguments);
      };
    }

    document.addEventListener("click", function(event){
      const anchor = event.target.closest("a[href]");
      if(!anchor) return;

      const href = anchor.getAttribute("href");
      if(isBlockedExternalUrl(href)){
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  function addCacheBusting(){
    if(!window.location.search.includes("devcss=1")) return;

    const links = document.querySelectorAll('link[rel="stylesheet"]');
    links.forEach(function(link){
      const href = link.getAttribute("href");
      if(href && href.indexOf("?") === -1){
        link.setAttribute("href", href + "?t=" + Date.now());
      }
    });
  }

  function hideRegisterPrompt(){
    const modal = document.getElementById("registerPrompt");
    if(modal){
      modal.classList.add("hidden");
    }
    document.body.classList.remove("registerPrompt-open");
  }

  function triggerRegisterFlow(){
    if(typeof window.goRegister === "function"){
      window.goRegister();
      return;
    }

    window.location.href = "settings.html";
  }

  function ensureRegisterPrompt(){
    let modal = document.getElementById("registerPrompt");
    if(modal) return modal;

    modal = document.createElement("div");
    modal.id = "registerPrompt";
    modal.className = "registerPrompt hidden";
    modal.innerHTML = [
      '<div class="registerPrompt-backdrop" data-register-close="true"></div>',
      '<div class="registerPrompt-card" role="dialog" aria-modal="true" aria-labelledby="registerPromptTitle">',
      '<div class="registerPrompt-kicker">SINIRLI KULLANIM</div>',
      '<div class="registerPrompt-title" id="registerPromptTitle">Bu \u00f6zelli\u011fin tamam\u0131n\u0131 kullanmak i\u00e7in kay\u0131t olun.</div>',
      '<div class="registerPrompt-text" id="registerPromptText" style="display:none;"></div>',
      '<div class="registerPrompt-actions">',
      '<button type="button" class="registerPrompt-primary" id="registerPromptGo">Kay\u0131t Ol</button>',
      '<button type="button" class="registerPrompt-secondary" id="registerPromptCancel">Vazge\u00e7</button>',
      "</div>",
      "</div>"
    ].join("");

    document.body.appendChild(modal);

    modal.addEventListener("click", function(event){
      if(event.target.closest("[data-register-close='true']") || event.target.id === "registerPromptCancel"){
        hideRegisterPrompt();
      }
      if(event.target.id === "registerPromptGo"){
        hideRegisterPrompt();
        triggerRegisterFlow();
      }
    });

    return modal;
  }

  function showRegisterPrompt(message){
    const modal = ensureRegisterPrompt();
    const text = document.getElementById("registerPromptText");
    if(text){
      text.textContent = "";
      text.style.display = "none";
    }
    modal.classList.remove("hidden");
    document.body.classList.add("registerPrompt-open");
  }

  function initAppShell(){
    syncAuthState();
    addCacheBusting();
    applyTheme(getStoredTheme(), false);
    applyFontSize(getStoredFontSize(), false);
    bindExternalNavigationGuard();
    bindNavClicks();
    initNavActive();
    bindThemeToggle();
    ensureRegisterPrompt();
  }

  window.AppShell = {
    THEME_KEY,
    FONT_KEY,
    SETTINGS_KEY,
    DAY_NAMES,
    safeJsonParse,
    getStoredTheme,
    getStoredFontSize,
    loadAppData,
    saveAppData,
    isGuestUser,
    syncAuthState,
    getTodayDayIndex,
    getTodayDayName,
    getActiveDayNames,
    isActiveDay,
    getGuestSourceDayName,
    isGuestEditableDay,
    getScheduleRowsForDay,
    applyTheme,
    applyFontSize,
    toggleTheme,
    bindExternalNavigationGuard,
    suspendExternalNavigationGuard,
    resumeExternalNavigationGuard,
    bindNavClicks,
    initNavActive,
    initAppShell,
    syncThemeToggleButton,
    showRegisterPrompt,
    hideRegisterPrompt,
    triggerRegisterFlow
  };

  applyTheme(getStoredTheme(), false);
  applyFontSize(getStoredFontSize(), false);
  document.addEventListener("DOMContentLoaded", initAppShell);
  window.addEventListener("storage", function(event){
    if(event.key === THEME_KEY){
      applyTheme(event.newValue || "dark", false);
    }
    if(event.key === FONT_KEY){
      applyFontSize(event.newValue || "medium", false);
    }
    if(event.key === SETTINGS_KEY){
      syncAuthState();
    }
  });
})();
