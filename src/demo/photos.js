// Demo build only: generated placeholder "photos" for the fictional boards.
// Every image is a flat vector illustration drawn here in code — no real photo,
// no client asset. build.mjs writes each one to <out>/photos/<key>.svg.
// All are square (800x800) and every seed image slot is square, so swapping
// one photo for another never stretches (the studio saves images as
// objectFit:fill — see the aspect-ratio note in the report).

const S = 800;
/** Archimedean spiral path (a laminated-dough swirl), r0 -> r1 over `turns`. */
const spiral = (cx, cy, r0, r1, turns) => {
  const n = Math.round(turns * 48), pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * 2 * Math.PI, r = r0 + (r1 - r0) * t;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return 'M' + pts.join(' L');
};
const wrap = (bg, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${title}">` +
  `<defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>` +
  `<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity=".35"/></filter></defs>` +
  `<rect width="${S}" height="${S}" fill="url(#g)"/>${body}</svg>`;

export const PHOTOS = [
  {
    key: 'morning-bun',
    label: 'Morning bun',
    svg: wrap(['#f7d9a8', '#c98a4b'], `
      <ellipse cx="400" cy="560" rx="300" ry="70" fill="#000" opacity=".18"/>
      <g filter="url(#sh)">
        <circle cx="400" cy="420" r="230" fill="#b8692b"/>
        <path d="${spiral(400, 420, 14, 205, 3.4)}" fill="none" stroke="#7a3d14" stroke-width="30" stroke-linecap="round" opacity=".55"/>
        <path d="${spiral(400, 420, 14, 205, 3.4)}" fill="none" stroke="#e8a45f" stroke-width="16" stroke-linecap="round"/>
        <g fill="#fff7ea" opacity=".95">${[...Array(26)].map((_, i) => {
          const a = (i * 137.5 * Math.PI) / 180, r = 40 + ((i * 53) % 170);
          return `<rect x="${(400 + r * Math.cos(a)).toFixed(0)}" y="${(420 + r * Math.sin(a)).toFixed(0)}" width="9" height="9" rx="2" transform="rotate(${i * 23} ${(400 + r * Math.cos(a)).toFixed(0)} ${(420 + r * Math.sin(a)).toFixed(0)})"/>`;
        }).join('')}</g>
      </g>`, 'Morning bun'),
  },
  {
    key: 'latte',
    label: 'Latte',
    svg: wrap(['#e9dccb', '#9c7a58'], `
      <g filter="url(#sh)">
        <circle cx="400" cy="400" r="300" fill="#f4efe8"/>
        <circle cx="400" cy="400" r="262" fill="#e4dbcf"/>
        <path d="M640 300 q110 0 110 100 t-110 100" fill="none" stroke="#f4efe8" stroke-width="44" stroke-linecap="round"/>
        <circle cx="400" cy="400" r="215" fill="#f1ede6"/>
        <circle cx="400" cy="400" r="196" fill="#8a5630"/>
        <circle cx="400" cy="400" r="196" fill="none" stroke="#a56a3d" stroke-width="18"/>
        <path d="M400 505 C300 430 285 350 335 320 C370 300 395 322 400 350 C405 322 430 300 465 320 C515 350 500 430 400 505Z" fill="#f6ead8"/>
        <path d="M400 470 C340 425 330 375 358 358" fill="none" stroke="#e7cfae" stroke-width="10" stroke-linecap="round"/>
      </g>`, 'Latte'),
  },
  {
    key: 'iced-coffee',
    label: 'Iced coffee',
    svg: wrap(['#cfe6ee', '#5b8aa0'], `
      <ellipse cx="400" cy="690" rx="190" ry="34" fill="#000" opacity=".2"/>
      <g filter="url(#sh)">
        <path d="M250 180 L550 180 L515 680 Q400 705 285 680 Z" fill="#ffffff" opacity=".35"/>
        <path d="M262 300 L538 300 L515 670 Q400 692 285 670 Z" fill="#6b3f22"/>
        <path d="M262 300 L538 300 L533 360 Q400 390 267 360 Z" fill="#c9a47c"/>
        <g fill="#eaf6fb" opacity=".85" stroke="#fff" stroke-width="4">
          <rect x="300" y="330" width="90" height="80" rx="14" transform="rotate(-12 345 370)"/>
          <rect x="410" y="350" width="90" height="80" rx="14" transform="rotate(14 455 390)"/>
          <rect x="350" y="430" width="85" height="75" rx="14" transform="rotate(6 392 467)"/>
        </g>
        <rect x="430" y="90" width="28" height="330" rx="14" fill="#2e6bff" transform="rotate(14 444 255)"/>
        <path d="M250 180 L550 180" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".8"/>
      </g>`, 'Iced coffee'),
  },
  {
    key: 'taco',
    label: 'Taco',
    svg: wrap(['#ffd27a', '#e0622c'], `
      <ellipse cx="400" cy="620" rx="290" ry="50" fill="#000" opacity=".2"/>
      <g filter="url(#sh)">
        <path d="M130 560 A270 270 0 0 1 670 560 Z" fill="#f2b441"/>
        <g>
          <circle cx="210" cy="430" r="58" fill="#3f9a3a"/><circle cx="290" cy="360" r="62" fill="#4fb046"/>
          <circle cx="380" cy="325" r="64" fill="#3f9a3a"/><circle cx="470" cy="335" r="62" fill="#4fb046"/>
          <circle cx="555" cy="380" r="58" fill="#3f9a3a"/><circle cx="610" cy="450" r="50" fill="#4fb046"/>
          <path d="M190 470 Q400 340 610 470 L610 520 L190 520 Z" fill="#8b3d1f"/>
          ${[[260, 400], [330, 380], [420, 372], [500, 388], [570, 430], [360, 430], [460, 425]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="#e23b2e"/>`).join('')}
          ${[[300, 430], [400, 410], [520, 440], [240, 470]].map(([x, y]) => `<rect x="${x}" y="${y}" width="34" height="10" rx="5" fill="#fff4dc"/>`).join('')}
        </g>
        <path d="M130 560 A270 270 0 0 1 670 560" fill="none" stroke="#e39a25" stroke-width="44"/>
        <path d="M100 575 L700 575" stroke="#d98d1f" stroke-width="30" stroke-linecap="round"/>
      </g>`, 'Taco'),
  },
  {
    key: 'elote',
    label: 'Street corn',
    svg: wrap(['#fff1b8', '#d99a1e'], `
      <g filter="url(#sh)" transform="rotate(-35 400 400)">
        <rect x="370" y="560" width="60" height="200" rx="14" fill="#c7a27a"/>
        <rect x="270" y="110" width="260" height="480" rx="130" fill="#f6c93f"/>
        <g fill="#ffdd6b">${[...Array(7)].map((_, r) => [...Array(4)].map((__, c) => `<rect x="${298 + c * 52}" y="${150 + r * 60}" width="44" height="50" rx="16"/>`).join('')).join('')}</g>
        <g fill="#fffaf0" opacity=".9">${[...Array(18)].map((_, i) => `<circle cx="${300 + ((i * 71) % 200)}" cy="${170 + ((i * 97) % 380)}" r="${10 + (i % 3) * 4}"/>`).join('')}</g>
        <g fill="#d4351c">${[...Array(22)].map((_, i) => `<circle cx="${295 + ((i * 43) % 210)}" cy="${160 + ((i * 61) % 400)}" r="5"/>`).join('')}</g>
        <g fill="#3f9a3a">${[...Array(10)].map((_, i) => `<rect x="${305 + ((i * 59) % 190)}" y="${180 + ((i * 83) % 360)}" width="16" height="7" rx="3"/>`).join('')}</g>
      </g>`, 'Street corn'),
  },
  {
    key: 'sourdough',
    label: 'Sourdough loaf',
    svg: wrap(['#f3e3c8', '#b07d4a'], `
      <ellipse cx="400" cy="600" rx="320" ry="60" fill="#000" opacity=".18"/>
      <g filter="url(#sh)">
        <ellipse cx="400" cy="430" rx="300" ry="200" fill="#a8622b"/>
        <ellipse cx="400" cy="400" rx="280" ry="170" fill="#c47a3a"/>
        <path d="M230 330 Q400 270 570 330" fill="none" stroke="#f3dcb5" stroke-width="30" stroke-linecap="round"/>
        <path d="M220 410 Q400 350 580 410" fill="none" stroke="#f3dcb5" stroke-width="26" stroke-linecap="round" opacity=".9"/>
        <path d="M250 485 Q400 440 550 485" fill="none" stroke="#f3dcb5" stroke-width="22" stroke-linecap="round" opacity=".8"/>
        <g fill="#fff" opacity=".35">${[...Array(30)].map((_, i) => `<circle cx="${160 + ((i * 97) % 480)}" cy="${280 + ((i * 53) % 260)}" r="${3 + (i % 4)}"/>`).join('')}</g>
      </g>`, 'Sourdough loaf'),
  },
  {
    key: 'cinnamon-roll',
    label: 'Cinnamon roll',
    svg: wrap(['#fbe3cf', '#c2703d'], `
      <g filter="url(#sh)">
        <circle cx="400" cy="400" r="250" fill="#b76a33"/>
        <path d="${spiral(400, 400, 10, 225, 4.2)}" fill="none" stroke="#6e3614" stroke-width="16" stroke-linecap="round" opacity=".8"/>
        <g fill="none" stroke="#fff8ee" stroke-width="18" stroke-linecap="round" opacity=".95">
          <path d="M210 330 Q300 250 400 300 T600 290"/>
          <path d="M190 420 Q300 350 410 410 T610 400"/>
          <path d="M220 510 Q320 440 420 500 T590 490"/>
        </g>
      </g>`, 'Cinnamon roll'),
  },
  {
    key: 'agua-fresca',
    label: 'Agua fresca',
    svg: wrap(['#ffd1dc', '#e0457b'], `
      <ellipse cx="400" cy="690" rx="180" ry="30" fill="#000" opacity=".2"/>
      <g filter="url(#sh)">
        <path d="M265 200 L535 200 L505 675 Q400 700 295 675 Z" fill="#ffffff" opacity=".35"/>
        <path d="M272 300 L528 300 L505 668 Q400 690 295 668 Z" fill="#f2386e"/>
        <circle cx="535" cy="215" r="80" fill="#8fd14f"/><circle cx="535" cy="215" r="62" fill="#e9557a"/>
        ${[[510, 200], [548, 190], [528, 238], [560, 228]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="8" fill="#1a1a1a"/>`).join('')}
        <g fill="#ffe3ea" opacity=".75" stroke="#fff" stroke-width="4">
          <rect x="315" y="340" width="80" height="72" rx="14" transform="rotate(-10 355 376)"/>
          <rect x="410" y="370" width="80" height="72" rx="14" transform="rotate(12 450 406)"/>
        </g>
        <rect x="330" y="100" width="26" height="320" rx="13" fill="#2e6bff" transform="rotate(-10 343 260)"/>
      </g>`, 'Agua fresca'),
  },
];

export const photoFile = (key) => `photos/${key}.svg`;
