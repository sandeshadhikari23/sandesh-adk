/* Efficient global optimization in one dimension:
   ordinary Kriging surrogate + expected-improvement infill. */
(function () {
  'use strict';

  var root = document.getElementById('demo-ego');
  if (!root || !window.SA) {
    return;
  }

  var canvas = root.querySelector('canvas');
  var readout = root.querySelector('[data-readout]');
  var pal = SA.palette(root);

  var G = 201; // plot resolution
  var N_INIT = 4;
  var N_MAX = 11;
  var MIN_GAP = 0.006; // never resample on top of an existing point
  var THETAS = [6, 12, 24, 48, 96, 192]; // candidate correlation parameters
  var xs = [];
  for (var g = 0; g < G; g++) {
    xs.push(g / (G - 1));
  }

  var seed = 5;
  var rand, truth, truthY, yMin, yMax, fStar;
  var X, Y, model, cur, tgt, eiScale, eiScaleTgt, next, phase, clock, done;
  var hoverX = null;

  /* ------------------------------------------------------------ linear algebra */

  function cholesky(A) {
    var n = A.length;
    var L = [];
    for (var i = 0; i < n; i++) {
      L.push(new Array(n).fill(0));
      for (var j = 0; j <= i; j++) {
        var s = A[i][j];
        for (var k = 0; k < j; k++) {
          s -= L[i][k] * L[j][k];
        }
        if (i === j) {
          if (s <= 0) {
            return null;
          }
          L[i][i] = Math.sqrt(s);
        } else {
          L[i][j] = s / L[j][j];
        }
      }
    }
    return L;
  }

  function cholSolve(L, b) {
    var n = L.length;
    var y = new Array(n);
    var x = new Array(n);
    var i, k, s;
    for (i = 0; i < n; i++) {
      s = b[i];
      for (k = 0; k < i; k++) {
        s -= L[i][k] * y[k];
      }
      y[i] = s / L[i][i];
    }
    for (i = n - 1; i >= 0; i--) {
      s = y[i];
      for (k = i + 1; k < n; k++) {
        s -= L[k][i] * x[k];
      }
      x[i] = s / L[i][i];
    }
    return x;
  }

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) {
      s += a[i] * b[i];
    }
    return s;
  }

  /* ------------------------------------------------------------------ Kriging */

  // Ordinary Kriging with a Gaussian correlation; theta chosen by concentrated likelihood.
  function fit(X, Y) {
    var n = X.length;
    var ones = new Array(n).fill(1);
    var best = null;

    THETAS.forEach(function (theta) {
      var R = [];
      for (var i = 0; i < n; i++) {
        R.push([]);
        for (var j = 0; j < n; j++) {
          var d = X[i] - X[j];
          R[i].push(Math.exp(-theta * d * d) + (i === j ? 1e-8 : 0));
        }
      }
      var L = cholesky(R);
      if (!L) {
        return;
      }
      var Ri1 = cholSolve(L, ones);
      var mu = dot(ones, cholSolve(L, Y)) / dot(ones, Ri1);
      var res = Y.map(function (v) {
        return v - mu;
      });
      var RiRes = cholSolve(L, res);
      var s2 = dot(res, RiRes) / n;
      var logDet = 0;
      for (var k = 0; k < n; k++) {
        logDet += 2 * Math.log(L[k][k]);
      }
      var nll = n * Math.log(s2) + logDet;
      if (!best || nll < best.nll) {
        best = { theta: theta, L: L, mu: mu, s2: s2, RiRes: RiRes, denom: dot(ones, Ri1), nll: nll };
      }
    });
    return best;
  }

  function predict(m, x) {
    var n = X.length;
    var r = new Array(n);
    for (var i = 0; i < n; i++) {
      var d = x - X[i];
      r[i] = Math.exp(-m.theta * d * d);
    }
    var Rir = cholSolve(m.L, r);
    var sumRir = 0;
    for (var k = 0; k < n; k++) {
      sumRir += Rir[k];
    }
    var u = 1 - sumRir;
    var s2 = m.s2 * (1 - dot(r, Rir) + (u * u) / m.denom);
    return { mu: m.mu + dot(r, m.RiRes), s: Math.sqrt(Math.max(s2, 0)) };
  }

  function normPdf(z) {
    return Math.exp(-0.5 * z * z) / 2.5066282746310002;
  }

  function normCdf(z) {
    // Abramowitz–Stegun 26.2.17
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var p = normPdf(z) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z >= 0 ? 1 - p : p;
  }

  function expectedImprovement(best, mu, s) {
    if (s < 1e-9) {
      return 0;
    }
    var z = (best - mu) / s;
    return (best - mu) * normCdf(z) + s * normPdf(z);
  }

  /* -------------------------------------------------------------------- state */

  function refit() {
    var fitted = fit(X, Y);
    if (!fitted) {
      done = true; // correlation matrix became singular; keep the last good model
      return;
    }
    model = fitted;
    var best = Math.min.apply(null, Y);
    var out = { mu: [], lo: [], hi: [], ei: [] };
    var eiMax = 0;
    var arg = 0;
    for (var i = 0; i < G; i++) {
      var p = predict(model, xs[i]);
      var ei = tooClose(xs[i]) ? 0 : expectedImprovement(best, p.mu, p.s);
      out.mu.push(p.mu);
      out.lo.push(p.mu - 2 * p.s);
      out.hi.push(p.mu + 2 * p.s);
      out.ei.push(ei);
      if (ei > eiMax) {
        eiMax = ei;
        arg = i;
      }
    }
    tgt = out;
    next = { i: arg, x: xs[arg], ei: eiMax };
    eiScaleTgt = Math.max(eiMax, 1e-6);
    done = X.length >= N_MAX || eiMax < 1e-5 * (yMax - yMin);
  }

  function tooClose(x) {
    for (var i = 0; i < X.length; i++) {
      if (Math.abs(X[i] - x) < MIN_GAP) {
        return true;
      }
    }
    return false;
  }

  function reset() {
    seed++;
    rand = SA.rng(seed * 7919);

    // A Forrester-type test function, perturbed per run.
    var A = 0.75 + 0.45 * rand();
    var B = (rand() - 0.5) * 12;
    var shift = (rand() - 0.5) * 0.1;
    truth = function (x) {
      var u = x + shift;
      return A * Math.pow(6 * u - 2, 2) * Math.sin(12 * u - 4) + B * (u - 0.5);
    };
    truthY = xs.map(truth);
    yMin = Math.min.apply(null, truthY);
    yMax = Math.max.apply(null, truthY);
    fStar = yMin;
    var pad = (yMax - yMin) * 0.14;
    yMin -= pad;
    yMax += pad;

    // Stratified initial design (a one-dimensional Latin hypercube).
    X = [];
    for (var i = 0; i < N_INIT; i++) {
      X.push((i + 0.15 + 0.7 * rand()) / N_INIT);
    }
    Y = X.map(truth);

    refit();
    cur = { mu: tgt.mu.slice(), lo: tgt.lo.slice(), hi: tgt.hi.slice(), ei: tgt.ei.slice() };
    eiScale = eiScaleTgt;
    phase = done ? 'hold' : 'show';
    clock = 0;
    say();
  }

  function advance() {
    X.push(next.x);
    Y.push(truth(next.x));
    refit();
    say();
  }

  function step(dt) {
    clock += dt;

    // ease the drawn curves toward the fitted ones
    var k = 1 - Math.exp(-dt / 140);
    ['mu', 'lo', 'hi', 'ei'].forEach(function (key) {
      var c = cur[key];
      var t = tgt[key];
      for (var i = 0; i < G; i++) {
        c[i] += (t[i] - c[i]) * k;
      }
    });
    eiScale += (eiScaleTgt - eiScale) * k;

    if (phase === 'show' && clock > 1500) {
      phase = 'eval';
      clock = 0;
    } else if (phase === 'eval' && clock > 520) {
      advance();
      phase = done ? 'hold' : 'show';
      clock = 0;
    } else if (phase === 'hold' && clock > 3400) {
      reset();
    }
  }

  function fmt(v) {
    return (v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
  }

  function say() {
    if (hoverX !== null) {
      return;
    }
    var best = Math.min.apply(null, Y);
    readout.innerHTML =
      'simulations used <b>' + X.length + '</b> of ' + N_MAX +
      ' · best found <b>' + fmt(best) + '</b>' +
      ' · true best <b>' + fmt(fStar) + '</b>' +
      '<br>' +
      (done ? (X.length >= N_MAX ? 'simulation budget spent' : 'done: nothing left is expected to beat the best') : 'next: try the decision at <b>' + next.x.toFixed(2) + '</b>');
  }

  /* --------------------------------------------------------------------- draw */

  var box = null; // last plot geometry, for hover

  function draw() {
    var f = SA.fit(canvas);
    var ctx = f.ctx;
    var w = f.w;
    var h = f.h;
    ctx.clearRect(0, 0, w, h);

    var left = 40;
    var right = 10;
    var top = 20;
    var bottom = 24;
    var gap = 30;
    var plotH = h - top - bottom - gap;
    var hA = Math.round(plotH * 0.7);
    var hB = plotH - hA;
    var yA = top;
    var yB = top + hA + gap;
    var pw = w - left - right;
    box = { left: left, pw: pw };

    function px(x) {
      return left + x * pw;
    }
    function pyA(v) {
      return yA + hA - ((v - yMin) / (yMax - yMin)) * hA;
    }
    function pyB(v) {
      return yB + hB - Math.min(1, v / (eiScale * 1.12)) * hB;
    }

    ctx.font = '10.5px ' + SA.MONO;
    ctx.textBaseline = 'middle';

    // gridlines + y ticks (top panel)
    var ticks = niceTicks(yMin, yMax, 4);
    ctx.lineWidth = 1;
    ticks.forEach(function (t) {
      var y = Math.round(pyA(t)) + 0.5;
      ctx.strokeStyle = pal.grid;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + pw, y);
      ctx.stroke();
      ctx.fillStyle = pal.muted;
      ctx.textAlign = 'right';
      ctx.fillText(String(t).replace('-', '−'), left - 8, y);
    });

    // baselines
    ctx.strokeStyle = pal.axis;
    [yA + hA, yB + hB].forEach(function (y) {
      ctx.beginPath();
      ctx.moveTo(left, Math.round(y) + 0.5);
      ctx.lineTo(left + pw, Math.round(y) + 0.5);
      ctx.stroke();
    });

    // x ticks
    ctx.fillStyle = pal.muted;
    ctx.textAlign = 'center';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      ctx.fillText(t === 0 ? '0' : t === 1 ? '1' : String(t), px(t), yB + hB + 13);
    });

    // panel titles
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.text2;
    ctx.fillText('cost of the decision', left, yA - 9);
    ctx.fillText('where the next simulation is worth most', left, yB - 9);
    ctx.textAlign = 'right';
    ctx.fillStyle = pal.muted;
    ctx.fillText('decision →', left + pw, yA - 9);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, yA - 2, pw, hA + 4);
    ctx.clip();

    // ±2σ band
    ctx.beginPath();
    var i;
    for (i = 0; i < G; i++) {
      ctx.lineTo(px(xs[i]), pyA(cur.hi[i]));
    }
    for (i = G - 1; i >= 0; i--) {
      ctx.lineTo(px(xs[i]), pyA(cur.lo[i]));
    }
    ctx.closePath();
    ctx.fillStyle = SA.rgba(pal.s1, 0.16);
    ctx.fill();

    // true function
    ctx.beginPath();
    for (i = 0; i < G; i++) {
      ctx.lineTo(px(xs[i]), pyA(truthY[i]));
    }
    ctx.strokeStyle = pal.muted;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Kriging mean
    ctx.beginPath();
    for (i = 0; i < G; i++) {
      ctx.lineTo(px(xs[i]), pyA(cur.mu[i]));
    }
    ctx.strokeStyle = pal.s1;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    // expected improvement (own panel, own scale)
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, yB - 2, pw, hB + 3);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(px(0), yB + hB);
    for (i = 0; i < G; i++) {
      ctx.lineTo(px(xs[i]), pyB(cur.ei[i]));
    }
    ctx.lineTo(px(1), yB + hB);
    ctx.closePath();
    ctx.fillStyle = SA.rgba(pal.s2, 0.14);
    ctx.fill();
    ctx.beginPath();
    for (i = 0; i < G; i++) {
      ctx.lineTo(px(xs[i]), pyB(cur.ei[i]));
    }
    ctx.strokeStyle = pal.s2;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // next infill point
    if (!done || phase === 'eval') {
      var nx = px(next.x);
      ctx.strokeStyle = SA.rgba(pal.s2, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(nx) + 0.5, yA);
      ctx.lineTo(Math.round(nx) + 0.5, yB + hB);
      ctx.stroke();

      var from = pyA(tgt.mu[next.i]);
      var to = pyA(truth(next.x));
      var t = phase === 'eval' ? Math.min(1, clock / 420) : 0;
      var ease = t * t * (3 - 2 * t);
      var ny = from + (to - from) * ease;
      var pulse = phase === 'show' ? 0.5 + 0.5 * Math.sin(clock / 170) : 0;
      ctx.beginPath();
      ctx.arc(nx, ny, 9 + pulse * 3, 0, Math.PI * 2);
      ctx.fillStyle = SA.rgba(pal.s2, 0.16);
      ctx.fill();
      marker(ctx, nx, ny, 4.5, pal.s2);
    }

    // simulated samples
    for (i = 0; i < X.length; i++) {
      marker(ctx, px(X[i]), pyA(Y[i]), 4, pal.text);
    }

    // hover crosshair
    if (hoverX !== null) {
      var hx = Math.round(px(hoverX)) + 0.5;
      ctx.strokeStyle = pal.text2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, yA);
      ctx.lineTo(hx, yB + hB);
      ctx.stroke();
    }
  }

  function marker(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = pal.surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function niceTicks(lo, hi, count) {
    var span = hi - lo;
    var raw = span / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var stepSize = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    var out = [];
    for (var v = Math.ceil(lo / stepSize) * stepSize; v <= hi; v += stepSize) {
      out.push(Math.round(v * 1e6) / 1e6);
    }
    return out;
  }

  /* -------------------------------------------------------------------- hover */

  canvas.addEventListener('pointermove', function (e) {
    if (!box) {
      return;
    }
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left - box.left) / box.pw;
    if (x < 0 || x > 1) {
      leave();
      return;
    }
    hoverX = x;
    var p = predict(model, x);
    var ei = expectedImprovement(Math.min.apply(null, Y), p.mu, p.s);
    readout.innerHTML =
      'decision <b>' + x.toFixed(2) + '</b> · model says <b>' + fmt(p.mu) + '</b> ± ' + (2 * p.s).toFixed(2) +
      ' · truth ' + fmt(truth(x)) +
      '<br>expected improvement <b>' + ei.toFixed(3) + '</b>';
    if (!loop.isPlaying()) {
      draw();
    }
  });

  function leave() {
    if (hoverX === null) {
      return;
    }
    hoverX = null;
    say();
    if (!loop.isPlaying()) {
      draw();
    }
  }
  canvas.addEventListener('pointerleave', leave);

  /* --------------------------------------------------------------------- boot */

  reset();

  var loop = SA.loop(root, function (dt) {
    step(dt);
    draw();
  });

  SA.controls(root, loop, reset, draw);
  SA.onResize(canvas, draw);

  if (SA.reducedMotion) {
    // Show a finished run instead of an empty first frame.
    while (!done) {
      advance();
    }
    cur = { mu: tgt.mu.slice(), lo: tgt.lo.slice(), hi: tgt.hi.slice(), ei: tgt.ei.slice() };
    eiScale = eiScaleTgt;
    phase = 'hold';
  }
  draw();
})();
