/* Hero backdrop: a network shaken by a passing wave, then selectively reinforced. */
(function () {
  'use strict';

  var canvas = document.getElementById('hero-net');
  if (!canvas || !window.SA) {
    return;
  }

  var COLS = 13;
  var ROWS = 8;
  var CYCLE = 11000; // ms per earthquake cycle
  var rand = SA.rng(23);
  var pal = SA.palette(canvas.parentElement);

  var nodes = [];
  var edges = [];
  var r, c;

  for (r = 0; r < ROWS; r++) {
    for (c = 0; c < COLS; c++) {
      nodes.push({
        x: (c + 0.5 + (rand() - 0.5) * 0.66) / COLS,
        y: (r + 0.5 + (rand() - 0.5) * 0.66) / ROWS
      });
    }
  }

  function link(a, b) {
    edges.push({ a: a, b: b, state: 0, at: 0, phase: rand(), flow: rand() < 0.4, rank: 0 });
  }

  for (r = 0; r < ROWS; r++) {
    for (c = 0; c < COLS; c++) {
      var i = r * COLS + c;
      if (c < COLS - 1 && rand() < 0.8) {
        link(i, i + 1);
      }
      if (r < ROWS - 1 && rand() < 0.8) {
        link(i, i + COLS);
      }
      if (c < COLS - 1 && r < ROWS - 1 && rand() < 0.1) {
        link(i, i + COLS + 1);
      }
    }
  }

  // Edges whose endpoints are well connected matter most; they are reinforced first.
  var degree = nodes.map(function () {
    return 0;
  });
  edges.forEach(function (e) {
    degree[e.a]++;
    degree[e.b]++;
  });
  edges.forEach(function (e) {
    e.rank = degree[e.a] + degree[e.b] + rand();
  });

  var clock = 0;
  var cycles = 0;
  var epi = { x: 0.9, y: 0.2 };
  var rehabQueue = [];
  var rehabbed = 0;

  function startCycle() {
    cycles++;
    if (cycles % 4 === 1) {
      edges.forEach(function (e) {
        e.state = 0;
      });
    }
    edges.forEach(function (e) {
      if (e.state === 1) {
        e.state = 0;
      }
      e.hit = false;
    });
    epi = { x: 0.55 + rand() * 0.45, y: rand() };
    rehabQueue = [];
    rehabbed = 0;
  }

  function step(dt) {
    clock += dt;
    if (clock >= CYCLE) {
      clock -= CYCLE;
      startCycle();
    }

    var radius = Math.max(0, (clock - 800) / 1000) * 0.34; // wave front, unit lengths

    edges.forEach(function (e) {
      if (e.hit) {
        return;
      }
      var mx = (nodes[e.a].x + nodes[e.b].x) / 2;
      var my = (nodes[e.a].y + nodes[e.b].y) / 2;
      var d = Math.hypot(mx - epi.x, my - epi.y);
      if (d <= radius) {
        e.hit = true;
        if (e.state === 0 && rand() < 0.62 * Math.exp(-d / 0.42)) {
          e.state = 1;
          e.at = clock;
        }
      }
    });

    // After the wave: reinforce the most connected failures, one at a time.
    if (clock > 5200 && !rehabQueue.length && rehabbed === 0) {
      rehabQueue = edges
        .filter(function (e) {
          return e.state === 1;
        })
        .sort(function (p, q) {
          return q.rank - p.rank;
        })
        .slice(0, 9);
      rehabbed = 1;
    }
    if (rehabQueue.length && clock > 5200 + (rehabbed - 1) * 170) {
      var e = rehabQueue.shift();
      e.state = 2;
      e.at = clock;
      rehabbed++;
    }
  }

  function draw() {
    var f = SA.fit(canvas);
    var ctx = f.ctx;
    var w = f.w;
    var h = f.h;
    ctx.clearRect(0, 0, w, h);

    function px(n) {
      return n.x * w;
    }
    function py(n) {
      return n.y * h;
    }

    var radius = Math.max(0, (clock - 800) / 1000) * 0.34;
    if (radius > 0 && radius < 1.5) {
      var scale = Math.max(w, h);
      ctx.beginPath();
      ctx.arc(epi.x * w, epi.y * h, radius * scale, 0, Math.PI * 2);
      ctx.strokeStyle = SA.rgba(pal.s2, Math.max(0, 0.32 * (1 - radius / 1.5)));
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    edges.forEach(function (e) {
      var a = nodes[e.a];
      var b = nodes[e.b];
      var age = clock - e.at;
      ctx.beginPath();
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
      if (e.state === 1) {
        var flash = age < 500 ? 1 - age / 500 : 0;
        ctx.strokeStyle = SA.rgba(pal.s2, 0.5 + 0.45 * flash);
        ctx.lineWidth = 1.25 + flash;
      } else if (e.state === 2) {
        var glow = age >= 0 && age < 700 ? 1 - age / 700 : 0;
        ctx.strokeStyle = SA.rgba(pal.s3, 0.62 + 0.38 * glow);
        ctx.lineWidth = 1.6 + glow * 1.4;
      } else {
        ctx.strokeStyle = SA.rgba(pal.text, 0.17);
        ctx.lineWidth = 1;
      }
      ctx.stroke();

      // flow particle on intact carrying edges
      if (e.flow && e.state !== 1) {
        var t = (clock / 2600 + e.phase) % 1;
        ctx.beginPath();
        ctx.arc(px(a) + (px(b) - px(a)) * t, py(a) + (py(b) - py(a)) * t, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = SA.rgba(pal.s1, 0.85);
        ctx.fill();
      }
    });

    ctx.fillStyle = SA.rgba(pal.text, 0.42);
    nodes.forEach(function (n) {
      ctx.beginPath();
      ctx.arc(px(n), py(n), 1.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  startCycle();

  if (SA.reducedMotion) {
    // Static frame: mid-cycle, with a few failures and repairs visible.
    for (var k = 0; k < 420; k++) {
      step(16);
    }
    draw();
  } else {
    SA.loop(canvas, function (dt) {
      step(dt);
      draw();
    });
  }

  SA.onResize(canvas, draw);
})();
