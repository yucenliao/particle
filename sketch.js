/**
 * Controlled Failure: 失效的控制
 * p5 + ml5 face tracking particle runtime.
 */

const PARTICLE_COUNT = 900;
const BG_FIELD_COUNT = 320;

const STATES = {
  CALM: { name: 'CALM' },
  TENSION: {
    name: 'TENSION',
    colors: [
      [200, 100, 255],
      [255, 150, 200],
      [100, 120, 255],
      [255, 180, 150],
    ],
  },
  FAILURE: {
    name: 'FAILURE',
    colors: [
      [255, 50, 80],
      [0, 180, 255],
      [255, 255, 255],
      [255, 100, 50],
    ],
  },
  RECOVERY: {
    name: 'RECOVERY',
    colors: [
      [140, 140, 180],
      [180, 160, 220],
      [120, 130, 150],
    ],
  },
};

const CALM_PALETTES = [
  [
    [255, 160, 100],
    [255, 210, 130],
    [255, 240, 200],
    [255, 180, 160],
  ],
  [
    [255, 140, 160],
    [240, 170, 200],
    [210, 160, 230],
    [255, 230, 210],
  ],
  [
    [255, 120, 60],
    [255, 180, 80],
    [255, 210, 150],
    [255, 245, 220],
  ],
];
const POLLUTION_COLORS = [
  [180, 60, 80],
  [200, 80, 40],
  [150, 50, 120],
];

let currentState = STATES.CALM;
let controlPressure = 0;
let corruptionLevel = 0;
let startTime = 0;
let sessionTime = 0;
let currentCalmColors = [];
let paletteIndex = 0;
let nextPaletteIndex = 1;
let paletteTimer = 0;
let colorPhase = 0;

let mainParticles = [];
let bgParticles = [];
let video;
let faceMesh;
let faces = [];
let faceCenter = { x: 0, y: 0 };
let smoothedFace = { x: 0, y: 0 };
let prevFacePos = { x: 0, y: 0 };
let faceVel = 0;
let mouthOpenness = 0;
let faceScale = 1;
let faceHistory = [];
const HISTORY_MAX = 120;

let interactionStarted = false;
let cameraReady = false;
let cameraFailed = false;

function setRuntimeMessage(message, isError = false) {
  const el = document.getElementById('context-msg');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('runtime-error', isError);
  el.style.opacity = '1';
}

function setup() {
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.id('particle-canvas');
  cnv.style('position', 'fixed');
  cnv.style('inset', '0');
  cnv.style('z-index', '1');
  cnv.style('pointer-events', 'none');
  pixelDensity(window.devicePixelRatio > 1 ? 2 : 1);

  faceCenter.x = smoothedFace.x = width / 2;
  faceCenter.y = smoothedFace.y = height / 2;
  prevFacePos = { x: faceCenter.x, y: faceCenter.y };
  background(2, 2, 8);
  noLoop();
}

async function requestCameraPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  stream.getTracks().forEach(track => track.stop());
}

async function startCameraTracking() {
  try {
    await requestCameraPermission();

    video = createCapture(VIDEO, () => {
      cameraReady = true;
      setRuntimeMessage('相機已啟動，粒子正在跟隨臉部。');
    });
    video.size(640, 480);
    video.hide();

    if (typeof ml5 === 'undefined' || typeof ml5.faceMesh !== 'function') {
      cameraFailed = true;
      setRuntimeMessage('ml5 尚未載入；粒子先以畫面中心運作。', true);
      return;
    }

    const options = { maxFaces: 1, refineLandmarks: true, flipHorizontal: true };
    faceMesh = ml5.faceMesh(options, () => {
      faceMesh.detectStart(video, results => {
        faces = results || [];
      });
    });
  } catch (error) {
    cameraFailed = true;
    console.warn('Camera setup failed:', error);
    setRuntimeMessage('相機未開啟；粒子先以畫面中心運作。', true);
  }
}

