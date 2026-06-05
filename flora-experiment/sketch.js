/**
 * Controlled Failure — Flora v4
 * CALM/TENSION/RECOVERY: iridescent procedural flower (full rewrite)
 * FAILURE: flower fades → chaos particle system takes over
 *
 * Interaction logic (face tracking, state machine, pressure/corruption)
 * is preserved from the audited v3.
 */

// ── Constants ─────────────────────────────────────────────
const POLLEN_COUNT  = 220;
const CHAOS_COUNT   = 280;   // extra particles spawned on FAILURE
const HISTORY_MAX   = 150;
const PETAL_COUNT   = 7;
const PETAL_RINGS   = 3;

const STATES = { CALM:'CALM', TENSION:'TENSION', FAILURE:'FAILURE', RECOVERY:'RECOVERY' };

// Colour palettes — per-state, base + shimmer
const PAL = {
  CALM:     { b:[[130,220,255],[170,255,220],[215,175,255],[255,225,190],[155,255,205]],
              s:[[255,255,255],[210,255,255],[245,205,255],[255,245,185],[185,255,245]] },
  TENSION:  { b:[[185,115,255],[75,175,255],[255,115,195],[215,235,255],[145,95,255]],
              s:[[255,195,255],[175,225,255],[255,175,235],[255,255,255],[195,155,255]] },
  FAILURE:  { b:[[255,55,105],[155,55,255],[75,205,255],[255,235,255],[95,255,185]],
              s:[[255,175,195],[215,135,255],[155,235,255],[255,255,255],[175,255,225]] },
  RECOVERY: { b:[[155,250,205],[175,215,255],[195,175,255],[215,230,240],[135,225,195]],
              s:[[215,255,235],[215,235,255],[235,215,255],[255,255,255],[195,250,225]] },
};

// ── State ─────────────────────────────────────────────────
let started=false, video, faceMesh, faces=[];
let pollenParticles=[], chaosParticles=[];
let faceHistory=[];

let flower = {
  center:null, displayedCenter:null, delayedCenter:null,
  memoryCenter:null, drift:null,
  scale:1, displayedScale:1,
  openness:0.35, displayedOpenness:0.35,
  rotation:0, growth:0, deformation:0,
  colors:[], shimmerColors:[],
  visibility:1,   // 1=fully visible, 0=hidden (FAILURE)
};

let currentState = STATES.CALM;
let pressure=0, corruption=0, mouthOpenness=0, faceScale=1;
let faceVel=0, startTime=0, previousFace=null;
let message='等待臉部資料。';
let audioStarted=false, droneOsc, noiseSource, noiseFilter;

// ── Setup ─────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.id('flora-canvas');
  cnv.style('position','fixed'); cnv.style('inset','0');
  cnv.style('z-index','1'); cnv.style('pointer-events','none');
  pixelDensity(window.devicePixelRatio>1 ? 2 : 1);
  colorMode(RGB, 255, 255, 255, 255);
  initFlower(); initPollen(); initChaos();
  background(3,5,10); noLoop();
}

async function startFloraExperiment() {
  if (started) return;
  started=true; startTime=millis();
  message='請允許相機權限。';
  video = createCapture(VIDEO, ()=>{ message='相機已啟動，請面對鏡頭培養花朵。'; });
  video.size(640,480); video.hide();
  const opts={maxFaces:1,refineLandmarks:true,flipHorizontal:true};
  faceMesh=ml5.faceMesh(opts, ()=>{ faceMesh.detectStart(video,r=>{ faces=r||[]; }); });
  startAudio(); loop();
}
window.startFloraExperiment = startFloraExperiment;

// ── Init helpers ──────────────────────────────────────────
function initFlower() {
  const c = createVector(width/2, height*0.48);
  flower.center=c.copy(); flower.displayedCenter=c.copy();
  flower.delayedCenter=c.copy(); flower.memoryCenter=c.copy();
  flower.drift=createVector(0,0);
  flower.scale=1; flower.displayedScale=1;
  flower.openness=0.36; flower.displayedOpenness=0.36;
  flower.rotation=0; flower.growth=0; flower.deformation=0;
  flower.visibility=1;
  refreshColors();
}

