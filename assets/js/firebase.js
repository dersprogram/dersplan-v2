import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  initializeAuth
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDVPbMlOf6pczo_Yh_Z62VAg30ah5KLQJc",
  authDomain: "derstakippro-bbbb3.firebaseapp.com",
  projectId: "derstakippro-bbbb3",
  storageBucket: "derstakippro-bbbb3.firebasestorage.app",
  messagingSenderId: "706136035599",
  appId: "1:706136035599:web:954c01af172c66b8922e7a"
};

const PLACEHOLDER_VALUES = [
  "YOUR_API_KEY",
  "YOUR_AUTH_DOMAIN",
  "YOUR_PROJECT_ID",
  "YOUR_STORAGE_BUCKET",
  "YOUR_MESSAGING_SENDER_ID",
  "YOUR_APP_ID"
];

const hasPlaceholderConfig = Object.values(firebaseConfig).some(function(value){
  return PLACEHOLDER_VALUES.includes(String(value || "").trim());
});

if(hasPlaceholderConfig){
  console.warn("Firebase config doldurulmalı");
}

export const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});
window.AppAuth = auth;