function initializeInteraction() {
  if (interactionStarted) return;

  interactionStarted = true;
  controlPressure = 0;
  corruptionLevel = 0;
  sessionTime = 0;
  colorPhase = 0;
  paletteIndex = 0;
  nextPaletteIndex = 1;
  paletteTimer = 0;
  faces = [];
  faceHistory = [];
  mainParticles = [];
  bgParticles = [];
  currentCalmColors = [];

  faceCenter.x = smoothedFace.x = width / 2;
  faceCenter.y = smoothedFace.y = height / 2;
  prevFacePos = { x: faceCenter.x, y: faceCenter.y };

  for (let i = 0; i < PARTICLE_COUNT; i++) mainParticles.push(new Particle(true));
  for (let i = 0; i < BG_FIELD_COUNT; i++) bgParticles.push(new Particle(false));
  for (let i = 0; i < 4; i++) currentCalmColors.push(color(CALM_PALETTES[0][i]));

  startTime = millis();
  background(2, 2, 8);
  setRuntimeMessage('粒子系統啟動中。');
  loop();
  startCameraTracking();
}

window.startParticleInteraction = async function startParticleInteraction() {
  if (typeof createCanvas !== 'function') {
    throw new Error('p5.js 尚未載入，無法啟動原始粒子系統。');
  }
  initializeInteraction();
};

function draw() {
  if (!interactionStarted) {
    background(2, 2, 8);
    return;
  }

  const bgAlpha = map(controlPressure, 0, 100, 24, 7, true);
  background(2, 2, 8, bgAlpha);

  updateFaceData();
  updateSystemState();
  updateCalmPalette();

  const phaseSpeed = map(controlPressure, 0, 100, 0.006, 0.05, true);
  colorPhase += phaseSpeed;

  for (const p of bgParticles) {
    p.updateAsBG();
    p.show();
  }

  push();
  if (currentState === STATES.FAILURE) {
    const shake = max(0, controlPressure - 65) * 0.16;
    translate(random(-shake, shake), random(-shake, shake));
  }
  for (const p of mainParticles) {
    p.behaviors();
    p.update();
    p.show();
  }
  pop();

  const phase = sessionTime < 15 ? 1 : sessionTime < 45 ? 2 : 3;
  if (typeof updateUI === 'function') {
    updateUI(currentState.name, controlPressure.toFixed(1), corruptionLevel, sessionTime, phase);
  }
}

function updateFaceData() {
  if (faces && faces.length > 0) {
    const face = faces[0];
    if (face.keypoints && face.keypoints.length > 454) {
      faceCenter.x = map(face.keypoints[1].x, 0, 640, 0, width);
      faceCenter.y = map(face.keypoints[1].y, 0, 480, 0, height);

      const dMouth = dist(
        face.keypoints[13].x,
        face.keypoints[13].y,
        face.keypoints[14].x,
        face.keypoints[14].y
      );
      const faceWidth = dist(
        face.keypoints[234].x,
        face.keypoints[234].y,
        face.keypoints[454].x,
        face.keypoints[454].y
      );
      const normMouth = dMouth / max(faceWidth * 0.15, 1);
      mouthOpenness = lerp(mouthOpenness, constrain(normMouth, 0, 2), 0.1);
      faceScale = lerp(faceScale, map(faceWidth, 60, 240, 0.5, 2.5, true), 0.1);
    }
  } else {
    const driftX = sin(frameCount * 0.011) * width * 0.08;
    const driftY = cos(frameCount * 0.009) * height * 0.06;
    faceCenter.x = width / 2 + driftX;
    faceCenter.y = height / 2 + driftY;
    mouthOpenness = lerp(mouthOpenness, map(sin(frameCount * 0.018), -1, 1, 0.1, 0.8), 0.03);
    faceScale = lerp(faceScale, 1.0, 0.03);
  }

  sessionTime = (millis() - startTime) / 1000;
  const dv = dist(faceCenter.x, faceCenter.y, prevFacePos.x, prevFacePos.y);
  faceVel = lerp(faceVel, dv, 0.1);
  prevFacePos = { x: faceCenter.x, y: faceCenter.y };

  const corruptionGrowth = faceVel * 0.000015 + (currentState === STATES.FAILURE ? 0.0004 : 0.00002);
  corruptionLevel = constrain(corruptionLevel + corruptionGrowth, 0, 1);
  if (faceVel < 5 && currentState === STATES.CALM) {
    corruptionLevel = max(0, corruptionLevel - 0.000005);
  }

  const baseSmooth = map(sessionTime, 0, 45, 0.22, 0.12, true);
  const smooth = baseSmooth * map(controlPressure, 0, 100, 1.0, 0.08, true) * (1.0 - corruptionLevel * 0.6);
  smoothedFace.x = lerp(smoothedFace.x, faceCenter.x, constrain(smooth, 0.004, 1));
  smoothedFace.y = lerp(smoothedFace.y, faceCenter.y, constrain(smooth, 0.004, 1));

  faceHistory.push({ x: smoothedFace.x, y: smoothedFace.y });
  if (faceHistory.length > HISTORY_MAX) faceHistory.shift();

  const gain = faceVel * 0.2 + mouthOpenness * 10.0 + map(faceScale, 1, 2.5, 0, 5, true);
  controlPressure += gain * 0.04;
  let decaySpeed = map(faceVel, 0, 10, 0.8, 0.1, true);
  if (currentState === STATES.RECOVERY) decaySpeed = 1.2;
  controlPressure = constrain(controlPressure - decaySpeed, 0, 100);
}

