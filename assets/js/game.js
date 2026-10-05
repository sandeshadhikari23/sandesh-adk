/* "Beat the optimizer".
   The visitor reinforces a few links of a small supply network. Their plan and an
   optimizer's plan then face the same set of simulated earthquakes, and are scored
   by how many neighbourhoods stay connected to the supply on average. */
(function () {
  'use strict';

  var root = document.getElementById('game');
  if (!root || !window.SA) {
    return;
  }

  var canvas = root.querySelector('canvas');
  var pal = SA.palette(root);

  function q(sel) {
    return root.querySelector(sel);
  }
  var el = {
    status: q('[data-status]'),
    left: q('[data-left]'),
    run: q('[data-run]'),
    random: q('[data-random]'),
    clear: q('[data-clear]'),
    fresh: q('[data-new]'),
    reveal: q('[data-reveal]'),
    verdict: q('[data-verdict]'),
    plans: document.querySelector('[data-plans]')
  };
  var bars = {};
  ['none', 'you', 'opt'].forEach(function (key) {
    var row = q('[data-bar="' + key + '"]');
    bars[key] = { fill: row.querySelector('.score__fill'), value: row.querySelector('.score__value') };
  });

  var COLS = 8;
  var ROWS = 5;
  var BUDGET = 6;
  var RUNS = 300; // simulated earthquakes, shared by every plan
  var SHOWN = 12; // how many of them are animated
  var T_SHOW = 260;
  var P_BASE = 0.03; // failure probability far from the fault
  var P_AMP = 0.55; // extra failure probability on the fault
  var P_WIDTH = 0.2; // how quickly shaking fades with distance

  var seed = 20;
  var rand, nodes, links, adj, source, fault, scen, seen, stack;
  var picks, optimum, score, buildToken;
  var mode, clock, shownIndex, hover, revealed;

  /* ------------------------------------------------------------------ network */

  function build() {
    seed++;
    rand = SA.rng(seed * 2654435761);
    buildToken = seed;
    nodes = [];
    links = [];
    var r, c, i;

    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        nodes.push({
          x: (c + 0.5 + (rand() - 0.5) * 0.55) / COLS,
          y: (r + 0.5 + (rand() - 0.5) * 0.55) / ROWS
        });
      }
    }

    // A sparse street-like grid: enough gaps that some links are real bottlenecks.
    var removed = [];
    function consider(a, b) {
      (rand() < 0.66 ? links : removed).push({ a: a, b: b });
    }
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        i = r * COLS + c;
        if (c < COLS - 1) {
          consider(i, i + 1);
        }
        if (r < ROWS - 1) {
          consider(i, i + COLS);
        }
        if (c < COLS - 1 && r < ROWS - 1 && rand() < 0.06) {
          links.push({ a: i, b: i + COLS + 1 });
        }
      }
    }
    for (;;) {
      var comp = components();
      if (comp.count === 1) {
        break;
      }
      var k = removed.findIndex(function (e) {
        return comp.id[e.a] !== comp.id[e.b];
      });
      links.push(removed.splice(k, 1)[0]);
    }

    // The fault crosses the map from top to bottom; shaking is strongest beside it.
    fault = { ax: 0.25 + 0.5 * rand(), ay: -0.05, bx: 0.25 + 0.5 * rand(), by: 1.05 };
    links.forEach(function (l, idx) {
      l.id = idx;
      var d = faultDistance((nodes[l.a].x + nodes[l.b].x) / 2, (nodes[l.a].y + nodes[l.b].y) / 2);
      l.risk = Math.exp(-Math.pow(d / P_WIDTH, 2)); // 0..1, for drawing
      l.p = P_BASE + P_AMP * l.risk;
    });

    // The supply sits as far from the fault as the map allows.
    source = 0;
    var far = -1;
    nodes.forEach(function (nd, idx) {
      var d = faultDistance(nd.x, nd.y);
      if (d > far) {
        far = d;
        source = idx;
      }
    });

    adj = nodes.map(function () {
      return [];
    });
    links.forEach(function (l) {
      adj[l.a].push(l.b, l.id);
      adj[l.b].push(l.a, l.id);
    });
    seen = new Uint8Array(nodes.length);
    stack = new Int32Array(nodes.length);

    scen = [];
    for (var s = 0; s < RUNS; s++) {
      var fails = new Uint8Array(links.length);
      for (i = 0; i < links.length; i++) {
        fails[i] = rand() < links[i].p ? 1 : 0;
      }
      scen.push(fails);
    }

    picks = new Uint8Array(links.length);
    optimum = null;
    score = { none: expected(picks), you: null, opt: null };
    revealed = false;
    hover = -1;
    mode = 'idle';
    clock = 0;
    shownIndex = -1;

    if (el.plans) {
      el.plans.textContent = choose(links.length, BUDGET).toLocaleString('en-US');
    }
    optimizeInBackground(buildToken);
    refresh();
  }

  function components() {
    var id = new Int16Array(nodes.length).fill(-1);
    var nb = nodes.map(function () {
      return [];
    });
    links.forEach(function (l) {
      nb[l.a].push(l.b);
      nb[l.b].push(l.a);
    });
    var count = 0;
    for (var s = 0; s < nodes.length; s++) {
      if (id[s] >= 0) {
        continue;
      }
      var todo = [s];
      id[s] = count;
      while (todo.length) {
        var u = todo.pop();
        nb[u].forEach(function (v) {
          if (id[v] < 0) {
            id[v] = count;
            todo.push(v);
          }
        });
      }
      count++;
    }
    return { id: id, count: count };
  }

  function faultDistance(x, y) {
    var dx = fault.bx - fault.ax;
    var dy = fault.by - fault.ay;
    var t = Math.max(0, Math.min(1, ((x - fault.ax) * dx + (y - fault.ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (fault.ax + t * dx), y - (fault.ay + t * dy));
  }

  function choose(n, k) {
    var out = 1;
    for (var i = 1; i <= k; i++) {
      out = (out * (n - k + i)) / i;
    }
    return Math.round(out);
  }

  /* --------------------------------------------------------------- simulation */

  // Share of neighbourhoods still connected to the supply after one earthquake.
  function service(plan, fails) {
    seen.fill(0);
    seen[source] = 1;
    stack[0] = source;
    var top = 1;
    var count = 0;
    while (top) {
      var a = adj[stack[--top]];
      for (var i = 0; i < a.length; i += 2) {
        var v = a[i];
        var e = a[i + 1];
        if (!seen[v] && (plan[e] || !fails[e])) {
          seen[v] = 1;
          count++;
          stack[top++] = v;
        }
      }
    }
    return count / (nodes.length - 1);
  }

  function expected(plan) {
    var total = 0;
    for (var s = 0; s < RUNS; s++) {
      total += service(plan, scen[s]);
    }
    return total / RUNS;
  }

  /* ---------------------------------------------------------------- optimizer */

  // Greedy construction, then pairwise swaps, both scored on the same 300 earthquakes.
  // Runs in small slices so the page never stalls.
  function optimizeInBackground(token) {
    var plan = new Uint8Array(links.length);
    var placed = 0;
    var current = 0;
    var passes = 0;

    function later(fn) {
      setTimeout(function () {
        if (token === buildToken) {
          fn();
        }
      }, 0);
    }

    function greedy() {
      var best = -1;
      var bestScore = -1;
      for (var e = 0; e < links.length; e++) {
        if (plan[e]) {
          continue;
        }
        plan[e] = 1;
        var s = expected(plan);
        plan[e] = 0;
        if (s > bestScore) {
          bestScore = s;
          best = e;
        }
      }
      plan[best] = 1;
      current = bestScore;
      placed++;
      later(placed < BUDGET ? greedy : swap);
    }

    function swap() {
      var improved = false;
      for (var i = 0; i < links.length; i++) {
        if (!plan[i]) {
          continue;
        }
        for (var j = 0; j < links.length; j++) {
          if (plan[j]) {
            continue;
          }
          plan[i] = 0;
          plan[j] = 1;
          var s = expected(plan);
          if (s > current + 1e-9) {
            current = s;
            improved = true;
            break; // link i is no longer in the plan
          }
          plan[i] = 1;
          plan[j] = 0;
        }
      }
      passes++;
      if (improved && passes < 3) {
        later(swap);
      } else {
        optimum = { plan: plan, score: current };
        if (mode === 'wait') {
          finish();
        }
      }
    }

    later(greedy);
  }

  /* --------------------------------------------------------------------- flow */

  function used() {
    var n = 0;
    for (var i = 0; i < picks.length; i++) {
      n += picks[i];
    }
    return n;
  }

  function pct(v) {
    return Math.round(v * 100) + '%';
  }

  function setBar(key, v) {
    bars[key].fill.style.width = v === null ? '0%' : (v * 100).toFixed(1) + '%';
    bars[key].value.textContent = v === null ? '–' : pct(v);
  }

  function refresh() {
    var left = BUDGET - used();
    el.left.textContent = String(left);
    setBar('none', score.none);
    setBar('you', score.you);
    setBar('opt', score.opt);
    el.reveal.disabled = score.opt === null;
    el.reveal.textContent = revealed ? 'Hide the optimizer’s plan' : 'Show the optimizer’s plan';
    el.run.disabled = mode === 'sim' || mode === 'wait';

    if (mode === 'idle') {
      el.status.textContent = 'Click the links you would reinforce. Reinforced links survive every earthquake.';
    } else if (mode === 'pick') {
      el.status.textContent = left
        ? 'Keep going, or run the earthquakes with what you have.'
        : 'Budget spent. Run the earthquakes to see how your plan holds up.';
    }
    if (mode !== 'done') {
      el.verdict.textContent = '';
    }
  }

  function edit(change) {
    if (mode === 'sim' || mode === 'wait') {
      return;
    }
    change();
    score.you = null;
    score.opt = null;
    revealed = false;
    mode = 'pick';
    shownIndex = -1;
    refresh();
    draw();
  }

  function run() {
    if (mode === 'sim' || mode === 'wait') {
      return;
    }
    score.you = null;
    score.opt = null;
    revealed = false;
    mode = 'sim';
    clock = 0;
    refresh();
    if (!loop.isPlaying()) {
      finish(); // reduced motion or paused: skip the replay, show the result
    }
  }

  function finish() {
    if (!optimum) {
      mode = 'wait';
      el.status.textContent = 'The optimizer is still thinking…';
      return;
    }
    mode = 'done';
    shownIndex = -1;
    score.you = expected(picks);
    score.opt = optimum.score;
    refresh();

    var gainYou = score.you - score.none;
    var gainOpt = score.opt - score.none;
    el.status.textContent = RUNS + ' earthquakes simulated. Same earthquakes for every plan.';
    if (score.you > score.opt + 0.002) {
      el.verdict.textContent = 'You beat my quick optimizer on this network. I would like to know how you chose.';
    } else if (score.you > score.opt - 0.004) {
      el.verdict.textContent = 'You matched the optimizer. That is hard to do by eye.';
    } else if (gainYou < 0.004) {
      el.verdict.textContent = 'Those links barely changed the outcome. Where a link sits matters more than how many you fix.';
    } else {
      el.verdict.textContent =
        'Your plan captured ' + Math.round((gainYou / gainOpt) * 100) + '% of the improvement the optimizer found with the same budget.';
    }
    draw();
  }

  function step(dt) {
    clock += dt;
    if (mode === 'idle') {
      // attract mode: show an earthquake every few seconds
      var cycle = clock % 3000;
      shownIndex = cycle > 1100 ? Math.floor(clock / 3000) % RUNS : -1;
    } else if (mode === 'sim') {
      var total = SHOWN * T_SHOW;
      shownIndex = Math.min(SHOWN - 1, Math.floor(clock / T_SHOW));
      el.status.textContent = 'Earthquake ' + Math.min(RUNS, Math.ceil((clock / total) * RUNS)) + ' of ' + RUNS + '…';
      if (clock >= total) {
        finish();
      }
    }
  }

  /* --------------------------------------------------------------------- draw */

  var geo = null;

  function draw() {
    var f = SA.fit(canvas);
    var ctx = f.ctx;
    var w = f.w;
    var h = f.h;
    var pad = 30;
    geo = { pad: pad, w: w, h: h };
    ctx.clearRect(0, 0, w, h);

    function px(x) {
      return pad + x * (w - 2 * pad);
    }
    function py(y) {
      return pad + y * (h - 2 * pad);
    }

    var fails = shownIndex >= 0 ? scen[shownIndex] : null;
    var alive = null;
    if (fails) {
      service(picks, fails);
      alive = seen;
    }

    // a short jolt at the start of each displayed earthquake
    var jolt = 0;
    if (fails && loop.isPlaying()) {
      var since = mode === 'sim' ? clock % T_SHOW : (clock % 3000) - 1100;
      jolt = since < 180 ? (1 - since / 180) * 2.5 : 0;
    }
    ctx.save();
    ctx.translate(jolt * Math.sin(clock / 9), jolt * Math.cos(clock / 7));

    // hazard zone and fault trace
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px(fault.ax), py(fault.ay));
    ctx.lineTo(px(fault.bx), py(fault.by));
    ctx.strokeStyle = SA.rgba(pal.s2, 0.07);
    ctx.lineWidth = P_WIDTH * 2.2 * (w - 2 * pad);
    ctx.stroke();
    ctx.strokeStyle = SA.rgba(pal.s2, 0.6);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = '10.5px ' + SA.MONO;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('fault', px(fault.ax + (fault.bx - fault.ax) * 0.06) + 8, 12);

    // the optimizer's plan, as a halo underneath
    if (revealed && optimum) {
      ctx.strokeStyle = pal.s3;
      ctx.lineWidth = 11;
      links.forEach(function (l) {
        if (optimum.plan[l.id]) {
          line(ctx, px(nodes[l.a].x), py(nodes[l.a].y), px(nodes[l.b].x), py(nodes[l.b].y));
        }
      });
      ctx.strokeStyle = pal.surface;
      ctx.lineWidth = 6;
      links.forEach(function (l) {
        if (optimum.plan[l.id]) {
          line(ctx, px(nodes[l.a].x), py(nodes[l.a].y), px(nodes[l.b].x), py(nodes[l.b].y));
        }
      });
    }

    // links: warmer and brighter means likelier to fail
    links.forEach(function (l) {
      var x1 = px(nodes[l.a].x);
      var y1 = py(nodes[l.a].y);
      var x2 = px(nodes[l.b].x);
      var y2 = py(nodes[l.b].y);
      var broken = fails && fails[l.id] && !picks[l.id];

      if (picks[l.id]) {
        ctx.strokeStyle = pal.s1;
        ctx.lineWidth = 5;
      } else if (broken) {
        ctx.strokeStyle = SA.rgba(pal.s2, 0.3);
        ctx.lineWidth = 2;
      } else {
        ctx.strokeStyle = riskColor(l.risk);
        ctx.lineWidth = l.id === hover && mode !== 'sim' ? 4 : 2;
      }
      line(ctx, x1, y1, x2, y2);

      if (broken) {
        var mx = (x1 + x2) / 2;
        var my = (y1 + y2) / 2;
        ctx.strokeStyle = pal.surface;
        ctx.lineWidth = 5;
        cross(ctx, mx, my, 4.5);
        ctx.strokeStyle = pal.s2;
        ctx.lineWidth = 2;
        cross(ctx, mx, my, 4.5);
      }
    });

    // neighbourhoods
    nodes.forEach(function (nd, idx) {
      var x = px(nd.x);
      var y = py(nd.y);
      if (idx === source) {
        return;
      }
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = pal.surface;
      ctx.fill();
      ctx.beginPath();
      if (!alive || alive[idx]) {
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.text;
        ctx.fill();
      } else {
        ctx.arc(x, y, 3.75, 0, Math.PI * 2);
        ctx.strokeStyle = pal.muted;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });

    // supply
    var sx = px(nodes[source].x);
    var sy = py(nodes[source].y);
    ctx.fillStyle = pal.surface;
    ctx.fillRect(sx - 10, sy - 10, 20, 20);
    ctx.fillStyle = pal.text;
    ctx.fillRect(sx - 7, sy - 7, 14, 14);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = nodes[source].x < 0.5 ? 'left' : 'right';
    ctx.fillText('supply', sx + (nodes[source].x < 0.5 ? -8 : 8), sy + (nodes[source].y < 0.5 ? -19 : 19));

    ctx.restore();
  }

  function riskColor(t) {
    // neutral grey for safe links, through to the hazard colour beside the fault
    var n = parseInt(pal.s2.replace('#', ''), 16);
    var r = Math.round(124 + (((n >> 16) & 255) - 124) * t);
    var g = Math.round(132 + (((n >> 8) & 255) - 132) * t);
    var b = Math.round(146 + ((n & 255) - 146) * t);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (0.5 + 0.5 * t) + ')';
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function cross(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x - r, y + r);
    ctx.lineTo(x + r, y - r);
    ctx.stroke();
  }

  /* ---------------------------------------------------------------- pointing */

  function nearest(e) {
    if (!geo) {
      return -1;
    }
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var best = -1;
    var bestD = e.pointerType === 'touch' ? 22 : 14;
    links.forEach(function (l) {
      var x1 = geo.pad + nodes[l.a].x * (geo.w - 2 * geo.pad);
      var y1 = geo.pad + nodes[l.a].y * (geo.h - 2 * geo.pad);
      var x2 = geo.pad + nodes[l.b].x * (geo.w - 2 * geo.pad);
      var y2 = geo.pad + nodes[l.b].y * (geo.h - 2 * geo.pad);
      var dx = x2 - x1;
      var dy = y2 - y1;
      var t = Math.max(0, Math.min(1, ((mx - x1) * dx + (my - y1) * dy) / (dx * dx + dy * dy)));
      var d = Math.hypot(mx - (x1 + t * dx), my - (y1 + t * dy));
      if (d < bestD) {
        bestD = d;
        best = l.id;
      }
    });
    return best;
  }

  canvas.addEventListener('pointermove', function (e) {
    var h = nearest(e);
    if (h !== hover) {
      hover = h;
      canvas.style.cursor = h >= 0 && mode !== 'sim' ? 'pointer' : 'default';
      if (!loop.isPlaying()) {
        draw();
      }
    }
  });

  canvas.addEventListener('pointerleave', function () {
    hover = -1;
    if (!loop.isPlaying()) {
      draw();
    }
  });

  canvas.addEventListener('click', function (e) {
    var id = nearest(e);
    if (id < 0) {
      return;
    }
    if (!picks[id] && used() >= BUDGET) {
      el.status.textContent = 'All ' + BUDGET + ' reinforcements are placed. Click a blue link to move one.';
      return;
    }
    edit(function () {
      picks[id] = picks[id] ? 0 : 1;
    });
  });

  el.run.addEventListener('click', run);

  el.clear.addEventListener('click', function () {
    edit(function () {
      picks.fill(0);
    });
  });

  el.random.addEventListener('click', function () {
    edit(function () {
      picks.fill(0);
      var free = links.map(function (l) {
        return l.id;
      });
      for (var k = 0; k < BUDGET; k++) {
        picks[free.splice(Math.floor(Math.random() * free.length), 1)[0]] = 1;
      }
    });
  });

  el.fresh.addEventListener('click', function () {
    if (mode === 'sim') {
      return;
    }
    build();
    draw();
  });

  el.reveal.addEventListener('click', function () {
    revealed = !revealed;
    refresh();
    draw();
  });

  /* --------------------------------------------------------------------- boot */

  var loop = SA.loop(root, function (dt) {
    step(dt);
    draw();
  });

  build();
  SA.onResize(canvas, draw);
  draw();
})();