function refreshColors() {
  const p=PAL[currentState];
  flower.colors       =p.b.map(rgb=>color(rgb));
  flower.shimmerColors=p.s.map(rgb=>color(rgb));
}

function initPollen() {
  pollenParticles=[];
  for (let i=0;i<POLLEN_COUNT;i++) pollenParticles.push(makePollen(true));
}

function initChaos() {
  chaosParticles=[];
  for (let i=0;i<CHAOS_COUNT;i++) chaosParticles.push(makeChaos());
}

function makePollen(randomize) {
  const a=random(TWO_PI);
  const r=randomize ? random(20,min(width,height)*0.34) : random(16,70);
  const cx=flower.displayedCenter||createVector(width/2,height/2);
  return {
    pos: p5.Vector.add(cx, p5.Vector.fromAngle(a).mult(r)),
    vel: p5.Vector.random2D().mult(random(0.1,0.9)),
    acc: createVector(0,0),
    life:random(0.35,1), size:random(1.5,5.0),
    seed:random(1000), trail:[], memory:0,
    colorIdx: floor(random(5)),
  };
}

function makeChaos() {
  return {
    pos: createVector(random(width), random(height)),
    vel: p5.Vector.random2D().mult(random(1,4)),
    acc: createVector(0,0),
    seed: random(1000),
    size: random(1.5,7),
    trail: [],
    life: random(0.4,1),
    hue: random(360),
  };
}

// ── Main draw ─────────────────────────────────────────────
function draw() {
  if (!started) { background(3,5,10); return; }
  const elapsed=(millis()-startTime)/1000;

  // Background alpha: in FAILURE trails linger longer
  const bgA = currentState===STATES.FAILURE ? 14 : 22;
  background(3,5,10,bgA);

  updateFaceTracking();
  updatePressureSystem();
  updateFlower();
  refreshColors();
  updateFlowerDeformation();
  updatePollen();
  updateChaos();
  updateAudio();

  // Draw order: ambient → pollen → stem → flower → chaos overlay
  drawAmbient();
  drawPollen();
  if (flower.visibility > 0.01) {
    drawStem();
    drawFlower();
  }
  if (currentState===STATES.FAILURE || flower.visibility < 0.99) {
    drawChaos();
  }
  updateHUD(elapsed);
}

// ── Face tracking ─────────────────────────────────────────
function updateFaceTracking() {
  let target=createVector(width/2,height*0.48), detected=false;
  if (faces.length>0) {
    const face=faces[0];
    if (face.keypoints&&face.keypoints.length>454) {
      detected=true;
      target.x=map(face.keypoints[1].x,0,640,0,width);
      target.y=map(face.keypoints[1].y,0,480,0,height);
      const md=dist(face.keypoints[13].x,face.keypoints[13].y,face.keypoints[14].x,face.keypoints[14].y);
      const fw=dist(face.keypoints[234].x,face.keypoints[234].y,face.keypoints[454].x,face.keypoints[454].y);
      mouthOpenness=lerp(mouthOpenness,constrain(md/max(fw*0.16,1),0,2),0.14);
      faceScale=lerp(faceScale,map(fw,60,250,0.62,1.7,true),0.09);
    }
  }
  if (!detected) {
    target.x+=sin(frameCount*0.011)*width*0.055;
    target.y+=cos(frameCount*0.009)*height*0.035;
    mouthOpenness=lerp(mouthOpenness,0.28+sin(frameCount*0.017)*0.08,0.035);
    faceScale=lerp(faceScale,1,0.035);
    message='等待 FaceMesh 偵測；花朵暫時以中心呼吸。';
  } else {
    message=currentState===STATES.CALM?'花朵正在回應你的臉部與表情。':msgForState(currentState);
  }
  if (!previousFace) previousFace=target.copy();
  faceVel=lerp(faceVel,p5.Vector.dist(target,previousFace),0.12);
  previousFace=target.copy();
  flower.center=target;
  faceHistory.push(target.copy());
  if (faceHistory.length>HISTORY_MAX) faceHistory.shift();
}

