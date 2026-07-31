import { FaceLandmarker, FilesetResolver } from "./vendor/mediapipe/vision_bundle.mjs";

const MODEL_URL="/vendor/mediapipe/face_landmarker.task";
const WASM_URL="/vendor/mediapipe/wasm";
const DETECTION_INTERVAL_MS=180;

let landmarker=null,initializing=null,disabled=false,lastAt=0,lastLandmarks=null;
let faceBuffer=null,fullCopy=null;

async function makeLandmarker(delegate){
  const vision=await FilesetResolver.forVisionTasks(WASM_URL);
  return FaceLandmarker.createFromOptions(vision,{
    baseOptions:{modelAssetPath:MODEL_URL,delegate},
    runningMode:"VIDEO",
    numFaces:1,
    minFaceDetectionConfidence:.62,
    minFacePresenceConfidence:.62,
    minTrackingConfidence:.58
  });
}
function ensureReady(){
  if(landmarker)return Promise.resolve(landmarker);
  if(disabled)return Promise.resolve(null);
  if(!initializing){
    initializing=makeLandmarker("GPU").catch(()=>makeLandmarker("CPU")).then(v=>{
      landmarker=v;document.documentElement.dataset.faceBeauty="ready";return v;
    }).catch(e=>{
      disabled=true;document.documentElement.dataset.faceBeauty="fallback";
      console.warn("Face beauty engine unavailable",e);return null;
    }).finally(()=>initializing=null);
  }
  return initializing;
}
function getBounds(lm,w,h){
  let l=1,t=1,r=0,b=0;
  for(const p of lm||[]){if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;l=Math.min(l,p.x);r=Math.max(r,p.x);t=Math.min(t,p.y);b=Math.max(b,p.y)}
  if(r<=l||b<=t)return null;
  // 6845: MediaPipe's landmark box is tighter than the visible face.
  // Expand it so forehead, outer cheeks, ears, jaw and beard stay inside the mask.
  const rawX=l*w,rawY=t*h,rawW=(r-l)*w,rawH=(b-t)*h;
  const x=Math.max(0,rawX-rawW*.10);
  const y=Math.max(0,rawY-rawH*.13);
  const right=Math.min(w,rawX+rawW*1.10);
  const bottom=Math.min(h,rawY+rawH*1.09);
  return{x,y,w:right-x,h:bottom-y,cx:(x+right)/2,cy:(y+bottom)/2};
}
function clipFace(ctx,B,cx=.5,cy=.49,rx=.36,ry=.39){
  ctx.beginPath();ctx.ellipse(B.x+B.w*cx,B.y+B.h*cy,B.w*rx,B.h*ry,0,0,Math.PI*2);ctx.closePath();ctx.clip();
}
function ensureCanvas(ref,w,h){
  if(!ref)ref=document.createElement("canvas");
  if(ref.width!==w)ref.width=w;if(ref.height!==h)ref.height=h;
  return ref;
}
function drawFaceCrop(ctx,buf,B){
  // buf is already a face-only crop. Always read it from 0,0; using B.x/B.y
  // as source coordinates cropped the filter a second time in older builds.
  ctx.drawImage(buf,0,0,buf.width,buf.height,B.x,B.y,B.w,B.h);
}
function softenRegion(ctx,buf,B,cx,cy,rx,ry,blur,alpha){
  ctx.save();clipFace(ctx,B,cx,cy,rx,ry);ctx.globalCompositeOperation="source-over";ctx.globalAlpha=alpha;
  ctx.filter=`blur(${blur}px)`;
  drawFaceCrop(ctx,buf,B);ctx.restore();
}

