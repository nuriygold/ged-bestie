// Tiny localStorage wrapper. One-user app → one profile keyed by STORAGE_KEY.
import { createProfile, migrateProfile } from "./profile.js";

const STORAGE_KEY = "ged-bff:profile:v1";

function hasStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function loadProfile() {
  if (!hasStorage()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return migrateProfile(parsed);
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn("Could not save profile:", err);
  }
}

export function resetProfile() {
  if (!hasStorage()) return;
  localStorage.removeItem(STORAGE_KEY);
}

export function ensureProfile({ name, targetDate } = {}) {
  const existing = loadProfile();
  if (existing) return existing;
  const fresh = createProfile({ name, targetDate });
  saveProfile(fresh);
  return fresh;
}

/** Export profile as a downloadable JSON blob URL. */
export function exportProfileBlob(profile) {
  const data = JSON.stringify(profile, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  return URL.createObjectURL(blob);
}

/** Import a profile JSON string; returns migrated profile or throws. */
export function importProfileFromText(text) {
  const parsed = JSON.parse(text);
  return migrateProfile(parsed);
}