function updateCalmPalette() {
  paletteTimer += deltaTime;
  if (paletteTimer >= 7000) {
    paletteTimer = 0;
    paletteIndex = nextPaletteIndex;
    nextPaletteIndex = (paletteIndex + 1) % CALM_PALETTES.length;
  }
  const amt = constrain(paletteTimer / 4000, 0, 1);
  for (let i = 0; i < 4; i++) {
    currentCalmColors[i] = lerpColor(color(CALM_PALETTES[paletteIndex][i]), color(CALM_PALETTES[nextPaletteIndex][i]), amt);
  }
}

function updateSystemState() {
  if (sessionTime < 15) {
    currentState = STATES.CALM;
    return;
  }
  if (sessionTime < 45) {
    currentState = controlPressure < 35 ? STATES.CALM : STATES.TENSION;
    return;
  }
  if (controlPressure < 25) {
    if (currentState === STATES.FAILURE) currentState = STATES.RECOVERY;
    else if (controlPressure < 15) currentState = STATES.CALM;
  } else if (controlPressure < 70) {
    currentState = STATES.TENSION;
  } else {
    currentState = STATES.FAILURE;
  }
}

class Particle {
  constructor(isMain) {
    this.isMain = isMain;
    this.pos = createVector(random(width), random(height));
    this.vel = p5.Vector.random2D();
    this.acc = createVector(0, 0);
    this.noiseOff = random(1000);
    this.tier = random(1);
    this.baseSize = this.tier < 0.6 ? random(1.2, 2.5) : this.tier < 0.9 ? random(2.5, 5.0) : random(6.0, 11.0);
    this.maxSpeed = isMain ? random(3, 8) : random(0.5, 1.5);
    this.trail = [];
    this.trailMax = isMain ? floor(random(6, 18)) : 0;
    this.ghostPhase = random(TWO_PI);
    this.ghostDist = random(8, 28);
    this.pulseOff = random(TWO_PI);
    this.hasSatellite = isMain && this.tier > 0.88 && random(1) < 0.6;
    this.satAngle = random(TWO_PI);
    this.satRadius = this.baseSize * random(2.2, 4.5);
    this.satSpeed = random(0.04, 0.11) * (random(1) < 0.5 ? 1 : -1);
  }

  updateAsBG() {
    const n = noise(this.pos.x * 0.003, this.pos.y * 0.003, frameCount * 0.002);
    this.pos.add(p5.Vector.fromAngle(n * TWO_PI).mult(0.6));
    this.wrap();
  }