// ── Pressure / state machine ──────────────────────────────
function updatePressureSystem() {
  const elapsed=(millis()-startTime)/1000;
  const gain=faceVel*0.18+mouthOpenness*0.55+max(0,faceScale-1)*0.4;
  pressure=constrain(pressure+gain-map(faceVel,0,12,0.48,0.12,true),0,100);
  const cg=faceVel*0.000035+pressure*0.000012+(currentState===STATES.FAILURE?0.00045:0.000035);
  corruption=constrain(corruption+cg,0,1);
  if (currentState===STATES.CALM&&pressure<10) corruption=max(0,corruption-0.0003);

  if (elapsed<14) {
    currentState=STATES.CALM;
  } else if (elapsed<42) {
    currentState=pressure>34?STATES.TENSION:STATES.CALM;
  } else {
    if (pressure>70||corruption>0.72) {
      currentState=STATES.FAILURE;
    } else if (currentState===STATES.FAILURE) {
      if (pressure<28) currentState=STATES.RECOVERY;
    } else if (currentState===STATES.RECOVERY) {
      if (pressure>50) currentState=STATES.TENSION;
    } else if (pressure<22&&corruption>0.24) {
      currentState=STATES.RECOVERY;
    } else if (pressure>34) {
      currentState=STATES.TENSION;
    } else {
      currentState=STATES.CALM;
    }
  }
}

// ── Flower physics ────────────────────────────────────────
function updateFlower() {
  const isFailure=currentState===STATES.FAILURE;

  // Flower visibility: fade out on FAILURE, fade in otherwise
  const visTarget=isFailure ? 0 : 1;
  flower.visibility=lerp(flower.visibility, visTarget, 0.025);

  const ctrl = isFailure?0.0 : currentState===STATES.TENSION?0.60 : currentState===STATES.RECOVERY?0.45 : 0.90;
  const delay= currentState===STATES.CALM?0.12 : currentState===STATES.TENSION?0.055 : isFailure?0.014 : 0.040;

  flower.delayedCenter.lerp(flower.center, delay);

  let memT=flower.center.copy();
  if (faceHistory.length>8) {
    const mi=floor(map(corruption,0,1,faceHistory.length-1,0,true));
    memT=faceHistory[max(0,min(mi,faceHistory.length-1))]||flower.center;
  }
  flower.memoryCenter.lerp(memT, 0.035+corruption*0.015);

  const nd=createVector(
    (noise(frameCount*0.005,20)-0.5)*width*0.22,
    (noise(frameCount*0.004,90)-0.5)*height*0.18
  ).mult(corruption);
  flower.drift.lerp(nd,0.035);

  let mixed;
  if (isFailure) {
    mixed=p5.Vector.add(p5.Vector.mult(flower.delayedCenter,0.2),p5.Vector.mult(flower.memoryCenter,0.8)).add(flower.drift);
  } else {
    mixed=p5.Vector.add(p5.Vector.mult(flower.delayedCenter,ctrl),p5.Vector.mult(flower.memoryCenter,1-ctrl)).add(flower.drift);
  }
  flower.displayedCenter.lerp(mixed,isFailure?0.05:0.09);

  flower.openness=constrain(map(mouthOpenness,0,1.6,0.18,1.05,true),0.15,1.15);
  flower.displayedOpenness=lerp(flower.displayedOpenness,flower.openness,isFailure?0.03:0.09);
  flower.scale=faceScale*map(pressure,0,100,0.96,1.22,true);
  flower.displayedScale=lerp(flower.displayedScale,flower.scale,0.08);
  flower.growth=lerp(flower.growth,1,0.018);
  flower.rotation+=0.002+pressure*0.00006+corruption*0.004;
}

function updateFlowerDeformation() {
  const sp=currentState===STATES.FAILURE?1:currentState===STATES.TENSION?0.55:currentState===STATES.RECOVERY?0.32:0.08;
  flower.deformation=lerp(flower.deformation,constrain(corruption*1.25+pressure/100*0.35+sp*0.4,0,1.5),0.07);
}

