// camera.js
// Turns on the webcam and shows it in the <video> element.
// Chrome only allows this on http://localhost or https:// pages.

async function startCamera() {
  const videoEl = document.getElementById("camera-video");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return videoEl;
}

// True once the video has real frames we can read.
function isCameraReady() {
  const videoEl = document.getElementById("camera-video");
  return videoEl.readyState >= 2 && videoEl.videoWidth > 0;
}

function getCameraVideo() {
  return document.getElementById("camera-video");
}

// The square in the middle of the camera picture that we actually scan,
// in camera pixels: { x, y, size }.
function getScanZone(videoEl) {
  const size = Math.round(Math.min(videoEl.videoWidth, videoEl.videoHeight) * CONFIG.SCAN_ZONE_SIZE);
  return {
    x: Math.round((videoEl.videoWidth - size) / 2),
    y: Math.round((videoEl.videoHeight - size) / 2),
    size: size,
  };
}

// Size the on-screen guide box so it shows exactly the scan zone.
// (The video is scaled to fill its box, so we scale the zone the same way.)
function updateScanZoneGuide() {
  const videoEl = getCameraVideo();
  const guide = document.querySelector(".camera-guide");
  if (!guide || !videoEl.videoWidth) return;
  const box = videoEl.getBoundingClientRect();
  const scale = Math.max(box.width / videoEl.videoWidth, box.height / videoEl.videoHeight);
  const side = Math.round(getScanZone(videoEl).size * scale) + "px";
  if (guide.style.width !== side) {
    guide.style.width = side;
    guide.style.height = side;
  }
}

// Move the camera box between the main screen and the enroll screen,
// so there's only ever one camera feed.
function moveCameraTo(containerId) {
  const cameraBox = document.getElementById("camera-box");
  document.getElementById(containerId).appendChild(cameraBox);
}

// Ask the webcam for a sharper picture (for reading tickets) or go back to
// normal size (faster for scanning). If the camera can't, it just keeps going.
function setCameraHighRes(highRes) {
  const stream = getCameraVideo().srcObject;
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  track
    .applyConstraints(highRes ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 640 }, height: { ideal: 480 } })
    .catch((err) => console.warn("Camera resolution change failed:", err));
}
