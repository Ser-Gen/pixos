export const VAD_PROFILES = {
  file: {
    threshold: 0.35,
    minSilenceDuration: 0.25,
    minSpeechDuration: 0.25,
    maxSpeechDuration: 5,
    minSegmentRms: 0.008,
  },
  microphone: {
    threshold: 0.55,
    minSilenceDuration: 0.4,
    minSpeechDuration: 0.5,
    maxSpeechDuration: 5,
    minSegmentRms: 0.012,
  },
};

const VAD_FIELD_BOUNDS = {
  threshold: { min: 0.05, max: 0.95 },
  minSilenceDuration: { min: 0.05, max: 5 },
  minSpeechDuration: { min: 0.05, max: 5 },
  maxSpeechDuration: { min: 1, max: 30 },
  minSegmentRms: { min: 0, max: 0.1 },
};

export function resolveVadProfile(source, vadProfile) {
  if (vadProfile === 'microphone' || vadProfile === 'file') {
    return vadProfile;
  }
  if (typeof source === 'string' && /live|микрофон|microphone|mic/i.test(source)) {
    return 'microphone';
  }
  return 'file';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeVadOptions(profileName, overrides = {}) {
  const profile = VAD_PROFILES[profileName] ? profileName : 'file';
  const base = VAD_PROFILES[profile];
  const result = { ...base };

  for (const key of Object.keys(VAD_FIELD_BOUNDS)) {
    if (overrides[key] == null || overrides[key] === '') {
      continue;
    }
    const value = Number(overrides[key]);
    if (Number.isNaN(value)) {
      continue;
    }
    const { min, max } = VAD_FIELD_BOUNDS[key];
    result[key] = clamp(value, min, max);
  }

  return result;
}

export function mergeVadOptions(source, vadProfile, overrides) {
  const profile = resolveVadProfile(source, vadProfile);
  return normalizeVadOptions(profile, overrides);
}

export function getDefaultVadOptions(profileName = 'file') {
  return { ...VAD_PROFILES[profileName in VAD_PROFILES ? profileName : 'file'] };
}