function unifiedSkinPass(ctx,source,B,mode){
  // 6846: smoothing changes texture only. Colour is controlled by the
  // full-frame CSS filter so skin, moustache and beard cannot become two-tone.
  const young=mode==="youngslim";
  const refFace=360;
  const sizeNorm=Math.max(.82,Math.min(1.22,refFace/Math.max(180,B.w)));
  const smoothAlpha=(young?.28:.34)*sizeNorm;

  // Feathered full-face cleanup. Three overlapping masks remove the visible
  // circular edge while keeping the central skin treatment unchanged.
  const blur=Math.max(.9,Math.min(2.2,(young?1.15:1.65)*sizeNorm));
  for(const pass of [
    {rx:.475,ry:.495,alpha:smoothAlpha*.16},
    {rx:.450,ry:.470,alpha:smoothAlpha*.30},
    {rx:.420,ry:.445,alpha:smoothAlpha*.54}
  ]){
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(B.x+B.w*.50,B.y+B.h*.49,B.w*pass.rx,B.h*pass.ry,0,0,Math.PI*2);
    ctx.clip();
    ctx.globalCompositeOperation="source-over";
    ctx.globalAlpha=pass.alpha;
    ctx.filter=`blur(${blur}px)`;
    drawFaceCrop(ctx,source,B);
    ctx.restore();
  }

  // Restore important high-detail zones from the original image.
  const restore=(cx,cy,rx,ry,alpha=.98)=>{
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(B.x+B.w*cx,B.y+B.h*cy,B.w*rx,B.h*ry,0,0,Math.PI*2);
    ctx.clip();
    ctx.globalAlpha=alpha;
    ctx.globalCompositeOperation="source-over";
    ctx.filter="none";
    drawFaceCrop(ctx,source,B);
    ctx.restore();
  };

  // Eyes / brows / glasses area
  restore(.50,.36,.35,.12,.99);
  // Nose / mouth / moustache
  restore(.50,.57,.23,.20,.98);
  // Beard / chin
  restore(.50,.74,.30,.18,.98);

}

function slimLowerFace(ctx,copy,B,strength){
  const top=B.y+B.h*.34,bot=B.y+B.h*.96,n=38,bh=(bot-top)/n;
  for(let i=0;i<n;i++){
    const y=top+i*bh,u=i/(n-1);
    const cheek=Math.sin(Math.PI*u);
    const jaw=Math.max(0,(u-.48)/.52);
    // approx. 2–5% compression; visible but still recognisable.
    const squeeze=strength*(.027*cheek+.024*Math.max(cheek*.72,jaw));
    const sw=B.w*1.12,dw=sw*(1-squeeze);
    ctx.drawImage(copy,B.cx-sw/2,y,sw,bh+1,B.cx-dw/2,y,dw,bh+1);
  }
}
function apply(canvas,lm,mode="beauty"){
  const ctx=canvas.getContext("2d",{alpha:false});if(!ctx)return;
  const B=getBounds(lm,canvas.width,canvas.height);if(!B||B.w<55)return;
  const young=mode==="youngslim";

  faceBuffer=ensureCanvas(faceBuffer,Math.max(1,Math.round(B.w)),Math.max(1,Math.round(B.h)));
  const bc=faceBuffer.getContext("2d",{alpha:false});
  bc.clearRect(0,0,faceBuffer.width,faceBuffer.height);
  bc.drawImage(canvas,B.x,B.y,B.w,B.h,0,0,faceBuffer.width,faceBuffer.height);

  fullCopy=ensureCanvas(fullCopy,canvas.width,canvas.height);
  const fc=fullCopy.getContext("2d",{alpha:false});
  fc.clearRect(0,0,canvas.width,canvas.height);fc.drawImage(canvas,0,0);

  if(young)slimLowerFace(ctx,fullCopy,B,.92);

  unifiedSkinPass(ctx,faceBuffer,B,mode);
}
function process(canvas,mode="beauty"){
  if(!canvas?.width||!canvas?.height||disabled)return;
  if(!landmarker){ensureReady();return}
  const now=performance.now();
  if(now-lastAt>=DETECTION_INTERVAL_MS){
    lastAt=now;
    try{lastLandmarks=landmarker.detectForVideo(canvas,now)?.faceLandmarks?.[0]||null}catch{lastLandmarks=null}
  }
  if(lastLandmarks)apply(canvas,lastLandmarks,mode);
}

async function processStill(canvas,mode="beauty"){
  const inst=landmarker||await ensureReady();if(!inst)return false;
  try{
    const now=performance.now(),lm=inst.detectForVideo(canvas,now)?.faceLandmarks?.[0]||null;
    if(!lm)return false;lastLandmarks=lm;lastAt=now;apply(canvas,lm,mode);return true;
  }catch{return false}
}
window.ConnectChatFaceBeauty={
  process,processStill,warmUp:ensureReady,
  status(){return landmarker?"ready":disabled?"fallback":initializing?"loading":"idle"}
};
