/* Shared helpers for the page and its canvas animations. */
(function () {
  'use strict';

  var SA = (window.SA = {});

  SA.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Seeded PRNG (mulberry32) so every run of a demo is reproducible from its seed.
  SA.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Size a canvas to its CSS box at device resolution; returns a context in CSS pixels.
  SA.fit = function (canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  };

  // Chart roles come from CSS custom properties, so each track themes its own canvases.
  SA.palette = function (el) {
    var s = getComputedStyle(el);
    function v(name) {
      return s.getPropertyValue(name).trim();
    }
    return {
      surface: v('--surface'),
      surface2: v('--surface-2'),
      text: v('--text'),
      text2: v('--text-2'),
      muted: v('--muted'),
      grid: v('--grid'),
      axis: v('--axis'),
      s1: v('--series-1'),
      s2: v('--series-2'),
      s3: v('--series-3')
    };
  };

  SA.rgba = function (hex, alpha) {
    var h = hex.replace('#', '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  };

  SA.MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace';

  // Runs frame(dt, now) only while `el` is on screen, the tab is visible and the loop is playing.
  SA.loop = function (el, frame) {
    var raf = 0;
    var last = 0;
    var onScreen = false;
    var playing = !SA.reducedMotion;

    function tick(now) {
      raf = 0;
      var dt = last ? Math.min(64, now - last) : 16;
      last = now;
      frame(dt, now);
      schedule();
    }

    function schedule() {
      if (!raf && onScreen && playing && !document.hidden) {
        raf = requestAnimationFrame(tick);
      }
    }

    function halt() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      last = 0;
    }

    new IntersectionObserver(
      function (entries) {
        onScreen = entries[0].isIntersecting;
        if (onScreen) {
          schedule();
        } else {
          halt();
        }
      },
      { rootMargin: '80px' }
    ).observe(el);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        halt();
      } else {
        schedule();
      }
    });

    return {
      play: function () {
        playing = true;
        schedule();
      },
      pause: function () {
        playing = false;
        halt();
      },
      isPlaying: function () {
        return playing;
      }
    };
  };

  // Wires the Pause / Restart buttons of a demo card to its loop.
  SA.controls = function (root, loop, onReset, onStaticDraw) {
    var toggle = root.querySelector('[data-act="toggle"]');
    var reset = root.querySelector('[data-act="reset"]');

    function label() {
      if (toggle) {
        toggle.textContent = loop.isPlaying() ? 'Pause' : 'Play';
      }
    }

    if (toggle) {
      toggle.addEventListener('click', function () {
        if (loop.isPlaying()) {
          loop.pause();
        } else {
          loop.play();
        }
        label();
      });
    }
    if (reset) {
      reset.addEventListener('click', function () {
        onReset();
        if (!loop.isPlaying() && onStaticDraw) {
          onStaticDraw();
        }
      });
    }
    label();
  };

  SA.onResize = function (el, fn) {
    if ('ResizeObserver' in window) {
      new ResizeObserver(fn).observe(el);
    } else {
      window.addEventListener('resize', fn);
    }
  };

  /* ------------------------------------------------------------- page chrome */

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.querySelector('.nav__toggle');
    var links = document.getElementById('nav-links');

    if (toggle && links) {
      toggle.addEventListener('click', function () {
        var open = links.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
      });
      links.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') {
          links.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Reveal blocks as they enter the viewport.
    var reveals = document.querySelectorAll('.reveal');
    var revealer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            revealer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px' }
    );
    reveals.forEach(function (el) {
      revealer.observe(el);
    });

    // Highlight the nav link of the section currently in view.
    var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav__links a'));
    var sections = navLinks
      .map(function (a) {
        return document.querySelector(a.getAttribute('href'));
      })
      .filter(Boolean);

    function spy() {
      var y = window.scrollY + window.innerHeight * 0.35;
      var current = null;
      sections.forEach(function (sec) {
        if (sec.offsetTop <= y) {
          current = sec;
        }
      });
      navLinks.forEach(function (a) {
        var on = current && a.getAttribute('href') === '#' + current.id;
        if (on) {
          a.setAttribute('aria-current', 'true');
        } else {
          a.removeAttribute('aria-current');
        }
      });
    }
    window.addEventListener('scroll', spy, { passive: true });
    spy();

    var year = document.querySelector('[data-year]');
    if (year) {
      year.textContent = String(new Date().getFullYear());
    }
  });
})();
