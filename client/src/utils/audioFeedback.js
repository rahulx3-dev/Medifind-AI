// Reusable Web Audio API tactile feedback synthesizer
// Provides low-latency, smooth, realistic mechanical click sounds without external audio assets.

let sharedAudioContext = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedAudioContext) {
    try {
      sharedAudioContext = new AudioContextClass();
    } catch {
      return null;
    }
  }

  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
}

/**
 * Play a smooth tactile click or event sound
 * @param {'press' | 'delete' | 'clear' | 'complete'} type
 */
export function playKeypadClickSound(type = 'press') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    if (type === 'complete') {
      // Harmonic verification chime when all 4 digits are completed
      const chord = [587.33, 880]; // D5, A5
      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.04);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.08, now + idx * 0.04 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.04 + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.04);
        osc.stop(now + idx * 0.04 + 0.23);
      });
      return;
    }

    if (type === 'delete') {
      // Soft, lower-pitched click for backspace/delete
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.035);

      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
      return;
    }

    if (type === 'clear') {
      // Swept gentle descending tone for clear
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.05);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.055);
      return;
    }

    // Default: Tactile, smooth mechanical switch click (iOS keyboard/haptic click feel)
    // 1. Transient click spike
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(1150, now);
    osc1.frequency.exponentialRampToValueAtTime(280, now + 0.032);

    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.032);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.035);

    // 2. Subtle warm body tone for smoothness
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(360, now);
    osc2.frequency.exponentialRampToValueAtTime(120, now + 0.028);

    gain2.gain.setValueAtTime(0.04, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.028);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(now);
    osc2.stop(now + 0.03);
  } catch {
    // Graceful fallback if audio context blocked
  }
}
