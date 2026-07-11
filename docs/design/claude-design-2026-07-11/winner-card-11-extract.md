# Winner extract — Card Explorations direction 11 ("Final · the winner")

Source: `Card Explorations.dc.html` (Claude Design prototype, 2026-07-11).
Winner recipe per the page header: **live border on a white body · big dot eyebrow · credits badge · PRE counter · corner-morph actions · Manrope + IBM Plex Mono**.

Everything below is verbatim from the prototype source (template syntax: `{{ }}` bindings, `sc-if`/`sc-for` are the prototype's conditional/loop tags, `style-hover`/`style-active` are pseudo-state style attributes).

---

## 1. Design tokens (CSS custom properties, light + dark)

```css
.dp-root {
  --canvas: #f8fafc; --surface: #fefeff; --surface-2: #f1f5f9;
  --border: #e2e8f0; --border-strong: #cbd5e1; --border-faint: #eef2f7;
  --text: #0f172a; --text-2: #475569; --text-3: #64748b; --text-4: #94a3b8;
  --complete: #34d399; --complete-text: #065f46; --complete-tint: #ecfdf5;
  --available: #fbbf24; --available-text: #92400e; --available-tint: #fffbeb;
  --waived: #a78bfa;  --waived-text: #5b21b6;  --waived-tint: #f5f3ff;
  --drop: #60a5fa;    --drop-text: #1e40af;    --drop-tint: #eff6ff;
  --destructive: #ef4444; --destructive-text: #991b1b; --destructive-tint: #fef2f2;
  --cat-math: #4f46e5;    --cat-math-tint: #eef2ff;
  --cat-science: #0f766e; --cat-science-tint: #f0fdfa;
  --cat-core: #475569;    --cat-core-tint: #f1f5f9;
  --cat-liberal: #b83280; --cat-liberal-tint: #fdf2f8;
  --cat-elective: #0e7490; --cat-elective-tint: #ecfeff;
  --cat-fws: #b45309;     --cat-fws-tint: #fff7ed;
  --cat-pe: #57534e;      --cat-pe-tint: #f5f5f4;
  --complete-bd: color-mix(in srgb, var(--complete) 55%, transparent);
  --available-bd: color-mix(in srgb, var(--available) 55%, transparent);
  --waived-bd: color-mix(in srgb, var(--waived) 55%, transparent);
  --drop-bd: color-mix(in srgb, var(--drop) 55%, transparent);
  --destructive-bd: color-mix(in srgb, var(--destructive) 55%, transparent);
  --destructive-glow: color-mix(in srgb, var(--destructive) 45%, transparent);
  --destructive-ring: color-mix(in srgb, var(--destructive) 22%, transparent);
  --shadow-md: 0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.08);
  --shadow-xl: 0 20px 25px -5px rgb(15 23 42 / 0.10), 0 8px 10px -6px rgb(15 23 42 / 0.10);
  --card-rest-shadow: 0 1px 2px rgb(15 23 42 / 0.05);
}
.dp-root[data-theme="dark"] {
  --canvas: #0b1120; --surface: #0f172a; --surface-2: #1e293b;
  --border: #1e293b; --border-strong: #334155; --border-faint: #16203a;
  --text: #f1f5f9; --text-2: #cbd5e1; --text-3: #94a3b8; --text-4: #64748b;
  --complete: #34d399;    --complete-text: #a7f3d0;    --complete-tint: rgb(6 78 59 / 0.5);
  --available: #fbbf24;   --available-text: #fde68a;   --available-tint: rgb(120 53 15 / 0.4);
  --waived: #a78bfa;      --waived-text: #ddd6fe;      --waived-tint: rgb(76 29 149 / 0.4);
  --drop: #60a5fa;        --drop-text: #bfdbfe;        --drop-tint: rgb(30 58 138 / 0.4);
  --destructive: #f87171; --destructive-text: #fecaca; --destructive-tint: rgb(127 29 29 / 0.4);
  --cat-math: #a5b4fc;      --cat-math-tint: rgb(49 46 129 / 0.4);
  --cat-science: #5eead4;   --cat-science-tint: rgb(19 78 74 / 0.4);
  --cat-core: #cbd5e1;      --cat-core-tint: rgb(51 65 85 / 0.4);
  --cat-liberal: #f0abfc;   --cat-liberal-tint: rgb(112 26 117 / 0.4);
  --cat-elective: #67e8f9;  --cat-elective-tint: rgb(22 78 99 / 0.4);
  --cat-fws: #fdba74;      --cat-fws-tint: rgb(120 53 15 / 0.4);
  --cat-pe: #d6d3d1;       --cat-pe-tint: rgb(68 64 60 / 0.4);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.4);
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5);
  --card-rest-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
}
```

## 2. Keyframes + reduced motion

```css
@keyframes sweepXA { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes sweepXB { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes sweepYA { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes sweepYB { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes popA { 0% { transform: scale(0.3); } 60% { transform: scale(1.22); } 100% { transform: scale(1); } }
@keyframes popB { 0% { transform: scale(0.3); } 60% { transform: scale(1.22); } 100% { transform: scale(1); } }
@keyframes pulseOnce {
  0% { box-shadow: 0 0 0 0 var(--destructive-glow, rgb(239 68 68 / 0.45)); }
  70% { box-shadow: 0 0 0 10px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@property --bA { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
@keyframes borderSpin { to { --bA: 360deg; } }
@keyframes heartbeat {
  0% { box-shadow: 0 0 0 0 var(--destructive-ring); }
  70% { box-shadow: 0 0 0 7px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes tickSpin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

The A/B duplicates (`sweepXA`/`sweepXB`, `popA`/`popB`) exist so consecutive state changes can retrigger the animation by alternating the animation name (`sweeps` counter, `n % 2 ? "A" : "B"`).

## 3. Direction 11 card markup (verbatim)

```html
<section data-screen-label="11 Final" style="padding:26px 32px 6px; border-bottom:1px solid var(--border)">
  <div style="display:flex; align-items:baseline; gap:10px; margin-bottom:14px; flex-wrap:wrap">
    <span style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--text-4)">11</span>
    <h2 style="margin:0; font-family:'Manrope',sans-serif; font-size:15px; font-weight:700; letter-spacing:-0.01em">Final <span style="font-size:10px; font-weight:500; color:var(--text-4)">· the winner</span></h2>
    <span style="font-size:11px; color:var(--text-3)">live border on a white body · big dot eyebrow · credits badge · PRE counter · corner-morph actions · Manrope + IBM Plex Mono</span>
  </div>
  <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:stretch">
    <sc-for list="{{ d11 }}" as="s" hint-placeholder-count="7">
      <div style="width:200px; display:flex; flex-direction:column; gap:5px">
        <sc-if value="{{ s.isEmpty }}" hint-placeholder-val="{{ false }}">
          <div onMouseEnter="{{ s.enter }}" onMouseLeave="{{ s.leave }}" style="flex:1; min-height:104px; border:1.5px dashed var(--border-strong); border-radius:8px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer; transform:{{ s.ty }}; transition:transform .16s ease" style-active="transform:scale(0.97)">
            <span style="font-family:'Manrope',sans-serif; font-size:9px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; color:var(--text-4)">Elective</span>
            <span style="font-family:'Manrope',sans-serif; font-size:11px; font-weight:600; color:var(--drop-text)">＋ Find a class</span>
          </div>
        </sc-if>
        <sc-if value="{{ s.notEmpty }}" hint-placeholder-val="{{ true }}">
          <div onMouseEnter="{{ s.enter }}" onMouseLeave="{{ s.leave }}" onClick="{{ s.click }}" style="flex:1; position:relative; display:flex; flex-direction:column; min-height:104px; border-radius:8px; cursor:pointer; padding:2px; background:{{ s.bd }}; font-family:'Manrope',sans-serif; transform:{{ s.ty }}; box-shadow:{{ s.shadow }}; transition:transform .16s ease, box-shadow .2s ease" style-active="transform:scale(0.97)">
            <div style="position:absolute; inset:0; border-radius:8px; overflow:hidden; pointer-events:none">
              <div style="position:absolute; inset:0; background:conic-gradient(from var(--bA), transparent 0deg, {{ s.glint }} 55deg, transparent 115deg, transparent 180deg, {{ s.glint }} 235deg, transparent 295deg); animation:borderSpin 5.5s linear infinite"></div>
              <div style="position:absolute; inset:0; background:conic-gradient(from var(--bA), transparent 0deg, {{ s.glint }} 55deg, transparent 115deg, transparent 180deg, {{ s.glint }} 235deg, transparent 295deg); animation:borderSpin 1.3s linear infinite; opacity:{{ s.actOp }}; transition:opacity .3s ease"></div>
            </div>
            <div style="position:relative; flex:1; display:flex; flex-direction:column; gap:5px; border-radius:6px; overflow:hidden; background:var(--surface); padding:9px 10px 30px">
              <div style="display:flex; align-items:center; gap:5px">
                <span style="display:inline-flex; align-items:center; gap:6px; min-width:0"><span style="width:8px; height:8px; border-radius:50%; flex:none; background:{{ s.catColor }}"></span><span style="font-family:'Manrope',sans-serif; font-size:11px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis">{{ s.code }}</span></span>
                <sc-if value="{{ s.hasGlyph }}" hint-placeholder-val="{{ false }}"><span style="margin-left:auto; width:13px; height:13px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center; font-size:8.5px; font-weight:700; color:#fff; background:{{ s.rail }}; animation:{{ s.popAnim }}">{{ s.glyph }}</span></sc-if>
                <sc-if value="{{ s.noGlyph }}" hint-placeholder-val="{{ true }}"><span style="margin-left:auto"></span></sc-if>
                <span style="font-family:'IBM Plex Mono',monospace; font-size:8.5px; font-weight:500; flex:none; color:var(--text-2); background:var(--surface-2); border:1px solid var(--border); border-radius:9999px; padding:1px 7px; line-height:1.5">{{ s.cr }} cr</span>
              </div>
              <div style="font-size:12px; font-weight:600; line-height:1.38; color:var(--text); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden">{{ s.title }}</div>
              <sc-if value="{{ s.hasLine }}" hint-placeholder-val="{{ false }}"><div style="font-size:9.5px; font-weight:700; color:{{ s.ink }}">{{ s.line }}</div></sc-if>
              <div style="position:absolute; left:10px; right:10px; bottom:6px; display:flex; align-items:center; gap:6px">
                <sc-if value="{{ s.showTag }}" hint-placeholder-val="{{ true }}"><span style="font-size:8.5px; font-weight:700; padding:0 4px; border-radius:3px; color:{{ s.catColor }}; background:{{ s.catTint }}; line-height:1.7">{{ s.tag }}</span></sc-if>
                <span title="Prerequisites met" style="font-family:'IBM Plex Mono',monospace; font-size:8.5px; font-weight:500; color:{{ s.preC }}">PRE {{ s.preText }}{{ s.preGlyph }}</span>
                <sc-if value="{{ s.showTerms }}" hint-placeholder-val="{{ true }}"><span style="font-family:'IBM Plex Mono',monospace; font-size:8.5px; color:var(--text-4)">{{ s.termsText }}</span></sc-if>
              </div>
              <div style="position:absolute; right:6px; bottom:4px; height:20px; width:{{ s.actW }}; border-radius:10px; background:var(--surface-2); overflow:hidden; transition:width .22s cubic-bezier(.3,1.2,.4,1); display:flex; align-items:center; justify-content:center">
                <span style="position:absolute; font-size:11px; font-weight:700; color:var(--text-3); opacity:{{ s.dotsOp }}; transition:opacity .12s; line-height:1">⋯</span>
                <div style="display:flex; gap:1px; opacity:{{ s.actOp }}; transition:opacity .16s ease .06s; pointer-events:{{ s.actPe }}">
                  <button onClick="{{ s.done }}" title="Mark completed" style="appearance:none; border:none; font-family:inherit; font-size:9.5px; font-weight:700; width:26px; height:16px; border-radius:8px; cursor:pointer; background:transparent; color:{{ s.doneC }}" style-hover="background:var(--surface)">✓</button>
                  <button onClick="{{ s.taking }}" title="Mark as currently taking" style="appearance:none; border:none; font-family:inherit; font-size:9.5px; font-weight:700; width:26px; height:16px; border-radius:8px; cursor:pointer; background:transparent; color:{{ s.takingC }}" style-hover="background:var(--surface)">◷</button>
                  <button onClick="{{ s.clearS }}" title="Clear status" style="appearance:none; border:none; font-family:inherit; font-size:9.5px; font-weight:700; width:26px; height:16px; border-radius:8px; cursor:pointer; background:transparent; color:var(--text-4)" style-hover="background:var(--surface)">✕</button>
                  <button title="More actions" style="appearance:none; border:none; font-family:inherit; font-size:9.5px; font-weight:700; width:26px; height:16px; border-radius:8px; cursor:pointer; background:transparent; color:var(--text-4)" style-hover="background:var(--surface)">⋯</button>
                </div>
              </div>
            </div>
          </div>
        </sc-if>
        <div style="font-family:'IBM Plex Mono',monospace; font-size:8.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--text-4)">{{ s.label }}</div>
      </div>
    </sc-for>
  </div>
