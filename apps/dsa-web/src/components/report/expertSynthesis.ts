const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Split peer sections only, retaining nested headings, tables and fenced code intact. */
export function splitDiscussionSections(source: string) {
  const lines = source.split('\n');
  const headings: { index: number; level: number; title: string }[] = [];
  let fence = '';
  lines.forEach((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      return;
    }
    const heading = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) headings.push({ index, level: heading[1].length, title: heading[2] });
  });
  const level = headings.some(h => h.level === 2) ? 2 : Math.min(...headings.map(h => h.level));
  const peers = headings.filter(h => h.level === level);
  if (!peers.length) return { prelude: source, sections: [] };
  return { prelude: lines.slice(0, peers[0].index).join('\n'), sections: peers.map((heading, index) => ({ title: heading.title, content: lines.slice(heading.index + 1, peers[index + 1]?.index ?? lines.length).join('\n') })) };
}

/** Legacy exports use two-space top-level keys. Never repair or infer damaged values. */
export function readExpertSynthesis(structured: unknown, source: string) {
  const saved = record(structured);
  if (saved && Object.keys(saved).length) return { data: saved, omitted: [] as string[], narrative: '', raw: source };
  const blocks = [...source.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)];
  const json = blocks.length === 1 ? blocks[0][1].trim() : source.trim();
  const isJson = json.startsWith('{') || json.startsWith('[') || blocks.length > 0;
  if (!isJson) return { data: {}, omitted: [], narrative: source, raw: source };
  try {
    const data = record(JSON.parse(json));
    if (data) return { data, omitted: [], narrative: '', raw: source };
  } catch { /* Parse isolated, complete top-level values below; never repair quotes. */ }
  const data: Record<string, unknown> = {};
  const omitted: string[] = [];
  const fields = [...json.matchAll(/^ {2}"([a-zA-Z][\w]*)"\s*:/gm)];
  if (blocks.length <= 1 && json.startsWith('{') && json.endsWith('}')) {
    fields.forEach((match, index) => {
      const end = fields[index + 1]?.index ?? json.lastIndexOf('}');
      const value = json.slice(match.index! + match[0].length, end).trim().replace(/,$/, '');
      try { data[match[1]] = JSON.parse(value); } catch { omitted.push(match[1]); }
    });
  }
  return { data, omitted: omitted.length ? omitted : Object.keys(data).length ? [] : ['document'], narrative: '', raw: source };
}
