/*
 * Adapted from Owlet's src/Preview.tsx.
 * MIT License — Copyright (c) 2026 NekoApocalypse
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/tomorrow-night-blue.css';
import { previewDirname, resolvePreviewPath } from './preview-paths.js';
import { openDiagramViewer, openImageViewer } from './diagram-viewer.js';

export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
for (const [name, language] of Object.entries({ javascript, typescript, python, json, xml, css, bash, yaml, markdown })) hljs.registerLanguage(name, language);
const md = new MarkdownIt({ html: false, linkify: true, typographer: false,
  highlight: (code, language) => language && hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value : '',
});
function math(source, displayMode = false) {
  return katex.renderToString(source, { displayMode, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 });
}
md.inline.ruler.before('escape', 'preview_math', (state, silent) => {
  const at = state.pos, source = state.src;
  const opener = source.startsWith('\\(', at) ? '\\(' : source.startsWith('\\[', at) ? '\\[' : source.startsWith('$$', at) ? '$$' : source[at] === '$' ? '$' : '';
  if (!opener) return false;
  const closer = opener === '\\(' ? '\\)' : opener === '\\[' ? '\\]' : opener;
  const start = at + opener.length;
  if (opener === '$' && (/\s/.test(source[start] || '') || /\d/.test(source[at - 1] || ''))) return false;
  let end = source.indexOf(closer, start);
  while (end >= 0 && source[end - 1] === '\\') end = source.indexOf(closer, end + closer.length);
  if (end < 0 || end === start) return false;
  if (opener === '$' && (/\s/.test(source[end - 1]) || /\d/.test(source[end + 1] || ''))) return false;
  if (!silent) {
    const token = state.push('preview_math', '', 0);
    token.content = source.slice(start, end);
    token.meta = { display: opener === '$$' || opener === '\\[' };
  }
  state.pos = end + closer.length;
  return true;
});
md.renderer.rules.preview_math = (tokens, index) => math(tokens[index].content, tokens[index].meta.display);
md.block.ruler.before('fence', 'preview_math_block', (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const line = state.src.slice(start, state.eMarks[startLine]);
  const opener = line.startsWith('$$') ? '$$' : line.startsWith('\\[') ? '\\[' : '';
  if (!opener) return false;
  const closer = opener === '$$' ? '$$' : '\\]';
  let content = line.slice(opener.length), next = startLine, closing = content.indexOf(closer);
  while (closing < 0 && next + 1 < endLine) {
    next++;
    content += '\n' + state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
    closing = content.indexOf(closer);
  }
  if (closing < 0 || content.slice(closing + closer.length).trim()) return false;
  if (silent) return true;
  const token = state.push('preview_math_block', 'div', 0);
  token.content = content.slice(0, closing);
  token.map = [startLine, next + 1];
  state.line = next + 1;
  return true;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
md.renderer.rules.preview_math_block = (tokens, index) => math(tokens[index].content, true);
const fence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  if (tokens[index].info.trim().toLowerCase() !== 'mermaid') return fence(tokens, index, options, env, self);
  const source = tokens[index].content;
  if (source.length > 50000) return '<div class="preview-diagram preview-render-error">Diagram exceeds the 50,000 character limit.</div>';
  const id = env.diagrams.push(source) - 1;
  return `<div class="preview-diagram" data-diagram="${id}">Rendering diagram…</div>`;
};
md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index], source = String(token.attrGet('src') || ''), alt = token.content || 'Image';
  return `<span class="preview-image" data-source="${md.utils.escapeHtml(source)}"><img alt="${md.utils.escapeHtml(alt)}" loading="lazy"><span class="preview-image-caption">${md.utils.escapeHtml(alt)}</span></span>`;
};
md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
  const base = (tokens[index + 1]?.content || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
  const count = env.headings.get(base) || 0;
  env.headings.set(base, count + 1);
  tokens[index].attrSet('id', count ? `${base}-${count}` : base);
  return self.renderToken(tokens, index, options);
};
let mermaidPromise;
let diagramCounter = 0;
function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', htmlLabels: false,
      secure: [...(mermaid.mermaidAPI.defaultConfig.secure || []), 'htmlLabels'],
      suppressErrorRendering: true, maxTextSize: 50000, maxEdges: 500,
      themeVariables: { primaryColor: '#172b32', primaryBorderColor: '#85c9bd', primaryTextColor: '#f4f1e8', lineColor: '#85c9bd', fontFamily: 'Segoe UI, sans-serif' },
    });
    return mermaid;
  }).catch((error) => { mermaidPromise = null; throw error; });
  return mermaidPromise;
}

/** A DOM-only renderer. All image bytes come from the scoped read-only backend. */
export function createMarkdownPreview({ container, readImage, onOpen, openExternalUrl, onError = () => {} }) {
  container.classList.add('markdown-preview');
  container.tabIndex = 0;
  container.setAttribute('aria-label', 'Markdown preview');
  let generation = 0, imageGeneration = 0, disposed = false, previous = null;
  let closeViewer = null;
  const dismissViewer = () => { closeViewer?.(); closeViewer = null; };
  const fail = (error) => onError(error instanceof Error ? error : new Error(String(error)));
  const click = async (event) => {
    const image = event.target.closest?.('.preview-image img[src]');
    if (image && container.contains(image)) {
      event.preventDefault(); event.stopPropagation();
      const close = openImageViewer({ image, focusFallback: container });
      if (close) closeViewer = close;
      return;
    }
    const expand = event.target.closest?.('.diagram-expand');
    if (expand && container.contains(expand)) {
      const svg = expand.parentElement.querySelector('svg');
      if (svg) closeViewer = openDiagramViewer({ svg, trigger: expand, focusFallback: container,
        title: `Mermaid diagram ${Number(expand.parentElement.dataset.diagram) + 1}` });
      return;
    }
    const link = event.target.closest?.('a');
    if (!link || !container.contains(link)) return;
    event.preventDefault();
    const href = link.getAttribute('href') || '';
    try {
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1));
        [...container.querySelectorAll('[id]')].find((element) => element.id === id)?.scrollIntoView({ block: 'start' });
      } else if (/^https?:\/\//i.test(href)) await openExternalUrl?.(href);
      else if (!(/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) && !href.startsWith('//')) {
        const path = decodeURIComponent(href.split('#')[0]);
        if (path && previous) await onOpen?.(resolvePreviewPath(previewDirname(previous.path), path));
      }
    } catch (error) { if (!disposed) fail(error); }
  };
  container.addEventListener('click', click);
  const imageKey = event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.preview-image img[src]')) {
      event.preventDefault(); event.stopPropagation(); event.target.click();
    }
  };
  container.addEventListener('keydown', imageKey);
  async function images(path, root, current) {
    const revision = ++imageGeneration;
    const items = [...container.querySelectorAll('.preview-image')];
    let cursor = 0;
    // Bound outstanding image reads; stale jobs stop before scheduling more work.
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (cursor < items.length && !disposed && current === generation && revision === imageGeneration) {
        const item = items[cursor++], img = item.querySelector('img'), source = item.dataset.source;
        try {
          const result = await readImage({ source, document: path, root });
          if (disposed || current !== generation || revision !== imageGeneration) return;
          // SVG and remote URLs are deliberately excluded, even if the service misbehaves.
          const prefix = /^data:image\/(?:png|jpeg|jpg|webp|gif|avif|bmp);base64,/i.exec(result.url || '');
          if (!prefix || result.url.length - prefix[0].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('Unsupported image or image exceeds 16 MiB.');
          if (img.getAttribute('src') !== result.url) img.src = result.url;
          img.tabIndex = 0;
          img.setAttribute('role', 'button');
          img.setAttribute('aria-label', `Expand image: ${img.alt}`);
          img.title = 'Expand image · zoom and pan';
          item.title = result.path || source;
          item.classList.remove('preview-render-error');
          item.querySelector('.preview-image-caption').textContent = img.alt;
        } catch (error) {
          if (disposed || current !== generation || revision !== imageGeneration) return;
          img.removeAttribute('src');
          img.removeAttribute('tabindex'); img.removeAttribute('role'); img.removeAttribute('aria-label'); img.removeAttribute('title');
          item.classList.add('preview-render-error');
          item.querySelector('.preview-image-caption').textContent = `${source}: ${String(error).replace(/^Error: /, '')}`;
        }
      }
    }));
  }
  async function diagrams(sources, current) {
    if (!sources.length) return;
    const items = [...container.querySelectorAll('[data-diagram]')];
    try {
      const mermaid = await loadMermaid();
      for (const item of items) {
        if (disposed || current !== generation) return;
        try {
          const { svg } = await mermaid.render(`vibe99-diagram-${++diagramCounter}`, sources[Number(item.dataset.diagram)]);
          if (disposed || current !== generation) return;
          item.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'script'], FORBID_ATTR: ['href', 'xlink:href'] });
          if (item.querySelector('svg')) {
            const expand = document.createElement('button');
            expand.type = 'button';
            expand.className = 'diagram-expand';
            expand.textContent = 'Expand';
            expand.title = 'Expand diagram · zoom and pan';
            expand.setAttribute('aria-label', `Expand Mermaid diagram ${Number(item.dataset.diagram) + 1}`);
            item.append(expand);
          }
        } catch (error) {
          if (disposed || current !== generation) return;
          item.textContent = `Diagram error: ${String(error).replace(/^Error: /, '')}`;
          item.classList.add('preview-render-error');
        }
      }
    } catch (error) {
      if (disposed || current !== generation) return;
      for (const item of items) { item.textContent = `Diagram unavailable: ${String(error)}`; item.classList.add('preview-render-error'); }
    }
  }
  return {
    render({ text, path, root, refreshImages = false }) {
      if (disposed) return false;
      if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_PREVIEW_BYTES) throw new Error('Preview text exceeds the 4 MiB limit.');
      const sameText = previous?.text === text;
      const sameLocation = previous?.path === path && previous?.root === root;
      // Keep the expanded snapshot stable while an agent updates this file.
      // Navigation and disposal still dismiss it; reopening uses the newest media.
      if (!sameLocation) dismissViewer();
      previous = { text, path, root };
      if (sameText) {
        if (!sameLocation || refreshImages) void images(path, root, generation);
        return false;
      }
      const current = ++generation, env = { diagrams: [], headings: new Map() };
      container.innerHTML = DOMPurify.sanitize(md.render(text, env), { ADD_ATTR: ['data-diagram', 'data-source'], FORBID_TAGS: ['style', 'iframe', 'object', 'script'] });
      void images(path, root, current);
      void diagrams(env.diagrams, current);
      return true;
    },
    clear(message = '') { dismissViewer(); generation++; imageGeneration++; previous = null; container.textContent = message; },
    focus() { container.focus({ preventScroll: true }); },
    dispose() { dismissViewer(); disposed = true; generation++; imageGeneration++; container.removeEventListener('click', click); container.removeEventListener('keydown', imageKey); container.replaceChildren(); },
  };
}