</section>
```

## 4. Side-peek markup (verbatim; shared panel, content is data-driven per card)

```html
<!-- scrim -->
<div onClick="{{ closePeek }}" style="position:fixed; inset:0; z-index:50; background:rgb(15 23 42 / 0.35); opacity:{{ bdOp }}; pointer-events:{{ bdPe }}; transition:opacity .25s ease"></div>
<!-- panel: slides in from right, 480px, spring-ish easing -->
<div style="position:fixed; top:0; right:0; bottom:0; z-index:51; width:min(480px, 92vw); box-sizing:border-box; background:var(--surface); border-left:1px solid var(--border); box-shadow:var(--shadow-xl); transform:{{ panelTf }}; transition:transform .34s cubic-bezier(.22,1.12,.36,1); display:flex; flex-direction:column; overflow-y:auto; font-family:'DM Sans',system-ui,sans-serif; color:var(--text)">
  <div style="display:flex; align-items:center; gap:10px; padding:18px 22px 0">
    <span style="font-family:'DM Mono',monospace; font-size:12px; letter-spacing:.05em; color:var(--text-3)">{{ pkCode }}</span>
    <button onClick="{{ closePeek }}" title="Close" style="appearance:none; border:none; margin-left:auto; width:26px; height:26px; border-radius:6px; cursor:pointer; background:transparent; color:var(--text-3); font-size:14px; line-height:1" style-hover="background:var(--surface-2)">✕</button>
  </div>
  <div style="padding:6px 22px 0; font-size:18px; font-weight:600; letter-spacing:-0.02em; line-height:1.3">{{ pkTitle }}</div>
  <div style="display:flex; align-items:center; gap:6px; padding:10px 22px 0; flex-wrap:wrap">
    <span style="font-family:'DM Mono',monospace; font-size:10px; color:var(--text-2); border:1px solid var(--border); border-radius:5px; padding:2px 7px">{{ pkCr }} credits</span>
    <span style="font-size:10px; font-weight:600; padding:2px 7px; border-radius:5px; color:{{ pkCatColor }}; background:{{ pkCatTint }}">{{ pkTag }}</span>
    <span style="font-family:'DM Mono',monospace; font-size:10px; color:var(--text-3); border:1px solid var(--border); border-radius:5px; padding:2px 7px">{{ pkOffered }}</span>
  </div>
  <div style="padding:20px 22px 0">
    <div style="font-size:9.5px; font-weight:600; letter-spacing:.09em; text-transform:uppercase; color:var(--text-4); margin-bottom:6px">Description</div>
    <div style="font-size:12px; line-height:1.6; color:var(--text-2)">{{ pkDesc }}</div>
  </div>
  <div style="padding:20px 22px 0">
    <div style="font-size:9.5px; font-weight:600; letter-spacing:.09em; text-transform:uppercase; color:var(--text-4); margin-bottom:8px">Prerequisites</div>
    <sc-if value="{{ pkNoPre }}" hint-placeholder-val="{{ false }}">
      <div style="font-size:11.5px; color:var(--text-3)">No prerequisites — take it any semester.</div>
    </sc-if>
    <sc-if value="{{ pkHasPre }}" hint-placeholder-val="{{ true }}">
      <div style="display:inline-flex; align-items:center; gap:6px; border:1px solid var(--border-strong); border-radius:6px; padding:4px 10px; background:var(--surface-2)">
        <span style="font-family:'DM Mono',monospace; font-size:10.5px; font-weight:500; color:var(--text)">{{ pkCode }}</span>
        <span style="font-size:9.5px; color:var(--text-4)">this course</span>
      </div>
      <div style="margin:0 0 0 12px; width:2px; height:12px; background:var(--border-strong)"></div>
      <div style="border-left:2px solid var(--border-strong); margin-left:12px; padding:2px 0 2px 14px; display:flex; flex-direction:column; gap:6px">
        <sc-for list="{{ pkPrereqs }}" as="n" hint-placeholder-count="2">
          <div style="display:flex; align-items:center; gap:8px">
            <span style="width:8px; height:8px; border-radius:50%; flex:none; background:{{ n.dot }}"></span>
            <span style="display:inline-flex; align-items:center; font-family:'DM Mono',monospace; font-size:10.5px; border:1px solid {{ n.bd }}; color:{{ n.c }}; border-radius:6px; padding:3px 9px">{{ n.code }}</span>
            <span style="font-size:10px; color:var(--text-4)">{{ n.noteText }}</span>
          </div>
        </sc-for>
      </div>
      <div style="display:flex; align-items:center; gap:12px; margin-top:10px; font-size:9.5px; color:var(--text-4)">
        <span style="display:inline-flex; align-items:center; gap:4px"><span style="width:7px; height:7px; border-radius:50%; background:var(--complete)"></span> met</span>
        <span style="display:inline-flex; align-items:center; gap:4px"><span style="width:7px; height:7px; border-radius:50%; background:var(--destructive)"></span> not met</span>
      </div>
    </sc-if>
  </div>
  <div style="padding:20px 22px 24px; margin-top:auto">
    <div style="border-top:1px solid var(--border); padding-top:14px; display:flex; gap:8px">
      <button style="appearance:none; border:none; flex:1; font-family:'DM Sans',sans-serif; font-size:11.5px; font-weight:600; padding:8px 14px; border-radius:6px; cursor:pointer; background:var(--text); color:var(--canvas)" style-hover="opacity:0.9">Place in plan</button>
      <button style="appearance:none; border:1px solid var(--border-strong); flex:none; font-family:'DM Sans',sans-serif; font-size:11.5px; font-weight:600; padding:8px 14px; border-radius:6px; cursor:pointer; background:transparent; color:var(--text-2)" style-hover="background:var(--surface-2)">✓ Mark complete</button>
    </div>
    <div style="font-size:9.5px; color:var(--text-4); margin-top:8px">Preview only — actions aren't wired in this gallery.</div>
  </div>