  behaviors() {
    const currentTarget = createVector(smoothedFace.x, smoothedFace.y);
    const historyIndex = floor(map(corruptionLevel, 0, 1, 0, HISTORY_MAX - 1));
    const pastTargetPos =
      faceHistory.length > 0 ? faceHistory[HISTORY_MAX - 1 - historyIndex] || faceHistory[0] : { x: smoothedFace.x, y: smoothedFace.y };
    const pastTarget = createVector(pastTargetPos.x, pastTargetPos.y);

    const n = noise(this.pos.x * 0.002, this.pos.y * 0.002, frameCount * 0.01 + this.noiseOff);
    const flowDir = p5.Vector.fromAngle(map(n, 0, 1, 0, TWO_PI * 4)).mult(200);
    const flowTarget = p5.Vector.add(this.pos, flowDir);

    let controlWeight = map(corruptionLevel, 0, 1, 1, 0.4, true);
    if (currentState === STATES.FAILURE) controlWeight *= 0.7;

    let finalTarget = p5.Vector.lerp(currentTarget, pastTarget, corruptionLevel * 0.6);
    finalTarget = p5.Vector.lerp(finalTarget, flowTarget, map(corruptionLevel, 0.3, 1.0, 0, 0.5, true));

    if (currentState === STATES.CALM) {
      const t = frameCount * 0.015 + this.noiseOff;
      const breathingSize = map(sin(frameCount * 0.008), -1, 1, 130, 380) * faceScale;
      const orbitPos = createVector(
        finalTarget.x + cos(t) * breathingSize * noise(this.noiseOff),
        finalTarget.y + sin(t) * breathingSize * noise(this.noiseOff + 100)
      );
      this.acc.add(p5.Vector.sub(orbitPos, this.pos).mult(0.025 * (1 - corruptionLevel * 0.4)));
    } else if (currentState === STATES.TENSION) {
      const force = p5.Vector.sub(finalTarget, this.pos);
      const spiral = force.copy().rotate(HALF_PI + 0.05).setMag(2.5);
      this.acc.add(spiral);
      this.acc.add(force.mult(0.015 * controlWeight));
      this.acc.add(p5.Vector.fromAngle(noise(this.pos.x * 0.005, this.pos.y * 0.005, frameCount * 0.01) * TWO_PI).mult(0.5));
    } else if (currentState === STATES.FAILURE) {
      const dOff = map(controlPressure, 70, 100, 0, 300) * corruptionLevel;
      const displacedTarget = p5.Vector.add(finalTarget, createVector(sin(frameCount * 0.04) * dOff, cos(frameCount * 0.03) * dOff));
      this.acc.add(p5.Vector.fromAngle(map(n, 0, 1, 0, TWO_PI * 4)).mult(2.5));
      this.acc.add(p5.Vector.sub(displacedTarget, this.pos).mult(0.005 * controlWeight));
    } else {
      this.acc.add(p5.Vector.sub(currentTarget, this.pos).mult(0.006));
      this.vel.mult(0.94);
    }
  }

  update() {
    this.vel.add(this.acc);
    this.vel.limit(this.maxSpeed * (1 + controlPressure / 30));
    this.pos.add(this.vel);
    this.acc.mult(0);
    this.vel.mult(0.96);
    if (this.trailMax > 0) {
      this.trail.push(this.pos.copy());
      if (this.trail.length > this.trailMax) this.trail.shift();
    }
    if (this.hasSatellite) this.satAngle += this.satSpeed;
    this.wrap();
  }

  wrap() {
    if (this.pos.x < -50) this.pos.x = width + 50;
    if (this.pos.x > width + 50) this.pos.x = -50;
    if (this.pos.y < -50) this.pos.y = height + 50;
    if (this.pos.y > height + 50) this.pos.y = -50;
  }