// ── Pollen physics ────────────────────────────────────────
function updatePollen() {
  const isF=currentState===STATES.FAILURE;
  for (const p of pollenParticles) {
    const toF=p5.Vector.sub(flower.displayedCenter,p.pos);
    const d=max(toF.mag(),1);
    p.acc.add(toF.copy().rotate(HALF_PI).setMag(map(d,0,width,0.08,0.55,true)));
    p.acc.add(toF.copy().setMag(isF?0.012:0.028));
    p.acc.add(p5.Vector.fromAngle(noise(p.seed,frameCount*0.008)*TWO_PI*2).mult(0.08+corruption*0.24));
    if (isF) {
      p.acc.add(p5.Vector.fromAngle(noise(p.seed+400,frameCount*0.013)*TWO_PI).mult(0.55+corruption*0.8));
      p.memory=min(1,p.memory+0.006);
    } else { p.memory=max(0,p.memory-0.004); }
    p.vel.add(p.acc);
    p.vel.limit(isF?3.7:currentState===STATES.TENSION?2.6:1.7);
    p.pos.add(p.vel); p.vel.mult(0.96); p.acc.mult(0);
    p.trail.push(p.pos.copy());
    const mt=isF?28:currentState===STATES.TENSION?16:8;
    if (p.trail.length>mt) p.trail.shift();
    if (p.pos.x<-120||p.pos.x>width+120||p.pos.y<-120||p.pos.y>height+120||random(1)<0.001)
      Object.assign(p,makePollen(false));
  }
}

// ── Chaos particles (FAILURE only) ───────────────────────
function updateChaos() {
  if (currentState!==STATES.FAILURE&&flower.visibility>0.95) return;
  const blend=1-flower.visibility; // 0→1 as flower fades
  for (const p of chaosParticles) {
    // Chaotic flow field
    const n=noise(p.pos.x*0.003,p.pos.y*0.003,frameCount*0.015+p.seed);
    const flowAngle=n*TWO_PI*3 + frameCount*0.008;
    p.acc.add(p5.Vector.fromAngle(flowAngle).mult(0.9+corruption*1.2));
    // Occasional burst away from flower center
    if (random(1)<0.02*blend) {
      const away=p5.Vector.sub(p.pos,flower.displayedCenter).normalize().mult(random(2,8));
      p.acc.add(away);
    }
    p.vel.add(p.acc);
    p.vel.limit(4+corruption*5);
    p.pos.add(p.vel); p.vel.mult(0.93); p.acc.mult(0);
    p.trail.push(p.pos.copy());
    if (p.trail.length>floor(22+corruption*20)) p.trail.shift();
    // Hue slowly drifts
    p.hue=(p.hue+0.4+corruption*1.2)%360;
    // Respawn at random edge if out of bounds
    if (p.pos.x<-150||p.pos.x>width+150||p.pos.y<-150||p.pos.y>height+150) {
      const side=floor(random(4));
      if (side===0) { p.pos.set(random(width),-10); }
      else if (side===1) { p.pos.set(width+10,random(height)); }
      else if (side===2) { p.pos.set(random(width),height+10); }
      else { p.pos.set(-10,random(height)); }
      p.vel=p5.Vector.random2D().mult(random(1,3));
      p.trail=[];
    }
  }
}

// ══════════════════════════════════════════════════════════
// RENDERING
// ══════════════════════════════════════════════════════════

// ── Ambient background glow ───────────────────────────────
function drawAmbient() {
  if (flower.visibility<0.01) return;
  const cx=flower.displayedCenter.x, cy=flower.displayedCenter.y;
  const r=(240+flower.displayedOpenness*130)*flower.displayedScale;
  noStroke();
  for (let i=6;i>0;i--) {
    const c=flower.colors[i%flower.colors.length];
    fill(red(c),green(c),blue(c),(6-i+1)*1.5*flower.visibility);
    ellipse(cx,cy,r*i*0.52,r*i*0.44);
  }
}