</div>
```

Note: the side-peek in this gallery still uses DM Sans / DM Mono (the "current pairing" at the time); the winning card itself is Manrope + IBM Plex Mono. When implementing, the panel should presumably adopt Manrope + IBM Plex Mono too.

## 5. Component logic (verbatim JS driving states, sweeps, and per-status side-peek data)

```js
class Component extends DCLogic {
  state = { dark: false, zoom: 1, hover: null, overrides: {}, sweeps: {}, peek: null, peekOpen: false };

  componentDidMount() {
    this.rm = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this._esc = (e) => { if (e.key === "Escape") this.closePeek(); };
    window.addEventListener("keydown", this._esc);
  }
  componentWillUnmount() { window.removeEventListener("keydown", this._esc); }

  slots() {
    return [
      { key: "available", code: "CS 2110", title: "Object-Oriented Programming and Data Structures", cr: "4", cat: "core", tag: "Eng", terms: ["FA", "SP"], pre: [1, 1],
        desc: "Intermediate programming in a high-level language and introduction to computer science. Topics include object-oriented programming, recursion, data structures, graphs, and asymptotic complexity.",
        offered: "Fall · Spring", prereqs: [{ code: "CS 1110", met: true, note: "completed FA 25" }, { code: "CS 1112", met: false, note: "or this (MATLAB track)" }] },
      { key: "completed", code: "MATH 1920", title: "Multivariable Calculus for Engineers", cr: "4", cat: "math", tag: "Math", terms: ["FA", "SP", "SU"], pre: [1, 1],
        desc: "Introduction to multivariable calculus: partial derivatives, multiple integrals, line integrals, vector fields, and the theorems of Green, Stokes, and Gauss.",
        offered: "Fall · Spring · Summer", prereqs: [{ code: "MATH 1910", met: true, note: "completed FA 25" }] },
      { key: "in-progress", code: "CHEM 2090", title: "Engineering General Chemistry", cr: "4", cat: "science", tag: "Sci", terms: ["FA", "SP"], pre: [0, 0],
        desc: "Fundamentals of general chemistry for engineers: stoichiometry, thermodynamics, kinetics, and equilibrium, with applications drawn from engineering practice.",
        offered: "Fall · Spring", prereqs: [] },
      { key: "waived", code: "ELECTIVE", title: "Liberal Studies", cr: "3", cat: "liberal", tag: "Liberal", terms: [], pre: [0, 0], bucket: true,
        desc: "Any course carrying a liberal studies distribution (CA, HA, LA, SBA, …). Six are required across the degree; this bucket tracks one of them. This one was waived by your advisor.",
        offered: "Every term", prereqs: [] },
      { key: "blocked", code: "CS 3110", title: "Data Structures and Functional Programming", cr: "4", cat: "core", tag: "Eng", terms: ["FA", "SP"], pre: [0, 1],
        desc: "Advanced programming course that emphasizes functional programming, data structures, interpreters, and formal reasoning about program correctness.",
        offered: "Fall · Spring", prereqs: [{ code: "CS 2110", met: false, note: "planned — Fall of year 2" }, { code: "CS 2112", met: false, note: "honors alternative" }] },
      { key: "warning", code: "PHYS 2213", title: "Physics II: Electromagnetism", cr: "4", cat: "science", tag: "Sci", terms: ["FA"], pre: [2, 2],
        desc: "Electrostatics, circuits, magnetism, and electromagnetic waves, with calculus throughout. Second course in the introductory physics sequence for engineers.",
        offered: "Fall only", prereqs: [{ code: "PHYS 1112", met: true, note: "completed" }, { code: "MATH 1920", met: true, note: "coreq — met" }] },
      { key: "empty" }
    ];
  }

