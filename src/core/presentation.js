import { CATEGORIES } from './hotspots.js';

// Genereaza fisa de prezentare (Markdown) din punctele de informare si pasii turului.
// In consola browserului: exportaPrezentarea()  -> salveaza docs/PREZENTARE.md (doar cu `npm run dev`).
export function presentationMarkdown(ctx) {
  const order = ['heritage', 'info', 'access', 'safety', 'energy', 'eco', 'mobility'];
  let md = '# Gara Viitorului – Pașcani · Fișa de prezentare\n\n';
  md += '> Generată automat din aplicație. Fiecare soluție este explicată pe trei planuri, așa cum cere tema: ';
  md += '**ce este**, **de ce am ales-o** și **ce avantaj aduce**. Cifrele sunt estimări pentru proiectul școlar.\n\n';
  md += 'Date reale: © OpenStreetMap contributors (ODbL), Microsoft Global ML Building Footprints (ODbL), relief SRTM. Cercetarea completă: `docs/cercetare.json`.\n\n';
  md += '## Cuprins\n\n';
  for (const k of order) {
    const n = ctx.hotspots.list.filter((h) => h.category === k).length;
    if (n) md += `- ${CATEGORIES[k].icon} ${CATEGORIES[k].label} (${n})\n`;
  }
  md += '- 🎤 Scenariul turului ghidat\n';
  for (const k of order) {
    const hs = ctx.hotspots.list.filter((h) => h.category === k);
    if (!hs.length) continue;
    md += `\n## ${CATEGORIES[k].icon} ${CATEGORIES[k].label}\n`;
    for (const h of hs) {
      md += `\n### ${h.title}\n\n- **Ce este:** ${h.what}\n- **De ce am ales-o:** ${h.why}\n- **Ce avantaj aduce:** ${h.benefit}\n`;
      if (h.data && h.data.length) md += '\n| Indicator | Valoare |\n|---|---|\n' + h.data.map(([a, b]) => `| ${a} | ${b} |`).join('\n') + '\n';
    }
  }
  md += '\n## 🎤 Scenariul turului ghidat (Actul III)\n\n';
  md += 'În aplicație: butonul **Tur ghidat** (tasta `4`), apoi săgețile ← → sau redarea automată ⏯.\n\n';
  [...ctx.tourSteps].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)).forEach((s, i) => { md += `${i + 1}. **${s.title}** – ${s.text}\n`; });
  return md;
}

export function installPresentationExport(ctx) {
  window.exportaPrezentarea = async () => {
    const md = presentationMarkdown(ctx);
    try {
      const r = await fetch('/__salveaza-prezentare', { method: 'POST', body: md, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
      if (r.ok) { ctx.toast('Fișa de prezentare a fost salvată în docs/PREZENTARE.md'); return await r.text(); }
    } catch (e) { /* versiunea finala (build) nu are server de salvare */ }
    // rezerva: descarca fisierul
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = 'PREZENTARE.md';
    a.click();
    return 'descarcat';
  };
}
