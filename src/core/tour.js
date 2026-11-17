// Tur ghidat pentru prezentarea de la gala (Actul III).
// Pasii vin din ctx.tourSteps: { title, text, view: {position, target}, hotspot?: id, onEnter?: fn, order?: number }
const $ = (id) => document.getElementById(id);

export function createTour(ctx) {
  let i = 0, active = false, auto = false, timer = null;
  const steps = () => [...ctx.tourSteps].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

  function show(k) {
    const s = steps();
    if (!s.length) return;
    i = (k + s.length) % s.length;
    const st = s[i];
    $('tour-step').textContent = `Pasul ${i + 1} din ${s.length}`;
    $('tour-title').textContent = st.title;
    $('tour-desc').textContent = st.text;
    if (st.onEnter) st.onEnter(ctx);
    if (st.view) ctx.controls.flyTo(st.view.position, st.view.target, st.dur || 3);
    if (st.hotspot) ctx.hotspots.open(st.hotspot); else $('panel').classList.add('hidden');
    clearTimeout(timer);
    if (auto) timer = setTimeout(() => show(i + 1), (st.hold || 11) * 1000);
  }

  $('tour-prev').onclick = () => show(i - 1);
  $('tour-next').onclick = () => show(i + 1);
  $('tour-auto').onclick = () => { auto = !auto; $('tour-auto').classList.toggle('primary', auto); ctx.toast(auto ? 'Redare automată pornită' : 'Redare automată oprită'); show(i); };
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'ArrowRight' || e.code === 'PageDown') show(i + 1);
    if (e.code === 'ArrowLeft' || e.code === 'PageUp') show(i - 1);
  });

  return {
    start() { active = true; ctx.controls.setMode('orbit'); show(0); },
    stop() { active = false; clearTimeout(timer); },
    get active() { return active; },
  };
}
