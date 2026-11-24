// Operator-facing field list: turns the slot manifest into labelled, grouped
// fields a non-technical person can edit on a phone without touching the
// 1920x1080 preview. Pure and deterministic — it reads only the slot manifest
// (structural `path`s from ingest, `label`s from the studio compiler) plus the
// current content, and never changes a slot id or value. The Guardian still
// validates every edit that comes back.
//
// Heuristics (ingested pages):
//   * a slot belongs to the nearest enclosing table row / list item / header /
//     footer / section ("group"); everything else lands in "Other text"
//   * a table-body cell is labelled by the matching <th> text in the same table
//     ("Total monthly"), so a leaderboard reads like the spreadsheet it replaced
//   * a row is titled by its first text that contains a letter ("Jeff"), not by
//     its rank number
// Studio boards carry a designer-given label per slot and form one group.

const GROUP_TAGS = new Set(['tr', 'li', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'figure']);
const GROUP_TITLES = {
  header: 'Top of board', footer: 'Bottom of board', nav: 'Menu', aside: 'Side panel',
  figure: 'Picture', section: 'Section', article: 'Section',
};
const ATTR_LABELS = { src: 'Picture', alt: 'Picture description', href: 'Link' };
const TAG_LABELS = {
  h1: 'Headline', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
  a: 'Link text', button: 'Button', em: 'Icon', b: 'Bold text', strong: 'Bold text', small: 'Small print',
  th: 'Column heading', td: 'Cell', li: 'Item',
};

/** "html:1>body:1>div:2>table:1>tbody:1>tr:1>td:7>span:1>#text:0" -> segments. */
function segs(path) {
  return String(path || '').split('@')[0].split('>').filter(Boolean);
}
const tagOf = (seg) => seg.split(':')[0];
const idxOf = (seg) => Number(seg.split(':')[1]) || 0;

/** Column headings per table: "<prefix up to table>" -> { colIndex: headingText }. */
function tableHeadings(slots) {
  const out = new Map();
  for (const s of slots) {
    if (s.kind !== 'text' || !s.path) continue;
    const p = segs(s.path);
    const th = p.findIndex((x) => tagOf(x) === 'th');
    const table = p.findIndex((x) => tagOf(x) === 'table');
    if (th < 0 || table < 0) continue;
    const key = p.slice(0, table + 1).join('>');
    if (!out.has(key)) out.set(key, {});
    const cols = out.get(key);
    if (cols[idxOf(p[th])] == null) cols[idxOf(p[th])] = s.original.trim();
  }
  return out;
}

const hasLetter = (v) => /\p{L}/u.test(v || '');
/** Values like "$184,729.84", "0", "—", "+ +--" get a numeric keypad. */
export const looksNumeric = (v) => /\d/.test(v || '') && /^[\s$€£¥%+\-−—–.,\d()/]*$/.test(v || '');

/**
 * @param {object[]} slots   slot manifest (ingest or compileBoard)
 * @param {Record<string,string>} content  HEAD content
 * @returns {{ id:string, title:string, kind:'row'|'headings'|'board'|'other'|'section', fields: object[] }[]}
 */
export function fieldGroups(slots, content = {}) {
  const headings = tableHeadings(slots);
  const groups = new Map();
  const group = (key, title, kind) => {
    if (!groups.has(key)) groups.set(key, { id: key, title, kind, fields: [] });
    return groups.get(key);
  };

  for (const s of slots) {
    const value = content[s.id] ?? s.original ?? '';
    const field = {
      slotId: s.id, kind: s.kind, field: s.field, value, required: !!s.required,
      urlLike: !!s.urlLike, numeric: s.kind === 'text' && looksNumeric(value),
      multiline: s.kind === 'text' && value.trim().length > 60,
    };

    if (!s.path) {
      // Studio-compiled slot: the designer named it.
      field.label = s.label || (s.kind === 'attr' ? ATTR_LABELS[s.field] || s.field : 'Text');
      group('board', 'Board', 'board').fields.push(field);
      continue;
    }

    const p = segs(s.path);
    let gi = -1;
    for (let i = p.length - 1; i >= 0; i--) if (GROUP_TAGS.has(tagOf(p[i]))) { gi = i; break; }

    if (s.kind === 'attr') {
      field.label = ATTR_LABELS[s.field] || s.field;
    } else {
      const td = p.findIndex((x, i) => i > gi && tagOf(x) === 'td');
      const table = p.findIndex((x) => tagOf(x) === 'table');
      if (td >= 0 && table >= 0) {
        const cols = headings.get(p.slice(0, table + 1).join('>')) || {};
        field.label = cols[idxOf(p[td])] || `Column ${idxOf(p[td])}`;
      } else {
        const th = p.findIndex((x) => tagOf(x) === 'th');
        // the text node's parent tag is the segment before "#text:N"
        field.label = th >= 0 ? `Column ${idxOf(p[th])}` : TAG_LABELS[tagOf(p[p.length - 2])] || 'Text';
      }
    }

    let g;
    if (gi < 0) g = group('other', 'Other text', 'other');
    else {
      const tag = tagOf(p[gi]);
      const key = p.slice(0, gi + 1).join('>');
      if (tag === 'tr') {
        const inHead = p.slice(0, gi).some((x) => tagOf(x) === 'thead');
        g = group(key, inHead ? 'Column headings' : `Row ${idxOf(p[gi])}`, inHead ? 'headings' : 'row');
      } else if (tag === 'li') g = group(key, `Item ${idxOf(p[gi])}`, 'row');
      else g = group(key, GROUP_TITLES[tag] || 'Section', 'section');
    }
    g.fields.push(field);
  }

  const out = [...groups.values()];
  for (const g of out) {
    // rows and list items take their name from the first lettered text ("Jeff")
    if (g.kind === 'row') {
      const named = g.fields.find((f) => f.kind === 'text' && hasLetter(f.value));
      if (named) g.title = named.value.trim().slice(0, 40);
    }
    // de-duplicate labels within a group: the lettered one keeps the plain
    // heading ("Tech" = Jeff), the rank number becomes "Tech 2"
    const order = g.kind === 'row' ? [...g.fields].sort((a, b) => hasLetter(b.value) - hasLetter(a.value)) : g.fields;
    const seen = {};
    for (const f of order) {
      const n = (seen[f.label] = (seen[f.label] || 0) + 1);
      if (n > 1) f.label = `${f.label} ${n}`;
    }
  }
  return out;
}

/** Snapshot-compatible hash of a content map (same formula storage uses on publish). */
export function contentHashSource(content) {
  return JSON.stringify(content);
}
