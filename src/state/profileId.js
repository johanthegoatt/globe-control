const PROFILE_KEY = "globe_v3.profile_id";

export function getOrCreateProfileId() {
  try {
    const existing = localStorage.getItem(PROFILE_KEY);
    if (existing) return existing;
  } catch {
    // Ignore storage failures.
  }

  const id = `profile_${crypto.randomUUID()}`;
  try {
    localStorage.setItem(PROFILE_KEY, id);
  } catch {
    // Ignore storage failures.
  }
  return id;
}
