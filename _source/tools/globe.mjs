import { geoOrthographic, geoPath, geoGraticule, geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import { readFileSync, writeFileSync } from 'fs';

const topo = JSON.parse(readFileSync('node_modules/world-atlas/land-110m.json', 'utf8'));
const land = feature(topo, topo.objects.land);
// drop specks that would only add bytes
const polys = [];
for (const f of land.features) {
  const g = f.geometry;
  const list = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  for (const c of list) {
    const poly = { type: 'Polygon', coordinates: c };
    if (geoArea(poly) > 0.002) polys.push(c);
  }
}
const landGeom = { type: 'MultiPolygon', coordinates: polys };

const S = 520, R = 250;
const projection = geoOrthographic().rotate([-12, -44, 0]).translate([S / 2, S / 2]).scale(R).clipAngle(90).precision(2.5);
const path = geoPath(projection).digits(0);

const INK = '#0D2B38', MINT = '#CFE6D6', AMBER = '#F3C66F', TEAL2 = '#2B98A1';
const uk = [-1.5, 52.6];
const places = [[-82.46, 27.95], [116.4, 39.9], [77.6, 12.97], [36.8, -1.3], [-71.06, 42.36], [13.4, 52.5], [-9.14, 38.72], [31.2, 30.05]];

const p0 = projection(uk);
let arcs = '', dots = '';
for (const pl of places) {
  const p1 = projection(pl);
  if (!p1) continue;
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  // lift each route away from the globe's centre so it reads as a flight path
  let nx = -dy / len, ny = dx / len;
  if ((mx + nx - S / 2) ** 2 + (my + ny - S / 2) ** 2 < (mx - nx - S / 2) ** 2 + (my - ny - S / 2) ** 2) { nx = -nx; ny = -ny; }
  const lift = Math.min(70, len * 0.28);
  const cx = mx + nx * lift, cy = my + ny * lift;
  arcs += `<path d="M${p0[0].toFixed(1)} ${p0[1].toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}"/>`;
  dots += `<circle cx="${p1[0].toFixed(1)}" cy="${p1[1].toFixed(1)}" r="4"/>`;
}
const grat = path(geoGraticule().step([30, 30])());
const svg = `<svg class="globe-art" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">`
  + `<defs><radialGradient id="glG" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#22596B"/><stop offset="1" stop-color="#143F4E"/></radialGradient></defs>`
  + `<circle cx="${S / 2}" cy="${S / 2}" r="${R}" fill="url(#glG)"/>`
  + `<path d="${grat}" fill="none" stroke="${MINT}" stroke-width=".8" opacity=".16"/>`
  + `<path d="${path(landGeom)}" fill="${MINT}" opacity=".3"/>`
  + `<circle cx="${S / 2}" cy="${S / 2}" r="${R}" fill="none" stroke="${MINT}" stroke-width="1.5" opacity=".35"/>`
  + `<g fill="none" stroke="${MINT}" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="1 6" opacity=".9">${arcs}</g>`
  + `<g fill="${MINT}">${dots}</g>`
  + `<circle cx="${p0[0].toFixed(1)}" cy="${p0[1].toFixed(1)}" r="16" fill="${AMBER}" opacity=".25"/>`
  + `<circle cx="${p0[0].toFixed(1)}" cy="${p0[1].toFixed(1)}" r="7" fill="${AMBER}"/>`
  + `<circle cx="${p0[0].toFixed(1)}" cy="${p0[1].toFixed(1)}" r="2.6" fill="${INK}"/>`
  + `</svg>\n`;
writeFileSync(new URL('../partials/art-globe.html', import.meta.url), svg);
console.log('globe', (svg.length / 1024).toFixed(1) + ' KB');
