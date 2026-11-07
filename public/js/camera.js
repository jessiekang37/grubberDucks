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

// Move the camera box between the main screen and the enroll screen,
// so there's only ever one camera feed.
function moveCameraTo(containerId) {
  const cameraBox = document.getElementById("camera-box");
  document.getElementById(containerId).appendChild(cameraBox);
}