  sm(v) {
    return {
      available: { rail: "transparent", bg: "var(--surface)", bd: "var(--border)", ink: "var(--text-3)", line: "", glyph: "", label: "Available" },
      completed: { rail: "var(--complete)", bg: "var(--complete-tint)", bd: "var(--complete-bd)", ink: "var(--complete-text)", line: "", glyph: "✓", label: "Completed" },
      "in-progress": { rail: "var(--drop)", bg: "var(--drop-tint)", bd: "var(--drop-bd)", ink: "var(--drop-text)", line: "In progress", glyph: "◷", label: "In progress" },
      waived: { rail: "var(--waived)", bg: "var(--waived-tint)", bd: "var(--waived-bd)", ink: "var(--waived-text)", line: "Waived", glyph: "–", label: "Waived" },
      blocked: { rail: "var(--destructive)", bg: "var(--destructive-tint)", bd: "var(--destructive-bd)", ink: "var(--destructive-text)", line: "Needs CS 2110 first", glyph: "✕", label: "Blocked" },
      warning: { rail: "var(--available)", bg: "var(--available-tint)", bd: "var(--available-bd)", ink: "var(--available-text)", line: "Usually offered in Fall only", glyph: "!", label: "Warning" }
    }[v];
  }

  setStatus(id, v) {
    this.setState((s) => {
      if ((s.overrides[id] || null) === v) return null;
      return {
        overrides: Object.assign({}, s.overrides, { [id]: v }),
        sweeps: Object.assign({}, s.sweeps, { [id]: (s.sweeps[id] || 0) + 1 })
      };
    });
  }