// ── Pollen draw ───────────────────────────────────────────
function drawPollen() {
  for (const p of pollenParticles) {
    const col=flower.colors[p.colorIdx%flower.colors.length]||color(170,244,255);
    const shi=flower.shimmerColors[p.colorIdx%flower.shimmerColors.length]||color(255,255,255);
    const isF=currentState===STATES.FAILURE;
    const alphaScale=isF ? 1 : flower.visibility;

    if (p.trail.length>1) {
      noFill(); beginShape();
      for (let i=0;i<p.trail.length;i++) {
        const t=i/p.trail.length;
        const dc=lerpColor(col,shi,t);
        stroke(red(dc),green(dc),blue(dc),t*(isF?75:40)*alphaScale);
        strokeWeight(max(0.3,p.size*t*0.38));
        curveVertex(p.trail[i].x,p.trail[i].y);
      }
      endShape();
    }
    noStroke();
    const sz=p.size*(1+p.memory*0.8);
    fill(red(col),green(col),blue(col),16*alphaScale); ellipse(p.pos.x,p.pos.y,sz*5,sz*5);
    fill(red(col),green(col),blue(col),50*alphaScale); ellipse(p.pos.x,p.pos.y,sz*2.2,sz*2.2);
    const bc=lerpColor(col,shi,0.75);
    fill(red(bc),green(bc),blue(bc),(155+p.life*55)*alphaScale); ellipse(p.pos.x,p.pos.y,sz*0.8,sz*0.8);
  }
}

// ── Chaos particle draw (FAILURE) ─────────────────────────
function drawChaos() {
  const blend=1-flower.visibility;
  if (blend<0.01) return;
  colorMode(HSB,360,100,100,255);
  for (const p of chaosParticles) {
    if (p.trail.length>1) {
      noFill(); beginShape();
      for (let i=0;i<p.trail.length;i++) {
        const t=i/p.trail.length;
        const sat=map(corruption,0,1,40,90);
        const bri=map(t,0,1,30,95);
        stroke(p.hue,sat,bri,t*blend*90);
        strokeWeight(max(0.2,p.size*t*0.45));
        curveVertex(p.trail[i].x,p.trail[i].y);
      }
      endShape();
    }
    noStroke();
    const sz=p.size;
    const sat=map(corruption,0,1,50,100);
    fill(p.hue,sat,90,blend*20); ellipse(p.pos.x,p.pos.y,sz*5.5,sz*5.5);
    fill(p.hue,sat,100,blend*120); ellipse(p.pos.x,p.pos.y,sz*0.9,sz*0.9);
    // Occasional bright flash
    if (random(1)<0.006*corruption) {
      fill(p.hue,20,100,blend*180); ellipse(p.pos.x,p.pos.y,sz*0.3,sz*0.3);
    }
  }
  colorMode(RGB,255,255,255,255);
}

// ── Stem ──────────────────────────────────────────────────
function drawStem() {
  const vis=flower.visibility;
  if (vis<0.01) return;
  const base=createVector(width/2,height+80);
  const top=flower.displayedCenter.copy();
  const sway=sin(frameCount*0.018)*20+flower.drift.x*0.1;
  const c1=createVector(lerp(base.x,top.x,0.28)+sway, lerp(base.y,top.y,0.28));
  const c2=createVector(lerp(base.x,top.x,0.72)-sway*0.55, lerp(base.y,top.y,0.72));

  noFill();
  for (let i=0;i<7;i++) {
    const c=flower.colors[(i+2)%flower.colors.length];
    stroke(red(c),green(c),blue(c),(20-i*2.5)*vis);
    strokeWeight(18-i*2.2);
    bezier(base.x,base.y,c1.x,c1.y,c2.x,c2.y,top.x,top.y+20);
  }
  // Highlight vein
  stroke(220,255,245,60*vis); strokeWeight(0.9);
  bezier(base.x,base.y,c1.x,c1.y,c2.x,c2.y,top.x,top.y+20);

  // Two leaves
  _leaf(c1,sway,1,vis);
  _leaf(createVector(lerp(base.x,top.x,0.5)-sway*0.3,lerp(base.y,top.y,0.5)),-sway,-1,vis);
}