  getColor() {
    let c;
    if (currentState === STATES.CALM || currentState === STATES.RECOVERY) {
      const nIdx = floor(noise(this.noiseOff) * 3.99);
      c = color(currentCalmColors[nIdx] || currentCalmColors[0]);
    } else {
      const palette = currentState.colors;
      const nv = noise(this.noiseOff, colorPhase * 0.6);
      const cIdx = floor(nv * palette.length);
      c = lerpColor(color(palette[cIdx]), color(palette[(cIdx + 1) % palette.length]), nv % 1);
    }
    if (random(1) < corruptionLevel * 0.3) {
      const pollute = color(POLLUTION_COLORS[floor(noise(this.noiseOff, frameCount * 0.001) * 2.99)] || POLLUTION_COLORS[0]);
      c = lerpColor(c, pollute, 0.4);
    }
    if (currentState === STATES.FAILURE || currentState === STATES.TENSION) {
      push();
      colorMode(HSB, 360, 100, 100, 100);
      const h = (hue(c) + sin(colorPhase) * map(controlPressure, 30, 100, 0, 80) + 360) % 360;
      c = color(h, saturation(c), brightness(c) + map(controlPressure, 50, 100, 0, 30, true), 85);
      pop();
    }
    return c;
  }

  drawGlow(x, y, sz, c, alphScale) {
    noStroke();
    const layers = [
      { mult: 4.2, a: 4 * alphScale },
      { mult: 2.4, a: 14 * alphScale },
      { mult: 1.2, a: 48 * alphScale },
      { mult: 0.5, a: 190 * alphScale },
    ];
    for (const l of layers) {
      fill(red(c), green(c), blue(c), l.a);
      ellipse(x, y, sz * l.mult, sz * l.mult);
    }
  }

  drawStar(x, y, sz, c, alph) {
    const len = sz * 3.5;
    stroke(red(c), green(c), blue(c), alph * 0.6);
    strokeWeight(0.5);
    for (let r = 0; r < 4; r++) {
      const ang = (r / 4) * PI + frameCount * 0.003 + this.pulseOff;
      line(x, y, x + cos(ang) * len, y + sin(ang) * len);
      line(x, y, x - cos(ang) * len * 0.6, y - sin(ang) * len * 0.6);
    }
  }

  showCalm(c) {
    const pulse = map(sin(frameCount * 0.018 + this.pulseOff), -1, 1, 0.65, 1.0);
    const sz = this.baseSize * faceScale * pulse * map(controlPressure, 0, 100, 1.0, 2.2);
    const alph = map(sin(frameCount * 0.02 + this.noiseOff), -1, 1, 0.5, 1.0);

    noStroke();
    fill(red(c) + 30, green(c) * 0.7, blue(c) * 0.4, 6 * alph);
    ellipse(this.pos.x, this.pos.y, sz * 5.8, sz * 5.8);
    this.drawGlow(this.pos.x, this.pos.y, sz, c, alph * 0.95);

    if (this.tier > 0.55) this.drawStar(this.pos.x, this.pos.y, sz, c, alph * 100);

    if (this.hasSatellite) {
      const sx = this.pos.x + cos(this.satAngle) * this.satRadius;
      const sy = this.pos.y + sin(this.satAngle) * this.satRadius * 0.55;
      this.drawGlow(sx, sy, sz * 0.3, c, alph * 0.6);
    }
  }

  showTension(c) {
    const speed = this.vel.mag();
    const sz = this.baseSize * faceScale * map(controlPressure, 35, 100, 1.0, 2.8);

    if (this.trail.length > 2) {
      noFill();
      beginShape();
      for (let i = 0; i < this.trail.length; i++) {
        const t = i / this.trail.length;
        stroke(red(c), green(c), blue(c), t * t * 110);
        strokeWeight(max(sz * 0.45 * t * t, 0.3));
        curveVertex(this.trail[i].x, this.trail[i].y);
      }
      endShape();
    }

    const angle = this.vel.heading();
    const stretch = map(speed, 0, 12, 1.0, 3.8);
    push();
    translate(this.pos.x, this.pos.y);
    rotate(angle);
    this.drawGlow(0, 0, sz * 0.78, c, 0.72);
    noStroke();
    fill(red(c), green(c), blue(c), 155);
    ellipse(0, 0, sz * stretch * 0.75, sz * 0.5);
    pop();
  }

