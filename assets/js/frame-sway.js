/* A 17-storey shear building under synthetic ground motion.
   Linear modal superposition (three modes, 5% damping), integrated in real time. */
(function () {
  'use strict';

  var root = document.getElementById('demo-frame');
  if (!root || !window.SA) {
    return;
  }

  var canvas = root.querySelector('canvas');
  var readout = root.querySelector('[data-readout]');
  var pal = SA.palette(root);
  var accent = getComputedStyle(root).getPropertyValue('--accent').trim();

  var N = 17; // storeys
  var BAYS = 3;
  var T1 = 1.7; // fundamental period, s
  var ZETA = 0.05;
  var STOREY = 3.2; // m
  var PGA = 0.3 * 9.81; // m/s²
  var CYCLE = 16; // s between repeats of the record
  var DT = 1 / 240;
  var TRACE = 8; // seconds of record on screen

  /* -------------------------------------------------------------------- modes */

  var modes = [];
  var w1 = (2 * Math.PI) / T1;
  for (var n = 1; n <= 3; n++) {
    var k = ((2 * n - 1) * Math.PI) / (2 * N + 1);
    var phi = [0];
    var sum = 0;
    var sumSq = 0;
    for (var j = 1; j <= N; j++) {
      var p = Math.sin(k * j);
      phi.push(p);
      sum += p;
      sumSq += p * p;
    }
    modes.push({
      phi: phi,
      w: (w1 * Math.sin(k / 2)) / Math.sin(Math.PI / (2 * (2 * N + 1))),
      gamma: sum / sumSq,
      q: 0,
      v: 0
    });
  }

  /* ------------------------------------------------------------ ground motion */

  var rand = SA.rng(12);
  var parts = [];
  for (var c = 0; c < 9; c++) {
    var freq = 0.35 + 3.4 * rand();
    parts.push({ f: freq, a: (0.6 + 0.8 * rand()) / Math.sqrt(freq), ph: 2 * Math.PI * rand() });
  }

  function envelope(t) {
    var s = ((t % CYCLE) + CYCLE) % CYCLE;
    return s < 1.5 ? s / 1.5 : s < 7 ? 1 : Math.exp(-(s - 7) / 1.4);
  }

  function raw(t) {
    var s = 0;
    for (var i = 0; i < parts.length; i++) {
      s += parts[i].a * Math.sin(2 * Math.PI * parts[i].f * t + parts[i].ph);
    }
    return s * envelope(t);
  }

  var peak = 0;
  for (var tt = 0; tt < CYCLE; tt += 1 / 120) {
    peak = Math.max(peak, Math.abs(raw(tt)));
  }

  function accel(t) {
    return (raw(t) / peak) * PGA;
  }

  /* -------------------------------------------------------------- integration */

  var time = 0;

  function advance(seconds) {
    var steps = Math.max(1, Math.round(seconds / DT));
    for (var s = 0; s < steps; s++) {
      var a = accel(time);
      for (var m = 0; m < modes.length; m++) {
        var md = modes[m];
        md.v += (-md.gamma * a - 2 * ZETA * md.w * md.v - md.w * md.w * md.q) * DT;
        md.q += md.v * DT;
      }
      time += DT;
    }
  }

  function displacement(storey) {
    var u = 0;
    for (var m = 0; m < modes.length; m++) {
      u += modes[m].phi[storey] * modes[m].q;
    }
    return u;
  }

  // One dry run fixes the drawing scale, so the sway fills the frame without clipping.
  var maxRoof = 0;
  for (var d = 0; d < 2 * CYCLE; d += DT) {
    advance(DT);
    maxRoof = Math.max(maxRoof, Math.abs(displacement(N)));
  }
  modes.forEach(function (md) {
    md.q = 0;
    md.v = 0;
  });
  time = 0;

  /* --------------------------------------------------------------------- draw */

  var sinceText = 0;

  function draw() {
    var f = SA.fit(canvas);
    var ctx = f.ctx;
    var w = f.w;
    var h = f.h;
    ctx.clearRect(0, 0, w, h);

    var traceH = 54;
    var groundY = h - traceH - 44;
    var topY = 26;
    var height = groundY - topY;
    var width = Math.min(w * 0.44, height * 0.42);
    var x0 = (w - width) / 2;
    var bay = width / BAYS;
    var storeyH = height / N;
    var scale = (0.16 * height) / maxRoof; // px per metre, exaggerated

    var u = [];
    for (var j = 0; j <= N; j++) {
      u.push(displacement(j) * scale);
    }

    function fy(j) {
      return groundY - j * storeyH;
    }

    // undeformed outline
    ctx.strokeStyle = pal.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(topY) + 0.5, Math.round(width), Math.round(height));

    // ground line with hatching
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0 - 34, groundY + 0.5);
    ctx.lineTo(x0 + width + 34, groundY + 0.5);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = x0 - 30; gx <= x0 + width + 34; gx += 9) {
      ctx.moveTo(gx, groundY + 1);
      ctx.lineTo(gx - 7, groundY + 8);
    }
    ctx.stroke();

    // deformed frame
    ctx.strokeStyle = accent;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var b = 0; b <= BAYS; b++) {
      ctx.moveTo(x0 + b * bay, groundY);
      for (j = 1; j <= N; j++) {
        ctx.lineTo(x0 + b * bay + u[j], fy(j));
      }
    }
    ctx.stroke();
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (j = 1; j <= N; j++) {
      ctx.moveTo(x0 + u[j], fy(j));
      ctx.lineTo(x0 + width + u[j], fy(j));
    }
    ctx.stroke();

    // roof displacement marker
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + width + 0.5, topY - 12);
    ctx.lineTo(x0 + width + 0.5, topY - 4);
    ctx.moveTo(x0 + width + u[N] + 0.5, topY - 12);
    ctx.lineTo(x0 + width + u[N] + 0.5, topY - 4);
    ctx.moveTo(x0 + width, topY - 8);
    ctx.lineTo(x0 + width + u[N], topY - 8);
    ctx.stroke();

    // storey labels
    ctx.font = '10px ' + SA.MONO;
    ctx.fillStyle = pal.muted;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText('17', x0 - 12, fy(N));
    ctx.fillText('9', x0 - 12, fy(9));
    ctx.fillText('1', x0 - 12, fy(1));

    // ground acceleration record, newest sample at the right edge
    var ty = h - traceH / 2 - 6;
    var tl = 16;
    var tw = w - 32;
    ctx.strokeStyle = pal.grid;
    ctx.beginPath();
    ctx.moveTo(tl, Math.round(ty) + 0.5);
    ctx.lineTo(tl + tw, Math.round(ty) + 0.5);
    ctx.stroke();

    ctx.beginPath();
    var samples = Math.max(60, Math.round(tw / 1.5));
    for (var s = 0; s <= samples; s++) {
      var ts = time - TRACE + (s / samples) * TRACE;
      var a = ts < 0 ? 0 : accel(ts);
      ctx.lineTo(tl + (s / samples) * tw, ty - (a / PGA) * (traceH / 2 - 4));
    }
    ctx.strokeStyle = pal.s2;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = pal.muted;
    ctx.textAlign = 'left';
    ctx.fillText('ground acceleration', tl, h - traceH - 14);
    ctx.textAlign = 'right';
    ctx.fillText('last ' + TRACE + ' s', tl + tw, h - traceH - 14);
  }

  function say() {
    var roof = displacement(N);
    readout.textContent =
      'PGA 0.30 g · T₁ ' + T1.toFixed(1) + ' s · roof ' + (roof < 0 ? '−' : '+') + Math.abs(roof).toFixed(2) + ' m' +
      ' · drift ' + ((Math.abs(roof) / (N * STOREY)) * 100).toFixed(2) + '%';
  }

  /* --------------------------------------------------------------------- boot */

  if (SA.reducedMotion) {
    advance(4.6);
  } else {
    SA.loop(root, function (dt) {
      advance(dt / 1000);
      draw();
      sinceText += dt;
      if (sinceText > 140) {
        sinceText = 0;
        say();
      }
    });
  }

  SA.onResize(canvas, draw);
  draw();
  say();
})();