function _leaf(pt,sway,side,vis) {
  const lc=flower.colors[2]||color(160,255,200);
  noFill();
  for (let i=0;i<4;i++) {
    stroke(red(lc),green(lc),blue(lc),(32-i*7)*vis);
    strokeWeight(5-i*0.8);
    const ex=pt.x+side*50+sway*0.3, ey=pt.y-35;
    bezier(pt.x,pt.y,pt.x+side*25,pt.y-20,ex-side*12,ey+10,ex,ey);
  }
  stroke(255,255,255,16*vis); strokeWeight(0.5); noFill();
  const ex=pt.x+side*50+sway*0.3, ey=pt.y-35;
  bezier(pt.x,pt.y,pt.x+side*25,pt.y-20,ex-side*12,ey+10,ex,ey);
}

// ── Flower ────────────────────────────────────────────────
function drawFlower() {
  const vis=flower.visibility;
  if (vis<0.01) return;
  push();
  translate(flower.displayedCenter.x,flower.displayedCenter.y);
  rotate(flower.rotation);
  scale(flower.displayedScale*flower.growth);
  _deepGlow(vis);
  _petalRings(vis);
  _calyx(vis);
  _stamen(vis);
  _flowerCore(vis);
  pop();
}

function _deepGlow(vis) {
  noStroke();
  const open=flower.displayedOpenness;
  for (let i=8;i>0;i--) {
    const c=flower.colors[i%flower.colors.length];
    const sc=flower.shimmerColors[i%flower.shimmerColors.length];
    const mc=lerpColor(c,sc,(sin(frameCount*0.014+i)*0.5+0.5));
    fill(red(mc),green(mc),blue(mc),(9-i)*1.2*vis);
    ellipse(0,0,(210+open*110+i*58)*1.1,(165+open*85+i*48));
  }
}

function _petalRings(vis) {
  const open=flower.displayedOpenness, deform=flower.deformation;
  // Draw back rings first, front last
  for (let ring=PETAL_RINGS-1;ring>=0;ring--) {
    const rs=map(ring,0,PETAL_RINGS-1,1.0,0.58);
    const countForRing=PETAL_COUNT+ring*2; // more petals in outer rings
    for (let i=0;i<countForRing;i++) {
      const baseAngle=(TWO_PI/countForRing)*i + ring*0.18 + flower.rotation*0.04;
      const n=noise(i*0.18+ring*5, ring*8, frameCount*0.009);
      const bend=map(n,0,1,-0.5,0.5)*deform;
      const len=(100+open*85+n*28)*rs;
      const wid=(30+open*42+n*14)*rs;

      const ci=(i+ring)%flower.colors.length;
      const col=flower.colors[ci];
      const shi=flower.shimmerColors[(ci+2)%flower.shimmerColors.length];
      const cont=currentState===STATES.FAILURE?corruption:corruption*0.3;
      const blended=lerpColor(col,color(255,64,118),cont*0.35);

      push();
      rotate(baseAngle+bend);
      translate(0,-12*rs);
      _petal(len,wid,blended,shi,i,ring,deform,vis);
      pop();
    }
  }
}

function _petal(len,wid,col,shi,idx,ring,deform,vis) {
  // Per-frame shimmer: each petal shimmers independently
  const shimAmt=(sin(frameCount*0.016+idx*0.65+ring*1.2)*0.5+0.5);
  const drawCol=lerpColor(col,shi,shimAmt*0.6);
  const ja=(noise(idx,    frameCount*0.010)-0.5)*deform*22;
  const jb=(noise(idx+55, frameCount*0.009)-0.5)*deform*28;
  const jc=(noise(idx+110,frameCount*0.008)-0.5)*deform*16;

  // Iridescent hue shift at petal edges
  push(); colorMode(HSB,360,100,100,255);
  const hb=hue(color(red(drawCol),green(drawCol),blue(drawCol)));
  const edgeH=(hb+map(sin(frameCount*0.02+idx),-1,1,-35,35)+360)%360;
  const edgeCol=color(edgeH,80,95,40*vis);
  pop();

  noStroke();

  // Layer A — widest, most translucent (back-scatter light)
  const aA=ring===0?55:ring===1?40:28;
  fill(red(drawCol),green(drawCol),blue(drawCol),aA*vis);
  _pbez(len*1.06,wid*1.18,ja*0.6,jb*0.6);

  // Layer B — mid body
  fill(red(drawCol),green(drawCol),blue(drawCol),(ring===0?42:28)*vis);
  _pbez(len*0.94,wid*0.88,ja,jb);

  // Layer C — inner bright band (like the illuminated midline of a real petal)
  const ic=lerpColor(shi,color(255,255,255),0.35);
  fill(red(ic),green(ic),blue(ic),(ring===0?26:16)*vis);
  _pbez(len*0.75,wid*0.3,ja*0.35,jb*0.25);

  // Veins
  _veins(len,wid,drawCol,shi,idx,ring,ja,jb,jc,vis);

  // Iridescent edge outline — colour cycles along the rim
  noFill();
  stroke(red(edgeCol),green(edgeCol),blue(edgeCol),(ring===0?32:18)*vis);
  strokeWeight(0.55);
  _pbezStroke(len*1.08,wid*1.20,ja*0.55,jb*0.55);

  // Translucent diffuse edge glow (wider soft stroke)
  stroke(red(shi),green(shi),blue(shi),(ring===0?14:8)*vis);
  strokeWeight(4);
  _pbezStroke(len*1.10,wid*1.22,ja*0.5,jb*0.5);
}

