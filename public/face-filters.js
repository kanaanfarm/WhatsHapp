import { FaceLandmarker, FilesetResolver } from "./vendor/mediapipe/vision_bundle.mjs";

const MODEL_URL = "/vendor/mediapipe/face_landmarker.task";
const WASM_URL = "/vendor/mediapipe/wasm";
const DETECTION_INTERVAL_MS = 190;

let landmarker = null;
let initializing = null;
let lastDetectionAt = 0;
let lastLandmarks = null;
let disabled = false;
let faceBuffer = null;

async function createLandmarker(delegate) {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate
    },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.55,
    minFacePresenceConfidence: 0.55,
    minTrackingConfidence: 0.5
  });
}

function ensureReady() {
  if (landmarker) return Promise.resolve(landmarker);
  if (disabled) return Promise.resolve(null);
  if (!initializing) {
    initializing = createLandmarker("GPU")
      .catch(() => createLandmarker("CPU"))
      .then(instance => {
        landmarker = instance;
        document.documentElement.dataset.faceBeauty = "ready";
        return instance;
      })
      .catch(error => {
        disabled = true;
        document.documentElement.dataset.faceBeauty = "fallback";
        console.warn("Face-aware Beauty is unavailable; using the standard Beauty filter.", error);
      })
      .finally(() => {
        initializing = null;
      });
  }
  return initializing;
}

function faceBounds(landmarks, width, height) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of landmarks || []) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (maxX <= minX || maxY <= minY) return null;
  const x = Math.max(0, minX * width);
  const y = Math.max(0, minY * height);
  const w = Math.min(width - x, (maxX - minX) * width);
  const h = Math.min(height - y, (maxY - minY) * height);
  return w > 24 && h > 24 ? { x, y, w, h } : null;
}

function ellipse(ctx, cx, cy, rx, ry, rotation = 0) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), rotation, 0, Math.PI * 2);
  ctx.clip();
}

function blendSkinRegion(ctx, buffer, bounds, region, blur, opacity) {
  const { x, y, w, h } = bounds;
  ctx.save();
  ellipse(
    ctx,
    x + w * region.cx,
    y + h * region.cy,
    w * region.rx,
    h * region.ry,
    region.rotation || 0
  );
  ctx.globalAlpha = opacity;
  ctx.filter = `blur(${blur}px) brightness(1.045) saturate(1.035)`;
  ctx.drawImage(buffer, x, y, w, h);
  ctx.restore();
}

function applySkinSmoothing(canvas, landmarks) {
  const width = canvas.width;
  const height = canvas.height;
  const bounds = faceBounds(landmarks, width, height);
  if (!bounds) return;

  if (!faceBuffer) faceBuffer = document.createElement("canvas");
  const cropWidth = Math.max(1, Math.ceil(bounds.w));
  const cropHeight = Math.max(1, Math.ceil(bounds.h));
  if (faceBuffer.width !== cropWidth) faceBuffer.width = cropWidth;
  if (faceBuffer.height !== cropHeight) faceBuffer.height = cropHeight;
  const bufferContext = faceBuffer.getContext("2d", { alpha: false });
  const outputContext = canvas.getContext("2d", { alpha: false });
  if (!bufferContext || !outputContext) return;

  bufferContext.save();
  bufferContext.filter = "none";
  bufferContext.clearRect(0, 0, cropWidth, cropHeight);
  bufferContext.drawImage(
    canvas,
    bounds.x, bounds.y, bounds.w, bounds.h,
    0, 0, cropWidth, cropHeight
  );
  bufferContext.restore();

  const blur = Math.max(3, Math.min(12, bounds.w * 0.028));

  // Smooth skin zones separately. The eye/glasses band, hairline, nose,
  // mouth, moustache and beard are intentionally not covered.
  blendSkinRegion(outputContext, faceBuffer, bounds, {
    cx: 0.5, cy: 0.205, rx: 0.255, ry: 0.115
  }, blur, 0.54);
  blendSkinRegion(outputContext, faceBuffer, bounds, {
    cx: 0.285, cy: 0.57, rx: 0.17, ry: 0.145, rotation: -0.12
  }, blur, 0.58);
  blendSkinRegion(outputContext, faceBuffer, bounds, {
    cx: 0.715, cy: 0.57, rx: 0.17, ry: 0.145, rotation: 0.12
  }, blur, 0.58);

  // A very light complexion lift makes Beauty clearly visible without
  // washing out facial detail.
  outputContext.save();
  ellipse(
    outputContext,
    bounds.x + bounds.w * 0.5,
    bounds.y + bounds.h * 0.49,
    bounds.w * 0.36,
    bounds.h * 0.39
  );
  outputContext.globalCompositeOperation = "screen";
  outputContext.globalAlpha = 0.035;
  outputContext.fillStyle = "#ffd8c8";
  outputContext.fillRect(bounds.x, bounds.y, bounds.w, bounds.h * 0.78);
  outputContext.restore();
}

function process(canvas) {
  if (!canvas?.width || !canvas?.height || disabled) return;
  if (!landmarker) {
    ensureReady();
    return;
  }

  const now = performance.now();
  if (now - lastDetectionAt >= DETECTION_INTERVAL_MS) {
    lastDetectionAt = now;
    try {
      const result = landmarker.detectForVideo(canvas, now);
      lastLandmarks = result?.faceLandmarks?.[0] || null;
    } catch (error) {
      console.warn("Face-aware Beauty detection skipped.", error);
      lastLandmarks = null;
    }
  }

  if (lastLandmarks) applySkinSmoothing(canvas, lastLandmarks);
}

async function processStill(canvas) {
  if (!canvas?.width || !canvas?.height || disabled) return false;
  const instance = landmarker || await ensureReady();
  if (!instance) return false;
  try {
    const now = performance.now();
    const result = instance.detectForVideo(canvas, now);
    const landmarks = result?.faceLandmarks?.[0] || null;
    if (!landmarks) return false;
    lastDetectionAt = now;
    lastLandmarks = landmarks;
    applySkinSmoothing(canvas, landmarks);
    return true;
  } catch (error) {
    console.warn("Face-aware photo Beauty was skipped.", error);
    return false;
  }
}

window.ConnectChatFaceBeauty = {
  process,
  processStill,
  warmUp: ensureReady,
  status() {
    if (landmarker) return "ready";
    if (disabled) return "fallback";
    return initializing ? "loading" : "idle";
  }
};
