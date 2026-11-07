// sounds.js
// Short beeps made by the browser itself (no sound files needed).
// Note: Chrome stays silent until someone has tapped/clicked the page once.

let audioContext = null;

// Play one tone. frequency in Hz, duration in seconds, delay in seconds.
function playTone(frequency, duration, delay = 0, type = "sine") {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();

  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const volume = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  volume.gain.setValueAtTime(0.25, start);
  volume.gain.exponentialRampToValueAtTime(0.001, start + duration); // fade out
  oscillator.connect(volume).connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function playSound(kind) {
  try {
    if (kind === "success") {
      playTone(880, 0.15); // one bright beep
    } else if (kind === "complete") {
      playTone(660, 0.12); // rising three-note chime: order fully scanned
      playTone(880, 0.12, 0.12);
      playTone(1320, 0.25, 0.24);
    } else if (kind === "error") {
      playTone(180, 0.3, 0, "square"); // low buzz
    }
  } catch (err) {
    console.warn("Sound failed:", err);
  }
}

// Unlock audio on the first tap anywhere, so the first scan can beep.
document.addEventListener(
  "pointerdown",
  () => {
    if (!audioContext) audioContext = new AudioContext();
    audioContext.resume();
  },
  { once: true }
);