function _pbez(len,wid,ja,jb) {
  beginShape();
  vertex(0,0);
  bezierVertex( wid+ja, -len*0.28,  wid*0.8+jb, -len*0.76, 0,-len);
  bezierVertex(-wid*0.8+ja,-len*0.76,-wid+jb,   -len*0.28, 0,0);
  endShape(CLOSE);
}
function _pbezStroke(len,wid,ja,jb) {
  beginShape();
  vertex(0,0);
  bezierVertex( wid+ja, -len*0.28,  wid*0.8+jb, -len*0.76, 0,-len);
  bezierVertex(-wid*0.8+ja,-len*0.76,-wid+jb,   -len*0.28, 0,0);
  endShape(CLOSE);
}

function _veins(len,wid,col,shi,idx,ring,ja,jb,jc,vis) {
  const vc=lerpColor(shi,color(255,255,255),0.55);
  const va=(ring===0?42:24)*vis;
  noFill();

  // Midrib with slight curvature
  stroke(red(vc),green(vc),blue(vc),va);
  strokeWeight(0.75);
  bezier(0,-2, jc*0.12,-len*0.32, jc*0.07,-len*0.66, 0,-len*0.97);

  // Lateral veins — 4 pairs, fanning out
  for (let v=1;v<=4;v++) {
    const t=v/5;
    const ox=wid*t*0.72+ja*t*0.5;
    const oy=-len*t*0.52;
    stroke(red(vc),green(vc),blue(vc),va*(1-t*0.55));
    strokeWeight(0.3);
    bezier(jc*0.05,-len*0.1*v, ox*0.5,oy*0.65, ox*0.85,oy*0.92, ox,oy);
    bezier(jc*0.05,-len*0.1*v,-ox*0.5,oy*0.65,-ox*0.85,oy*0.92,-ox,oy);
  }

  // Specular highlight near petal tip
  noStroke();
  fill(red(vc)+15,green(vc)+15,blue(vc)+15,va*0.55);
  ellipse(jc*0.06,-len*0.83, wid*0.17,len*0.07);

  // Fine reticulate cross-veins (probabilistic, only front ring)
  if (ring===0&&random(1)<0.035) {
    stroke(red(vc),green(vc),blue(vc),10*vis); strokeWeight(0.18);
    line(random(-wid*0.5,wid*0.5),random(-len*0.62,-len*0.18),
         random(-wid*0.45,wid*0.45),random(-len*0.60,-len*0.16));
  }
}

function _calyx(vis) {
  const gc=color(70,195,135);
  for (let i=0;i<5;i++) {
    const a=(TWO_PI/5)*i+PI*0.1;
    push(); rotate(a); noStroke();
    fill(red(gc),green(gc),blue(gc),58*vis);
    beginShape(); vertex(0,0);
    bezierVertex(14,-20,9,-40,0,-47);
    bezierVertex(-9,-40,-14,-20,0,0);
    endShape(CLOSE);
    stroke(150,255,185,28*vis); strokeWeight(0.5); noFill();
    line(0,-3,0,-43);
    pop();
  }
}