  openPeek(c) { if (c && c.key !== "empty") this.setState({ peek: c, peekOpen: true }); }
  closePeek() { this.setState({ peekOpen: false }); }

  buildDir(dir, reveal, axis) {
    const showTerms = this.props.showTermChips !== false;
    const showCats = this.props.showCategoryTags !== false;
    const lift = this.props.hoverLift == null ? 3 : this.props.hoverLift;
    const rm = this.rm;
    return this.slots().map((c, i) => {
      const id = dir + "-" + i;
      const h = this.state.hover === id;
      const ty = h && !rm ? "translateY(-" + lift + "px)" : "translateY(0px)";
      const enter = () => this.setState({ hover: id });
      const leave = () => this.setState((s) => (s.hover === id ? { hover: null } : null));
      if (c.key === "empty") {
        return { id, key: id, isEmpty: true, notEmpty: false, label: "Empty slot", ty, enter, leave };
      }
      const base = c.key;
      const v = this.state.overrides[id] || base;
      const m = this.sm(v);
      const n = this.state.sweeps[id] || 0;
      const ab = n % 2 ? "A" : "B";
      const railAnim = n ? "sweep" + axis.toUpperCase() + ab + " .5s cubic-bezier(.2,0,.2,1)" : "none";
      const popAnim = n ? "pop" + ab + " .45s cubic-bezier(.34,1.56,.64,1)" : "none";
      let actOp = h ? 1 : 0, actTf = "none";
      if (reveal === "fade") actTf = h ? "translateY(0px)" : "translateY(5px)";
      if (reveal === "slide") actTf = h ? "translateX(0px)" : "translateX(10px)";
      if (reveal === "swap") actTf = h ? "scale(1)" : "scale(0.96)";
      const doneOn = v === "completed", takingOn = v === "in-progress";
      const clearTo = base === "completed" || base === "in-progress" || base === "waived" ? "available" : base;
      const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
      const preTotal = c.pre[1], preOk = c.pre[0] >= preTotal;
      return {
        id, key: id, isEmpty: false, notEmpty: true,
        code: c.code, title: c.title, cr: c.cr, tag: c.tag,
        codeSub: c.code.split(" ")[0], codeNum: c.code.split(" ").slice(1).join(" "),
        catColor: "var(--cat-" + c.cat + ")", catTint: "var(--cat-" + c.cat + "-tint)",
        terms: c.terms.map((t) => ({ t })),
        termsText: c.terms.join(" · "),
        showTag: showCats, showTerms: showTerms && c.terms.length > 0,
        v, rail: m.rail, bg: m.bg, bd: m.bd, ink: m.ink,
        glyph: m.glyph, hasGlyph: !!m.glyph, noGlyph: !m.glyph, label: m.label,
        line: m.line, hasLine: !!m.line,
        lineShort: m.line.replace(" first", "").replace("Usually offered in ", ""),
        ty, shadow: h ? "var(--shadow-md)" : "var(--card-rest-shadow)",
        actOp, actTf, actPe: h ? "auto" : "none",
        stubOp: reveal === "swap" ? (h ? 0 : 1) : 1,
        metaOp: h ? 1 : 0,
        actW: reveal === "corner" ? (h ? "116px" : "24px") : "auto",
        dotsOp: reveal === "corner" && !h ? 1 : 0,
        railAnim, popAnim,
        spineBg: v === "available" ? "var(--border)" : m.rail,
        spineGlow: v === "blocked" ? "0 0 12px 1px var(--destructive-glow)" : "none",
        intro: dir === "d3" && v === "blocked" ? "pulseOnce 1.2s ease-out .6s 1" : "none",
        bd4: v === "blocked" ? "var(--destructive-bd)" : "var(--border)",
        dotBg: v === "available" ? "var(--border-strong)" : m.rail,
        nodeBd: v === "available" ? "var(--border-strong)" : m.rail,
        nodeBg: v === "completed" ? "var(--complete)" : "var(--surface)",
        nodeC: v === "completed" ? "#fff" : (v === "available" ? "var(--text-4)" : m.ink),
        nodeRing: v === "blocked" ? "0 0 0 4px var(--destructive-ring)" : "none",
        preText: preTotal ? c.pre[0] + "/" + preTotal : "—",
        preGlyph: preTotal ? (preOk ? " ✓" : " ✕") : "",
        preC: !preTotal ? "var(--text-4)" : preOk ? "var(--complete-text)" : "var(--destructive-text)",
        crW: Math.min(100, (parseInt(c.cr, 10) / 5) * 100) + "%",
        glint: v === "available" ? "var(--border-strong)" : m.rail,
        sheenBg: (function () {
          const base = v === "available" ? "var(--border)" : m.rail;
          return "linear-gradient(90deg, " + base + " 0%, color-mix(in srgb, " + base + " 35%, white) 50%, " + base + " 100%)";
        })(),
        heartbeat: v === "blocked" ? "heartbeat 2.6s ease-in-out infinite" : "none",
        tickAnim: v === "in-progress" ? "tickSpin 6s linear infinite" : "none",
        doneC: doneOn ? "var(--complete-text)" : "var(--text-3)",
        takingC: takingOn ? "var(--drop-text)" : "var(--text-3)",
        enter, leave,
        click: () => this.openPeek(c),
        done: (e) => { stop(e); this.setStatus(id, doneOn ? (base === "completed" ? "available" : base) : "completed"); },
        taking: (e) => { stop(e); this.setStatus(id, takingOn ? (base === "in-progress" ? "available" : base) : "in-progress"); },
        clearS: (e) => { stop(e); this.setStatus(id, clearTo); }
      };
    });
  }