  showFailure(c) {
    const sz = this.baseSize * faceScale * map(controlPressure, 70, 100, 1.5, 4.2, true);

    if (this.tier > 0.6) {
      const gx = this.pos.x + cos(frameCount * 0.04 + this.ghostPhase) * this.ghostDist * corruptionLevel;
      const gy = this.pos.y + sin(frameCount * 0.03 + this.ghostPhase) * this.ghostDist * corruptionLevel;
      push();
      colorMode(HSB, 360, 100, 100, 100);
      const ghostC = color((hue(c) + 180) % 360, 55, 75, 18);
      pop();
      this.drawGlow(gx, gy, sz * 0.75, ghostC, 0.12);
    }

    if (this.trail.length > 2) {
      const start = floor(this.trail.length * 0.5);
      for (let i = start; i < this.trail.length; i++) {
        const t = (i - start) / max(this.trail.length - start, 1);
        const jitter = (1 - t) * corruptionLevel * 5;
        stroke(red(c), green(c), blue(c), t * t * 52);
        strokeWeight(sz * t * 0.35);
        point(this.trail[i].x + random(-jitter, jitter), this.trail[i].y + random(-jitter, jitter));
      }
    }

    if (this.tier > 0.5 && random(1) < 0.35) {
      const numBars = floor(random(2, 5));
      for (let b = 0; b < numBars; b++) {
        const ang = random(TWO_PI);
        const r1 = sz * random(0.8, 2.0);
        const r2 = r1 + sz * random(1.0, 3.5);
        stroke(red(c), green(c), blue(c), random(40, 110) * corruptionLevel);
        strokeWeight(random(0.5, 1.8));
        line(this.pos.x + cos(ang) * r1, this.pos.y + sin(ang) * r1, this.pos.x + cos(ang) * r2, this.pos.y + sin(ang) * r2);
      }
    }

    this.drawGlow(this.pos.x, this.pos.y, sz * 0.78, c, 0.75);
  }

  showRecovery(c) {
    const sz = this.baseSize * faceScale * 0.8;
    const pulse = map(sin(frameCount * 0.012 + this.pulseOff), -1, 1, 0.4, 0.85);
    if (this.trail.length > 2) {
      for (let i = 1; i < this.trail.length; i++) {
        const t = i / this.trail.length;
        stroke(lerp(red(c), 160, 1 - t * 0.5), lerp(green(c), 150, 1 - t * 0.5), lerp(blue(c), 170, 1 - t * 0.5), t * 35);
        strokeWeight(sz * t * 0.35);
        point(this.trail[i].x, this.trail[i].y);
      }
    }
    push();
    colorMode(HSB, 360, 100, 100, 100);
    const recovC = color(hue(c), saturation(c) * 0.5, brightness(c) * 0.85, 100);
    pop();
    this.drawGlow(this.pos.x, this.pos.y, sz, recovC, pulse * 0.7);
  }

  show() {
    if (!this.isMain) {
      const bgHue = (noise(this.pos.x * 0.004, this.pos.y * 0.004, frameCount * 0.001) * 80 + 180) % 360;
      push();
      colorMode(HSB, 360, 100, 100, 100);
      const bc = color(bgHue, 30, 90, 12);
      pop();
      noStroke();
      fill(bc);
      ellipse(this.pos.x, this.pos.y, 2.2, 2.2);
      return;
    }

    const c = this.getColor();
    noStroke();
    if (currentState === STATES.CALM) this.showCalm(c);
    else if (currentState === STATES.TENSION) this.showTension(c);
    else if (currentState === STATES.FAILURE) this.showFailure(c);
    else this.showRecovery(c);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  faceCenter.x = smoothedFace.x = width / 2;
  faceCenter.y = smoothedFace.y = height / 2;
}
