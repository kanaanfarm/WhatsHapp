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
  return{x:l*w,y:t*h,w:(r-l)*w,h:(b-t)*h,cx:(l+r)*w/2,cy:(t+b)*h/2};
}
function clipFace(ctx,B,cx=.5,cy=.49,rx=.36,ry=.39){
  ctx.beginPath();ctx.ellipse(B.x+B.w*cx,B.y+B.h*cy,B.w*rx,B.h*ry,0,0,Math.PI*2);ctx.closePath();ctx.clip();
}
function ensureCanvas(ref,w,h){
  if(!ref)ref=document.createElement("canvas");
  if(ref.width!==w)ref.width=w;if(ref.height!==h)ref.height=h;
  return ref;
}
function softenRegion(ctx,buf,B,cx,cy,rx,ry,blur,alpha){
  ctx.save();clipFace(ctx,B,cx,cy,rx,ry);ctx.globalCompositeOperation="screen";ctx.globalAlpha=alpha;
  ctx.filter=`blur(${blur}px) brightness(1.025) saturate(1.015)`;
  ctx.drawImage(buf,B.x,B.y,B.w,B.h);ctx.restore();
}

function unifiedYoungSkinPass(ctx,source,B,lm){
  // 6831: normalize Young + Slim so mobile/laptop and near/far faces stay closer.
  const refFace=360;
  const sizeNorm=Math.max(.82,Math.min(1.22,refFace/Math.max(180,B.w)));
  const smoothAlpha=.085*sizeNorm;
  const toneAlpha=.022*Math.min(1.08,sizeNorm);

  // One continuous full-face mask. This replaces multiple visible smoothing islands.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(
    B.x+B.w*.50,
    B.y+B.h*.49,
    B.w*.405,
    B.h*.435,
    0,0,Math.PI*2
  );
  ctx.clip();

  // Gentle full-face cleanup; low blur so skin texture remains.
  ctx.globalCompositeOperation="screen";
  ctx.globalAlpha=smoothAlpha;
  ctx.filter=`blur(${Math.max(.85,Math.min(1.65,1.18*sizeNorm))}px) brightness(1.010) saturate(1.008)`;
  ctx.drawImage(source,B.x,B.y,B.w,B.h);
  ctx.restore();

  // Restore important high-detail zones from the original image.
  const restore=(cx,cy,rx,ry,alpha=.98)=>{
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(B.x+B.w*cx,B.y+B.h*cy,B.w*rx,B.h*ry,0,0,Math.PI*2);
    ctx.clip();
    ctx.globalAlpha=alpha;
    ctx.globalCompositeOperation="source-over";
    ctx.filter="none";
    ctx.drawImage(source,B.x,B.y,B.w,B.h);
    ctx.restore();
  };

  // Eyes / brows / glasses area
  restore(.50,.36,.35,.12,.99);
  // Nose / mouth / moustache
  restore(.50,.57,.23,.20,.98);
  // Beard / chin
  restore(.50,.74,.30,.18,.98);

  // Mild tone evenness over the whole face without extra blur.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(B.x+B.w*.50,B.y+B.h*.48,B.w*.395,B.h*.425,0,0,Math.PI*2);
  ctx.clip();
  ctx.globalCompositeOperation="soft-light";
  ctx.globalAlpha=toneAlpha;
  ctx.fillStyle="#f0c9b9";
  ctx.fillRect(B.x,B.y,B.w,B.h);
  ctx.restore();
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
  const sizeNorm=Math.max(.82,Math.min(1.22,360/Math.max(180,B.w)));

  faceBuffer=ensureCanvas(faceBuffer,Math.max(1,Math.round(B.w)),Math.max(1,Math.round(B.h)));
  const bc=faceBuffer.getContext("2d",{alpha:false});
  bc.clearRect(0,0,faceBuffer.width,faceBuffer.height);
  bc.drawImage(canvas,B.x,B.y,B.w,B.h,0,0,faceBuffer.width,faceBuffer.height);

  fullCopy=ensureCanvas(fullCopy,canvas.width,canvas.height);
  const fc=fullCopy.getContext("2d",{alpha:false});
  fc.clearRect(0,0,canvas.width,canvas.height);fc.drawImage(canvas,0,0);

  if(young)slimLowerFace(ctx,fullCopy,B,.92);

  const blur=Math.max(0.9,Math.min(3.0,B.w*(young?.0054:.0095)));
  // Forehead and cheeks only: avoid blurring glasses, eyes, mouth and beard.
  if(young){
    unifiedYoungSkinPass(ctx,faceBuffer,B,lm);
  }else{
    softenRegion(ctx,faceBuffer,B,.50,.25,.35,.19,Math.max(1.0,blur*.82),.19);
    softenRegion(ctx,faceBuffer,B,.34,.54,.26,.25,Math.max(1.0,blur*.84),.21);
    softenRegion(ctx,faceBuffer,B,.66,.54,.26,.25,Math.max(1.0,blur*.84),.21);
  }

  // More even, cleaner skin tone.
  ctx.save();clipFace(ctx,B,.5,.44,.34,.33);
  ctx.globalCompositeOperation="soft-light";ctx.globalAlpha=young?.072:.045;
  ctx.fillStyle="#f1c8b6";ctx.fillRect(B.x,B.y,B.w,B.h*.76);ctx.restore();

  // Reduce forehead and nose shine.
  ctx.save();clipFace(ctx,B,.5,.37,.22,.28);
  ctx.globalCompositeOperation="multiply";ctx.globalAlpha=young?.033:.022;
  ctx.fillStyle="#dddddd";ctx.fillRect(B.x,B.y,B.w,B.h*.70);ctx.restore();

  // Under-eye lift.
  if(young&&lm.length>363){
    for(const pair of [[33,133],[362,263]]){
      const ex=(lm[pair[0]].x+lm[pair[1]].x)*canvas.width/2;
      const ey=(lm[pair[0]].y+lm[pair[1]].y)*canvas.height/2;
      ctx.save();ctx.beginPath();ctx.ellipse(ex,ey+B.h*.033,B.w*.105,B.h*.040,0,0,Math.PI*2);ctx.clip();
      ctx.globalCompositeOperation="screen";ctx.globalAlpha=.055;ctx.filter="blur(3px)";
      ctx.fillStyle="#eee1d7";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore();
    }
  }

  // Restore crisp eyes, brows, glasses, beard and facial edges.
  ctx.save();clipFace(ctx,B,.5,.49,.37,.40);
  ctx.globalCompositeOperation="overlay";ctx.globalAlpha=young?Math.max(.15,Math.min(.19,.165*sizeNorm)):.095;
  ctx.filter=`contrast(${young?"1.24":"1.15"}) saturate(1.02)`;
  ctx.drawImage(fullCopy,0,0);ctx.restore();

  // Restrained jaw definition.
  if(young){
    ctx.save();ctx.globalCompositeOperation="multiply";ctx.globalAlpha=.018;ctx.filter="blur(4px)";
    ctx.beginPath();ctx.arc(B.cx,B.y+B.h*.90,B.w*.30,.12*Math.PI,.88*Math.PI);
    ctx.strokeStyle="#513a31";ctx.lineWidth=Math.max(2,B.w*.016);ctx.stroke();ctx.restore();
  }
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
