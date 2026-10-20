'use strict';
// Tiny template engine used by the CMS build. No dependencies.
//
//   {{path}}            escaped text
//   {{{path}}}          raw html (only for output the build made itself)
//   {{helper arg ...}}  helper output (helpers escape for themselves)
//   {{#if x}}..{{else}}..{{/if}}   {{#unless x}}..{{/unless}}
//   {{#ifeq x "text"}}..{{else}}..{{/ifeq}}
//   {{#each list}}..{{/each}}      inside: this, @index, @first, @last
//   {{> name}}          partial, resolved by the caller

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function tokenize(src) {
  const out = [];
  const re = /\{\{\{([\s\S]+?)\}\}\}|\{\{([\s\S]+?)\}\}/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'raw', v: m[1].trim() });
    else out.push({ t: 'tag', v: m[2].trim() });
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}

function splitArgs(s) { return s.match(/"[^"]*"|\S+/g) || []; }

function parse(tokens) {
  let i = 0;
  function block(until) {
    const nodes = [];
    while (i < tokens.length) {
      const tk = tokens[i];
      if (tk.t === 'text') { nodes.push({ type: 'text', v: tk.v }); i++; continue; }
      if (tk.t === 'raw') { nodes.push({ type: 'raw', path: tk.v }); i++; continue; }
      const v = tk.v;
      if (v === 'else') { if (until) { i++; return { nodes, stop: 'else' }; } throw new Error('stray {{else}}'); }
      if (v[0] === '/') { i++; return { nodes, stop: v.slice(1) }; }
      if (v[0] === '>') { nodes.push({ type: 'partial', name: v.slice(1).trim() }); i++; continue; }
      if (v[0] === '#') {
        const args = splitArgs(v.slice(1));
        const kind = args.shift();
        i++;
        const body = block(kind);
        let elseNodes = [];
        if (body.stop === 'else') { const e = block(kind); elseNodes = e.nodes; }
        nodes.push({ type: kind, args, body: body.nodes, elseNodes });
        continue;
      }
      const args = splitArgs(v);
      if (args.length > 1) nodes.push({ type: 'helper', name: args[0], args: args.slice(1) });
      else nodes.push({ type: 'var', path: args[0] });
      i++;
    }
    return { nodes, stop: null };
  }
  return block(null).nodes;
}

function lookup(frames, p) {
  if (p === 'this') return frames[frames.length - 1].ctx;
  if (p[0] === '@') {
    for (let i = frames.length - 1; i >= 0; i--) if (frames[i].vars && p in frames[i].vars) return frames[i].vars[p];
    return undefined;
  }
  const parts = p.split('.');
  for (let i = frames.length - 1; i >= 0; i--) {
    const c = frames[i].ctx;
    if (c !== null && typeof c === 'object' && parts[0] in c) {
      let v = c[parts[0]];
      for (let k = 1; k < parts.length; k++) { if (v == null) return undefined; v = v[parts[k]]; }
      return v;
    }
  }
  return undefined;
}

const truthy = v => Array.isArray(v) ? v.length > 0 : !!v;

function renderNodes(nodes, frames, env) {
  let out = '';
  const val = a => (a[0] === '"' ? a.slice(1, -1) : lookup(frames, a));
  for (const n of nodes) {
    switch (n.type) {
      case 'text': out += n.v; break;
      case 'var': { const v = lookup(frames, n.path); out += esc(v); break; }
      case 'raw': { const v = lookup(frames, n.path); out += v == null ? '' : String(v); break; }
      case 'helper': {
        const h = env.helpers[n.name];
        if (!h) throw new Error('unknown helper: ' + n.name);
        out += h(...n.args.map(val));
        break;
      }
      case 'if': out += renderNodes(truthy(val(n.args[0])) ? n.body : n.elseNodes, frames, env); break;
      case 'unless': out += renderNodes(!truthy(val(n.args[0])) ? n.body : n.elseNodes, frames, env); break;
      case 'ifeq': out += renderNodes(val(n.args[0]) === val(n.args[1]) ? n.body : n.elseNodes, frames, env); break;
      case 'each': {
        const list = val(n.args[0]) || [];
        list.forEach((item, idx) => {
          const f = { ctx: item, vars: { '@index': idx, '@first': idx === 0, '@last': idx === list.length - 1 } };
          out += renderNodes(n.body, frames.concat(f), env);
        });
        break;
      }
      case 'partial': out += renderNodes(env.partial(n.name), frames, env); break;
      default: throw new Error('unknown node ' + n.type);
    }
  }
  return out;
}

module.exports = { parse, tokenize, renderNodes, esc, escAttr };
