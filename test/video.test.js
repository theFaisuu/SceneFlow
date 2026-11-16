'use strict';

/**
 * test/video.test.js — Unit Tests for SceneFlow Video (Google Flow Video Batcher Page)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

async function loadVideoUI() {
  const url = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'video_ui.js')).href;
  return import(url);
}

test('GOOGLE_FLOW_VIDEO_URL matches required Google Flow share link', async () => {
  const { GOOGLE_FLOW_VIDEO_URL } = await loadVideoUI();
  assert.equal(GOOGLE_FLOW_VIDEO_URL, 'https://flow.google.com/shared/tool/5a227913-6905-4e4f-ad45-bcfa29faa5ca');
});

test('index.html renders clean streamlined Video page with correct steps and link', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="nav-btn-video"'), 'Missing Video nav button');
  assert.ok(html.includes('id="page-video"'), 'Missing Video page container');
  assert.ok(html.includes('Open Video Batcher'), 'Missing primary button');
  assert.ok(html.includes('Copy link'), 'Missing copy link button');
  assert.ok(html.includes('https://flow.google.com/shared/tool/5a227913-6905-4e4f-ad45-bcfa29faa5ca'), 'Missing Google Flow link href');
  assert.ok(html.includes('Omni 1.1 Flash or Veo 3.1'), 'Missing model options in step 3');
  assert.ok(html.includes('sign in to your own Google Flow account'), 'Missing step 2 text');

  const start = html.indexOf('<div id="page-video"');
  const end = html.indexOf('<div id="page-studio"');
  assert.ok(start > 0 && end > start, 'page-video must appear before page-studio');
  const videoHtml = html.slice(start, end);

  for (const removed of [
    'Prompt Mapper',
    'Frame Hunter',
    'Script Splitter',
    'VO Hunter',
    'shadow-2xl',
    'shadow-lg'
  ]) {
    assert.equal(videoHtml.includes(removed), false, `Forbidden or glow text still present in #page-video: ${removed}`);
  }
});

test('initVideoUI wires Open Video Batcher link, Copy link feedback, and tab navigation', async () => {
  const { initVideoUI, GOOGLE_FLOW_VIDEO_URL } = await loadVideoUI();

  const elements = {};
  function makeEl(id, extra = {}) {
    const classes = new Set();
    const attrs = { ...(extra.attrs || {}) };
    const el = {
      id,
      href: '',
      textContent: extra.textContent || '',
      value: extra.value || '',
      onclick: null,
      classList: {
        add: (...cls) => cls.forEach(c => classes.add(c)),
        remove: (...cls) => cls.forEach(c => classes.delete(c)),
        contains: (c) => classes.has(c)
      },
      getAttribute: (k) => attrs[k] ?? null,
      setAttribute: () => {},
      style: {},
      select: () => {}
    };
    elements[id] = el;
    return el;
  }

  const copyBtn = makeEl('vid-btn-copy-link');
  const copyLabel = makeEl('vid-copy-link-label', { textContent: 'Copy link' });
  const openBtn = makeEl('vid-btn-open-batcher');
  const navLinkPrompts = makeEl('mock-nav-prompts', { attrs: { 'data-nav-target': 'prompts' } });
  const navLinkStudio = makeEl('mock-nav-studio', { attrs: { 'data-nav-target': 'studio' } });

  let clipboardWritten = '';
  let switchedTab = '';

  global.document = {
    getElementById: (id) => elements[id] || null,
    querySelectorAll: (sel) => (sel === '#page-video [data-nav-target]' ? [navLinkPrompts, navLinkStudio] : []),
    createElement: () => makeEl('temp'),
    execCommand: () => true,
    body: { appendChild: () => {}, removeChild: () => {} }
  };
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (txt) => {
          clipboardWritten = txt;
        }
      }
    }
  });
  global.window = {
    switchToTab: (t) => {
      switchedTab = t;
    }
  };

  initVideoUI();

  assert.equal(openBtn.href, GOOGLE_FLOW_VIDEO_URL);

  assert.equal(typeof copyBtn.onclick, 'function');
  await copyBtn.onclick();
  assert.equal(clipboardWritten, GOOGLE_FLOW_VIDEO_URL);
  assert.equal(copyLabel.textContent, 'Copied!');
  assert.ok(copyBtn.classList.contains('text-emerald-300'));

  assert.equal(typeof navLinkPrompts.onclick, 'function');
  navLinkPrompts.onclick({ preventDefault: () => {} });
  assert.equal(switchedTab, 'prompts');

  navLinkStudio.onclick({ preventDefault: () => {} });
  assert.equal(switchedTab, 'studio');
});
