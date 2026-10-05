/* NSGA-II on a small two-hazard rehabilitation problem.
   Decision: which of N links to rehabilitate under a length budget.
   Objectives: earthquake and flood disruption cost, both minimized. */
(function () {
  'use strict';

  var root = document.getElementById('demo-pareto');
  if (!root || !window.SA) {
    return;
  }

  var canvas = root.querySelector('canvas');
  var readout = root.querySelector('[data-readout]');
  var pal = SA.palette(root);

  var N = 36; // links
  var POP = 48;
  var GENS = 60;
  var BUDGET = 0.2; // share of total length
  var GAIN = 0.2; // how strongly rehabilitation reduces disruption
  var GEN_MS = 150;
  var GHOST_AT = [1, 4, 10, 22];

  var seed = 2;
  var rand, cost, gainEQ, gainFL, totalCost;
  var pop, gen, ghosts, clock, phase, picks;
  var hover = null;
  var box = null;

  /* ------------------------------------------------------------------ problem */

  function makeProblem() {
    cost = [];
    gainEQ = [];
    gainFL = [];
    totalCost = 0;
    for (var i = 0; i < N; i++) {
      var c = 0.5 + 1.5 * rand();
      var mix = rand(); // links that matter for one hazard tend not to matter for the other
      cost.push(c);
      gainEQ.push(c * (0.1 + 1.25 * Math.pow(mix, 1.6)) * (0.7 + 0.6 * rand()));
      gainFL.push(c * (0.1 + 1.25 * Math.pow(1 - mix, 1.6)) * (0.7 + 0.6 * rand()));
      totalCost += c;
    }
  }

  // Budget repair: drop the most expensive selected links until the policy is feasible.
  function repair(x) {
    var used = 0;
    var i;
    for (i = 0; i < N; i++) {
      if (x[i]) {
        used += cost[i];
      }
    }
    while (used > BUDGET * totalCost) {
      var worst = -1;
      for (i = 0; i < N; i++) {
        if (x[i] && (worst < 0 || cost[i] > cost[worst])) {
          worst = i;
        }
      }
      x[worst] = 0;
      used -= cost[worst];
    }
    return x;
  }

  function evaluate(x) {
    var a = 0;
    var b = 0;
    var used = 0;
    var count = 0;
    for (var i = 0; i < N; i++) {
      if (x[i]) {
        a += gainEQ[i];
        b += gainFL[i];
        used += cost[i];
        count++;
      }
    }
    // disruption cost as an index: 100 = no rehabilitation
    return { x: x, f: [100 * Math.exp(-GAIN * a), 100 * Math.exp(-GAIN * b)], used: used / totalCost, count: count, rank: 0, crowd: 0 };
  }

  function randomPolicy() {
    var x = new Uint8Array(N);
    for (var i = 0; i < N; i++) {
      x[i] = rand() < BUDGET * 0.7 ? 1 : 0;
    }
    return evaluate(repair(x));
  }

  /* ------------------------------------------------------------------ NSGA-II */

  function dominates(p, q) {
    return p.f[0] <= q.f[0] && p.f[1] <= q.f[1] && (p.f[0] < q.f[0] || p.f[1] < q.f[1]);
  }

  function sortFronts(all) {
    var fronts = [[]];
    var S = [];
    var n = [];
    var i, j;
    for (i = 0; i < all.length; i++) {
      S.push([]);
      n.push(0);
      for (j = 0; j < all.length; j++) {
        if (i === j) {
          continue;
        }
        if (dominates(all[i], all[j])) {
          S[i].push(j);
        } else if (dominates(all[j], all[i])) {
          n[i]++;
        }
      }
      if (n[i] === 0) {
        all[i].rank = 0;
        fronts[0].push(i);
      }
    }
    var k = 0;
    while (fronts[k].length) {
      var nextFront = [];
      fronts[k].forEach(function (p) {
        S[p].forEach(function (q) {
          n[q]--;
          if (n[q] === 0) {
            all[q].rank = k + 1;
            nextFront.push(q);
          }
        });
      });
      k++;
      fronts.push(nextFront);
    }
    fronts.pop();
    return fronts.map(function (fr) {
      return fr.map(function (idx) {
        return all[idx];
      });
    });
  }

  function crowding(front) {
    front.forEach(function (p) {
      p.crowd = 0;
    });
    [0, 1].forEach(function (m) {
      front.sort(function (p, q) {
        return p.f[m] - q.f[m];
      });
      var span = front[front.length - 1].f[m] - front[0].f[m] || 1;
      front[0].crowd = front[front.length - 1].crowd = Infinity;
      for (var i = 1; i < front.length - 1; i++) {
        front[i].crowd += (front[i + 1].f[m] - front[i - 1].f[m]) / span;
      }
    });
  }

  function tournament() {
    var p = pop[Math.floor(rand() * pop.length)];
    var q = pop[Math.floor(rand() * pop.length)];
    if (p.rank !== q.rank) {
      return p.rank < q.rank ? p : q;
    }
    return p.crowd > q.crowd ? p : q;
  }

  function generation() {
    var children = [];
    while (children.length < POP) {
      var a = tournament().x;
      var b = tournament().x;
      var child = new Uint8Array(N);
      var cross = rand() < 0.9;
      for (var i = 0; i < N; i++) {
        child[i] = cross ? (rand() < 0.5 ? a[i] : b[i]) : a[i];
        if (rand() < 1.5 / N) {
          child[i] = 1 - child[i];
        }
      }
      children.push(evaluate(repair(child)));
    }
    select(pop.concat(children));
    gen++;
    if (GHOST_AT.indexOf(gen) >= 0) {
      ghosts.push(frontLine());
    }
  }

  function select(all) {
    var fronts = sortFronts(all);
    var out = [];
    for (var i = 0; i < fronts.length && out.length < POP; i++) {
      crowding(fronts[i]);
      if (out.length + fronts[i].length <= POP) {
        out = out.concat(fronts[i]);
      } else {
        fronts[i].sort(function (p, q) {
          return q.crowd - p.crowd;
        });
        out = out.concat(fronts[i].slice(0, POP - out.length));
      }
    }
    pop = out;
  }

  function front() {
    // distinct non-dominated points, sorted along the earthquake axis
    var seen = {};
    return pop
      .filter(function (p) {
        var key = p.f[0].toFixed(3) + '|' + p.f[1].toFixed(3);
        if (p.rank !== 0 || seen[key]) {
          return false;
        }
        seen[key] = true;
        return true;
      })
      .sort(function (p, q) {
        return p.f[0] - q.f[0];
      });
  }

  function frontLine() {
    return front().map(function (p) {
      return [p.f[0], p.f[1]];
    });
  }

  // Share of the 100 × 100 objective box dominated by the front.
  function hypervolume(fr) {
    var hv = 0;
    var prev = 100;
    fr.forEach(function (p) {
      hv += (100 - p.f[0]) * (prev - p.f[1]);
      prev = p.f[1];
    });
    return hv / 10000;
  }

  /* -------------------------------------------------------------------- state */

  function reset() {
    seed++;
    rand = SA.rng(seed * 104729);
    makeProblem();
    var start = [];
    for (var i = 0; i < POP; i++) {
      start.push(randomPolicy());
    }
    gen = 0;
    ghosts = [];
    picks = null;
    select(start);
    phase = 'run';
    clock = 0;
    say();
  }

  function finish() {
    var fr = front();
    var balanced = fr[0];
    fr.forEach(function (p) {
      if (Math.hypot(p.f[0], p.f[1]) < Math.hypot(balanced.f[0], balanced.f[1])) {
        balanced = p;
      }
    });
    picks = [
      { p: fr[0], label: 'earthquake-first' },
      { p: balanced, label: 'balanced' },
      { p: fr[fr.length - 1], label: 'flood-first' }
    ];
    phase = 'hold';
    clock = 0;
  }

  function step(dt) {
    clock += dt;
    if (phase === 'run') {
      while (clock >= GEN_MS && gen < GENS) {
        clock -= GEN_MS;
        generation();
        say();
      }
      if (gen >= GENS) {
        finish();
        say();
      }
    } else if (clock > 4200) {
      reset();
    }
  }

  function say() {
    if (hover) {
      return;
    }
    var fr = front();
    readout.innerHTML =
      'generation <b>' + gen + '</b> of ' + GENS +
      ' · <b>' + fr.length + '</b> plans on the frontier' +
      ' · covering <b>' + (hypervolume(fr) * 100).toFixed(0) + '%</b> of the space' +
      '<br>each dot is one plan · 100 = doing nothing · same budget for every plan';
  }

  /* --------------------------------------------------------------------- draw */

  function draw() {
    var f = SA.fit(canvas);
    var ctx = f.ctx;
    var w = f.w;
    var h = f.h;
    ctx.clearRect(0, 0, w, h);

    var left = 44;
    var right = 14;
    var top = 20;
    var bottom = 40;
    var pw = w - left - right;
    var ph = h - top - bottom;
    box = { left: left, top: top, pw: pw, ph: ph };

    function px(v) {
      return left + (v / 100) * pw;
    }
    function py(v) {
      return top + ph - (v / 100) * ph;
    }

    ctx.font = '10.5px ' + SA.MONO;
    ctx.lineWidth = 1;

    [0, 25, 50, 75, 100].forEach(function (t) {
      var y = Math.round(py(t)) + 0.5;
      var x = Math.round(px(t)) + 0.5;
      ctx.strokeStyle = t === 0 ? pal.axis : pal.grid;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + pw, y);
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + ph);
      ctx.stroke();
      ctx.fillStyle = pal.muted;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.fillText(String(t), left - 8, y);
      ctx.textAlign = 'center';
      ctx.fillText(String(t), x, top + ph + 13);
    });

    ctx.fillStyle = pal.text2;
    ctx.textAlign = 'right';
    ctx.fillText('earthquake disruption cost →', left + pw, top + ph + 30);
    ctx.textAlign = 'left';
    ctx.fillText('↑ flood disruption cost', left, top - 9);

    // no-rehabilitation reference
    var bx = px(100);
    var by = py(100);
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx - 4, by - 4);
    ctx.lineTo(bx + 4, by + 4);
    ctx.moveTo(bx - 4, by + 4);
    ctx.lineTo(bx + 4, by - 4);
    ctx.stroke();
    ctx.fillStyle = pal.text2;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('do nothing', bx - 10, by + 12);

    // earlier fronts: quiet lines that brighten with age
    ghosts.forEach(function (line, i) {
      ctx.beginPath();
      line.forEach(function (pt) {
        ctx.lineTo(px(pt[0]), py(pt[1]));
      });
      ctx.strokeStyle = SA.rgba(pal.muted, 0.28 + 0.14 * i);
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // dominated population
    pop.forEach(function (p) {
      if (p.rank !== 0) {
        ctx.beginPath();
        ctx.arc(px(p.f[0]), py(p.f[1]), 3, 0, Math.PI * 2);
        ctx.fillStyle = SA.rgba(pal.muted, 0.7);
        ctx.fill();
      }
    });

    // current front
    var fr = front();
    ctx.beginPath();
    fr.forEach(function (p) {
      ctx.lineTo(px(p.f[0]), py(p.f[1]));
    });
    ctx.strokeStyle = SA.rgba(pal.s1, 0.5);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    fr.forEach(function (p) {
      dot(ctx, px(p.f[0]), py(p.f[1]), 4, pal.s1);
    });

    // named policies once the search has finished
    if (picks) {
      var alpha = Math.min(1, clock / 500);
      ctx.globalAlpha = alpha;
      picks.forEach(function (pick, i) {
        var x = px(pick.p.f[0]);
        var y = py(pick.p.f[1]);
        var lx = x + (i === 2 ? 14 : 30);
        var ly = y - (i === 0 ? 4 : i === 1 ? 30 : 26);
        var tw = ctx.measureText(pick.label).width;
        if (lx + tw > left + pw) {
          lx = left + pw - tw; // keep the label inside the plot
          ly = y - 26;
        }
        ly = Math.max(top + 8, ly);
        ctx.strokeStyle = pal.text2;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 5, y - 5);
        ctx.lineTo(lx - 3, ly + 4);
        ctx.stroke();
        dot(ctx, x, y, 5, pal.text);
        ctx.fillStyle = pal.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(pick.label, lx, ly);
      });
      ctx.globalAlpha = 1;
    }

    if (hover) {
      ctx.beginPath();
      ctx.arc(px(hover.f[0]), py(hover.f[1]), 8, 0, Math.PI * 2);
      ctx.strokeStyle = pal.text;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function dot(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = pal.surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /* -------------------------------------------------------------------- hover */

  canvas.addEventListener('pointermove', function (e) {
    if (!box) {
      return;
    }
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var best = null;
    var bestD = 24;
    pop.forEach(function (p) {
      var d = Math.hypot(box.left + (p.f[0] / 100) * box.pw - mx, box.top + box.ph - (p.f[1] / 100) * box.ph - my);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    });
    if (best) {
      hover = best;
      readout.innerHTML =
        'earthquake cost <b>' + best.f[0].toFixed(1) + '</b> · flood cost <b>' + best.f[1].toFixed(1) + '</b>' +
        '<br><b>' + best.count + '</b> links repaired · ' +
        (best.rank === 0 ? 'on the frontier' : 'beaten on both counts by another plan');
    } else if (hover) {
      hover = null;
      say();
    }
    if (!loop.isPlaying()) {
      draw();
    }
  });

  canvas.addEventListener('pointerleave', function () {
    if (hover) {
      hover = null;
      say();
      if (!loop.isPlaying()) {
        draw();
      }
    }
  });

  /* --------------------------------------------------------------------- boot */

  reset();

  var loop = SA.loop(root, function (dt) {
    step(dt);
    draw();
  });

  SA.controls(root, loop, reset, draw);
  SA.onResize(canvas, draw);

  if (SA.reducedMotion) {
    while (gen < GENS) {
      generation();
    }
    finish();
    clock = 1000;
    say();
  }
  draw();
})();