function _stamen(vis) {
  const cnt=22, open=flower.displayedOpenness;
  for (let i=0;i<cnt;i++) {
    const a=(TWO_PI/cnt)*i+frameCount*0.003;
    const len=16+open*26+noise(i*0.7,frameCount*0.01)*14;
    const c=flower.shimmerColors[i%flower.shimmerColors.length];
    push(); rotate(a);
    stroke(red(c),green(c),blue(c),65*vis); strokeWeight(0.75); noFill();
    line(0,0,0,-len);
    noStroke(); fill(red(c),green(c),blue(c),150*vis);
    ellipse(0,-len,2.8+open*1.8,2.8+open*1.8);
    // Anther glow
    fill(red(c),green(c),blue(c),40*vis);
    ellipse(0,-len,7+open*3,7+open*3);
    pop();
  }
}

function _flowerCore(vis) {
  const open=flower.displayedOpenness;
  const c0=flower.colors[1]||color(245,255,255);
  const c1=flower.shimmerColors[0]||color(255,255,255);
  noStroke();

  // Concentric glow rings (7 layers)
  for (let i=7;i>0;i--) {
    const mc=lerpColor(c0,c1,(sin(frameCount*0.022+i)*0.5+0.5));
    fill(red(mc),green(mc),blue(mc),(16-i*1.8)*vis);
    ellipse(0,0,65+open*28+i*18,65+open*28+i*18);
  }
  // Core disc with subtle gradient feel (3 layers)
  fill(red(c0),green(c0),blue(c0),210*vis);
  ellipse(0,0,26+open*14,26+open*14);
  fill(red(c1),green(c1),blue(c1),130*vis);
  ellipse(0,0,18+open*9,18+open*9);
  // Specular highlights
  fill(255,255,255,180*vis); ellipse(-5,-6,9,9);
  fill(255,255,255,70*vis);  ellipse(5,5,5,5);
  // Tiny pollen dots in centre
  for (let d=0;d<8;d++) {
    const da=(TWO_PI/8)*d+flower.rotation*2;
    const dr=10+open*5;
    fill(red(c1),green(c1),blue(c1),90*vis);
    ellipse(cos(da)*dr,sin(da)*dr,2.5,2.5);
  }
}

// ── HUD ───────────────────────────────────────────────────
function updateHUD(e) {
  if (typeof updateFloraUI==='function')
    updateFloraUI(currentState,pressure.toFixed(1),corruption,e,message);
}
function msgForState(s) {
  if (s===STATES.TENSION)  return '花瓣開始延遲，生長方向出現偏移。';
  if (s===STATES.FAILURE)  return '花已失控，粒子逃逸中。';
  if (s===STATES.RECOVERY) return '系統慢慢穩定，但仍保留污染痕跡。';
  return '花朵正在穩定生長。';
}

// ── Audio ─────────────────────────────────────────────────
function startAudio() {
  if (audioStarted) return; audioStarted=true;
  try {
    userStartAudio();
    droneOsc=new p5.Oscillator('sine'); droneOsc.freq(82); droneOsc.amp(0,0); droneOsc.start();
    noiseSource=new p5.Noise('pink'); noiseSource.amp(0,0); noiseSource.start();
    noiseFilter=new p5.LowPass(); noiseSource.disconnect(); noiseSource.connect(noiseFilter);
  } catch(e) { console.warn('Audio setup failed:',e); }
}
function updateAudio() {
  if (!audioStarted||!droneOsc||!noiseSource) return;
  const base=82+(currentState===STATES.FAILURE?-10:currentState===STATES.TENSION?14:0);
  droneOsc.freq(base+pressure*0.45+sin(frameCount*0.02)*corruption*18,0.18);
  droneOsc.amp(currentState===STATES.CALM?0.035:currentState===STATES.TENSION?0.052:0.04,0.35);
  noiseSource.amp(currentState===STATES.FAILURE?0.035:currentState===STATES.TENSION?0.012:0.003,0.4);
  if (noiseFilter) noiseFilter.freq(map(pressure,0,100,600,2400));
}

function windowResized() { resizeCanvas(windowWidth,windowHeight); initFlower(); }