  // Peek data mapping (from renderVals()):
  // d11 is built as: d11: this.buildDir("d11", "corner", "x"),
  // panelTf: peekOpen ? "translateX(0px)" : "translateX(510px)",
  // bdOp: peekOpen ? 1 : 0, bdPe: peekOpen ? "auto" : "none",
  // pkCode/pkTitle/pkCr/pkTag/pkOffered/pkDesc from the clicked slot,
  // pkCatColor: "var(--cat-" + p.cat + ")", pkCatTint: "var(--cat-" + p.cat + "-tint)",
  // pkPrereqs: prereqs.map(x => ({ code: x.code, noteText: x.note, met: x.met,
  //   dot: x.met ? "var(--complete)" : "var(--destructive)",
  //   c:   x.met ? "var(--complete-text)" : "var(--destructive-text)",
  //   bd:  x.met ? "var(--complete-bd)" : "var(--destructive-bd)" })),
  // pkHasPre: pre.length > 0, pkNoPre: !!peek && pre.length === 0
}
```

## 6. Per-status behavior summary (direction 11)

Card chassis (all states): 200px column, min-height 104px, radius 8px, 2px padding ring whose
`background` is the status border color (`s.bd`); inside, white body (`--surface`) radius 6px,
padding 9px 10px 30px. Two conic-gradient layers clipped inside the ring give the "live border"
glint: slow layer `borderSpin 5.5s linear infinite` always on; fast layer `1.3s` fades in on hover
(opacity 0→1, .3s) — i.e. the glint spins ~4x faster on hover.

| State | Ring/glint color (`bd` / `glint`) | Eyebrow glyph badge | Status line on card | PRE counter | Side-peek uniqueness |
|---|---|---|---|---|---|
| Available | `--border` ring, `--border-strong` glint (neutral) | none | none | `PRE 1/1 ✓` green (`--complete-text`) | Prereq tree with mixed met/not-met (CS 1110 met green, CS 1112 not-met red "or this (MATLAB track)") |
| Completed | `--complete-bd` / `--complete` | ✓ white on emerald circle 13px | none | `PRE 1/1 ✓` | Tree all-met (MATH 1910 green "completed FA 25") |
| In progress | `--drop-bd` / `--drop` (blue) | ◷ white on blue | "In progress" 9.5px 700 `--drop-text` | `PRE —` gray | "No prerequisites — take it any semester." |
| Waived | `--waived-bd` / `--waived` (violet) | – white on violet | "Waived" `--waived-text` | `PRE —` | Bucket description ("...waived by your advisor"), offered "Every term", no tree |
| Blocked | `--destructive-bd` / `--destructive` | ✕ white on red | "Needs CS 2110 first" `--destructive-text` | `PRE 0/1 ✕` red | Tree all not-met, red chips (CS 2110 "planned — Fall of year 2", CS 2112 "honors alternative") |
| Warning | `--available-bd` / `--available` (amber) | ! white on amber | "Usually offered in Fall only" `--available-text` | `PRE 2/2 ✓` green | Tree all met incl. coreq note ("coreq — met"), offered "Fall only" |
| Empty | 1.5px dashed `--border-strong`, no ring layers | — | "ELECTIVE" + "＋ Find a class" | — | Click does NOT open a side-peek (`openPeek` guards `key !== "empty"`) |

Interactions and timing:
- Hover: `translateY(-3px)` (`hoverLift` prop, default 3, range 0–6), transition `transform .16s ease`; shadow rest `--card-rest-shadow` → hover `--shadow-md` (`box-shadow .2s ease`). Fast glint layer fades in (.3s).
- Corner-morph action reveal (reveal = "corner"): bottom-right pill 20px tall, width animates 24px → 116px with `width .22s cubic-bezier(.3,1.2,.4,1)` (slight overshoot); "⋯" fades out (.12s), the 4 buttons (✓ done / ◷ taking / ✕ clear / ⋯ more) fade in `.16s ease .06s` delay; buttons 26x16px radius 8px.
- Press: `transform:scale(0.97)` (style-active).
- State change (click ✓ or ◷): status override + sweep counter; glyph badge pops in with `popA/B .45s cubic-bezier(.34,1.56,.64,1)` (overshoot to 1.22 at 60%); rail sweep `sweepXA/B .5s cubic-bezier(.2,0,.2,1)` is available for rail-style directions (A/B alternation retriggers on consecutive changes). Ring color, PRE color, glyph all re-derive from the new status.
- Side-peek: click card body → scrim `rgb(15 23 42 / .35)` fades .25s; panel `width:min(480px, 92vw)` slides `translateX(510px) → 0` with `transform .34s cubic-bezier(.22,1.12,.36,1)` (spring overshoot); Escape or scrim click closes. Footer: "Place in plan" (solid, `--text` bg) + "✓ Mark complete" (outline).
- Reduced motion: global `* { animation: none !important; transition: none !important; }`.

## 7. Differences vs. current app tokens to note

- Category accents are new per-category token pairs (`--cat-*` + `--cat-*-tint`) with distinct light/dark values (see section 1) — including `fws` and `pe` categories.
- Status triad naming: `--available` is the AMBER warning hue (used for the Warning state), while the Available card state renders neutral (transparent rail, `--border` ring). `--drop` (blue) doubles as the In-progress hue.
- `color-mix(...)`-derived border/glow/ring tokens (`*-bd` at 55%, `--destructive-glow` 45%, `--destructive-ring` 22%).
- Fonts: card uses Manrope (sans) + IBM Plex Mono (mono), NOT DM Sans/DM Mono (the "current pairing" per the gallery).
