/**
 * prompts.test.js — Unit tests for SceneFlow Prompts Parser, Validator & Output Builder
 * Run with: node --test test/prompts.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTimeString,
  parseTimestampLine,
  validateCaptionLines,
  createBatches,
  cleanPromptText,
  formatStyleGuideAsLines,
  buildPromptsOutput,
  filterLinesFromTimestamp,
  mergePreservedAndGeneratedItems
} = require('../src/prompts_parser.js');

// ── 1. Timestamp Formats ──────────────────────────────────────────────────

test('parses (0:03) short format', () => {
  const parsed = parseTimestampLine("(0:03) You've been exhausted all day");
  assert.notEqual(parsed, null);
  assert.equal(parsed.rawTime, '(0:03)');
  assert.equal(parsed.cleanTime, '0:03');
  assert.equal(parsed.timeSec, 3);
  assert.equal(parsed.text, "You've been exhausted all day");
});

test('parses (1:05) minute format', () => {
  const parsed = parseTimestampLine("(1:05) washing a cup, waiting for a bus");
  assert.notEqual(parsed, null);
  assert.equal(parsed.rawTime, '(1:05)');
  assert.equal(parsed.cleanTime, '1:05');
  assert.equal(parsed.timeSec, 65);
  assert.equal(parsed.text, "washing a cup, waiting for a bus");
});

test('parses (12:30) two-digit minute format', () => {
  const parsed = parseTimestampLine("(12:30) deep in the conversation");
  assert.notEqual(parsed, null);
  assert.equal(parsed.rawTime, '(12:30)');
  assert.equal(parsed.cleanTime, '12:30');
  assert.equal(parsed.timeSec, 750);
  assert.equal(parsed.text, "deep in the conversation");
});

test('parses (1:02:30) hour:minute:second format', () => {
  const parsed = parseTimestampLine("(1:02:30) the final sequence begins");
  assert.notEqual(parsed, null);
  assert.equal(parsed.rawTime, '(1:02:30)');
  assert.equal(parsed.cleanTime, '1:02:30');
  assert.equal(parsed.timeSec, 3750);
  assert.equal(parsed.text, "the final sequence begins");
});

test('parses unbracketed or bracketed times safely', () => {
  const p1 = parseTimestampLine("0:03 no parens here");
  assert.equal(p1.rawTime, '(0:03)');
  assert.equal(p1.timeSec, 3);

  const p2 = parseTimestampLine("[1:05] square brackets");
  assert.equal(p2.rawTime, '(1:05)');
  assert.equal(p2.timeSec, 65);
});

// ── 2. Bad Lines & Validation ─────────────────────────────────────────────

test('detects bad lines without timestamps', () => {
  const input = `(0:00) First valid line
This line has no timestamp
(0:06) Third line is valid
Another bad line without time`;

  const res = validateCaptionLines(input);
  assert.equal(res.valid, false);
  assert.equal(res.validCount, 2);
  assert.equal(res.badLines.length, 2);
  assert.equal(res.badLines[0].lineNum, 2);
  assert.equal(res.badLines[1].lineNum, 4);
});

test('detects out-of-order timestamps', () => {
  const input = `(0:00) Starting out
(0:10) Jumping forward
(0:05) Going backwards out of order
(0:15) Moving forward again`;

  const res = validateCaptionLines(input);
  assert.equal(res.valid, false);
  assert.equal(res.outOfOrderTimes.length, 1);
  assert.equal(res.outOfOrderTimes[0].lineNum, 3);
  assert.equal(res.outOfOrderTimes[0].rawTime, '(0:05)');
  assert.equal(res.outOfOrderTimes[0].prevTime, '(0:10)');
});

test('detects duplicate timestamps', () => {
  const input = `(0:00) Intro
(0:03) First scene
(0:03) Duplicate scene at same second
(0:06) Next scene`;

  const res = validateCaptionLines(input);
  assert.equal(res.valid, false);
  assert.equal(res.duplicateTimes.length, 1);
  assert.equal(res.duplicateTimes[0].cleanTime, '0:03');
  assert.deepEqual(res.duplicateTimes[0].lineNums, [2, 3]);
});

test('validates clean, perfectly formatted captions', () => {
  const input = `(0:00) Intro scene
(0:03) Second scene
(1:05) Minute mark
(12:30) Long video block
(1:02:30) Hour long block`;

  const res = validateCaptionLines(input);
  assert.equal(res.valid, true);
  assert.equal(res.validCount, 5);
  assert.equal(res.badLines.length, 0);
  assert.equal(res.outOfOrderTimes.length, 0);
  assert.equal(res.duplicateTimes.length, 0);
});

// ── 3. Prompt Sanitization & Cleaning ─────────────────────────────────────

test('cleanPromptText removes inner line breaks and redundant tokens', () => {
  const raw = `
    "1. (0:03) - Cinematic wide shot of character.
    Warm ambient lighting and shadows in the background.
    Looking outside."
  `;
  const cleaned = cleanPromptText(raw);
  assert.equal(cleaned.includes('\n'), false);
  assert.equal(cleaned.startsWith('1.'), false);
  assert.equal(cleaned.startsWith('(0:03)'), false);
  assert.equal(cleaned.startsWith('"'), false);
  assert.equal(cleaned.endsWith('"'), false);
  assert.equal(cleaned, 'Cinematic wide shot of character. Warm ambient lighting and shadows in the background. Looking outside.');
});

// ── 4. Output Builder & Strict Original Timestamp Preservation ───────────

test('output builder enforces exact original input times even when model changes or drops them', () => {
  const input = `(0:00) Scene one
(0:03) Scene two
(1:05) Scene three
(1:02:30) Scene four`;

  const parsed = validateCaptionLines(input);
  assert.equal(parsed.valid, true);

  // Model returned mangled times or no times
  const modelResults = [
    { time: 'zero seconds', prompt: 'Hero standing on cliff' },
    { time: '03s', prompt: 'Wind blowing coat' },
    { time: '', prompt: 'Sun rising over ocean' },
    { prompt: 'Dark clouds forming' }
  ];

  const built = buildPromptsOutput(parsed.lines, modelResults, { aspectRatio: '16:9' });
  assert.equal(built.success, true);
  assert.equal(built.items.length, 4);

  // Assert EVERY single output line starts with the exact original time
  assert.equal(built.items[0].rawTime, '(0:00)');
  assert.ok(built.items[0].fullPromptLine.startsWith('(0:00) Hero standing on cliff'));

  assert.equal(built.items[1].rawTime, '(0:03)');
  assert.ok(built.items[1].fullPromptLine.startsWith('(0:03) Wind blowing coat'));

  assert.equal(built.items[2].rawTime, '(1:05)');
  assert.ok(built.items[2].fullPromptLine.startsWith('(1:05) Sun rising over ocean'));

  assert.equal(built.items[3].rawTime, '(1:02:30)');
  assert.ok(built.items[3].fullPromptLine.startsWith('(1:02:30) Dark clouds forming'));

  // Verify aspect ratio appended
  assert.ok(built.items[0].fullPromptLine.endsWith('--ar 16:9'));
});

test('output builder handles count mismatch from model', () => {
  const input = `(0:00) Line 1
(0:03) Line 2
(0:06) Line 3`;

  const parsed = validateCaptionLines(input);
  // Model only returned 2 lines instead of 3
  const modelResults = [
    { time: '0:00', prompt: 'Prompt 1' },
    { time: '0:03', prompt: 'Prompt 2' }
  ];

  const built = buildPromptsOutput(parsed.lines, modelResults);
  assert.equal(built.success, false);
  assert.equal(built.totalCount, 3);
  assert.equal(built.matchedCount, 2);
  assert.equal(built.missingCount, 1);
  assert.equal(built.items[2].isMissing, true);
  assert.ok(built.items[2].fullPromptLine.includes('[MISSING PROMPT'));
});

test('output builder applies style prefix and blank line toggle', () => {
  const input = `(0:00) Line 1
(0:03) Line 2`;

  const parsed = validateCaptionLines(input);
  const modelResults = [
    { time: '0:00', prompt: 'First scene illustration' },
    { time: '0:03', prompt: 'Second scene illustration' }
  ];

  const withBlank = buildPromptsOutput(parsed.lines, modelResults, {
    blankLineBetweenPrompts: true,
    stylePrefix: 'Stick figure noir style, minimalist black ink.',
    aspectRatio: '16:9'
  });

  assert.equal(withBlank.rawOutputText.includes('\n\n'), true);
  const splitPrompts = withBlank.rawOutputText.split('\n\n');
  assert.equal(splitPrompts.length, 2);
  assert.ok(splitPrompts[0].startsWith('(0:00) Stick figure noir style, minimalist black ink. First scene illustration'));
  assert.ok(splitPrompts[1].startsWith('(0:03) Stick figure noir style, minimalist black ink. Second scene illustration'));
});

test('formatStyleGuideAsLines converts markdown numbered guides to clean line format and buildPromptsOutput places style in each prompt', () => {
  const guideMarkdown = `### 1. Art Style & Medium
Hand-drawn doodle cartoon illustration, thick black wobbly outlines, flat colors with subtle marker texture, minimalist webcomic style, 16:9 widescreen, warm peach walls and wooden floor.

### 2. Character Design & Recurring Figures
a round-headed white stickman with a big perfectly round bald head, dot eyes, thin black line arms, wearing a plain blue short-sleeve t-shirt, blue jeans and white sneakers`;

  const formatted = formatStyleGuideAsLines(guideMarkdown);
  assert.ok(formatted.includes('Art Style & Medium: Hand-drawn doodle cartoon illustration'));
  assert.ok(formatted.includes('Character Design & Recurring Figures: a round-headed white stickman'));
  assert.equal(formatted.includes('###'), false);
  assert.equal(formatted.includes('1.'), false);

  const input = `(0:00) Wide angle of living room
(0:03) Medium shot of kitchen`;
  const parsed = validateCaptionLines(input);
  const modelResults = [
    { time: '0:00', prompt: 'Wide angle of an empty living room' },
    { time: '0:03', prompt: 'Medium shot of a modern kitchen' }
  ];

  const built = buildPromptsOutput(parsed.lines, modelResults, {
    styleGuide: guideMarkdown,
    aspectRatio: '16:9'
  });

  assert.equal(built.success, true);
  assert.ok(built.styleGuideHeader.startsWith('Art Style & Medium:'));
  assert.ok(built.items[0].fullPromptLine.startsWith('(0:00) Art Style & Medium:'));
  assert.ok(built.items[0].fullPromptLine.includes('Wide angle of an empty living room'));
  assert.ok(built.items[0].fullPromptLine.includes('--ar 16:9'));
  assert.ok(built.items[1].fullPromptLine.startsWith('(0:03) Art Style & Medium:'));
  assert.ok(built.items[1].fullPromptLine.includes('Medium shot of a modern kitchen'));
  assert.ok(built.items[1].fullPromptLine.includes('--ar 16:9'));
  assert.ok(built.rawOutputText.includes(built.items[0].fullPromptLine));
  assert.ok(built.rawOutputText.includes(built.items[1].fullPromptLine));
});

test('styleGuide in each prompt matches user exact specification', () => {
  const userGuide = `ART STYLE AND MEDIUM: Hand-drawn digital cartoon doodle with thick uneven black outlines, flat color fills with soft marker-like shading, and a clean, simple, slightly sketchy look.
CHARACTER DESIGN: Round white ball head with thick black outline and tiny dot eyes, small simple mouth, expressive brows and heavy eyelids, thin limbs, short-sleeve blue t-shirt, blue jeans, white sneakers.
COLOUR PALETTE: { "wall": "#F9B98A", "floor": "#B8693F", "shirt": "#4A86D6", "jeans": "#4F7CAD", "furniture": "#6E7FA3", "sky": "#8FD3F7" }
NEGATIVE DIRECTIVES: text, letters, speech bubbles, logos, watermarks, photorealism, 3D rendering, gradients, glossy shading, realistic anatomy, detailed facial features, nose, ears, hair, extra fingers, cluttered backgrounds, thin delicate lines, photographic lighting`;

  const parsed = validateCaptionLines("(0:00) It's a random Tuesday");
  const modelResults = [{ time: '0:00', prompt: 'A round‑head figure in a blue tee and jeans stands in a modest room with orange‑tan wall and brown floor, arms relaxed, soft overhead light casts gentle shadows, simple doodle vibe.' }];

  const built = buildPromptsOutput(parsed.lines, modelResults, { styleGuide: userGuide });
  assert.equal(built.success, true);
  const expectedLine = `(0:00) ART STYLE AND MEDIUM: Hand-drawn digital cartoon doodle with thick uneven black outlines, flat color fills with soft marker-like shading, and a clean, simple, slightly sketchy look. CHARACTER DESIGN: Round white ball head with thick black outline and tiny dot eyes, small simple mouth, expressive brows and heavy eyelids, thin limbs, short-sleeve blue t-shirt, blue jeans, white sneakers. COLOUR PALETTE: { "wall": "#F9B98A", "floor": "#B8693F", "shirt": "#4A86D6", "jeans": "#4F7CAD", "furniture": "#6E7FA3", "sky": "#8FD3F7" }. NEGATIVE DIRECTIVES: text, letters, speech bubbles, logos, watermarks, photorealism, 3D rendering, gradients, glossy shading, realistic anatomy, detailed facial features, nose, ears, hair, extra fingers, cluttered backgrounds, thin delicate lines, photographic lighting. A round‑head figure in a blue tee and jeans stands in a modest room with orange‑tan wall and brown floor, arms relaxed, soft overhead light casts gentle shadows, simple doodle vibe.`;

  assert.equal(built.items[0].fullPromptLine, expectedLine);
  // Guarantee single continuous paragraph with no line breaks
  assert.equal(built.items[0].fullPromptLine.includes('\n'), false);
  assert.equal(built.items[0].fullPromptLine.includes('\r'), false);
});

// ── 5. Batching & Surrounding Context ─────────────────────────────────────

test('createBatches divides into 10 lines per batch (100 prompts in 10 requests)', () => {
  const lines100 = [];
  for (let i = 0; i < 100; i++) {
    lines100.push({
      lineIndex: i,
      rawTime: `(0:${String(i).padStart(2, '0')})`,
      cleanTime: `0:${String(i).padStart(2, '0')}`,
      timeSec: i,
      text: `Caption line number ${i}`
    });
  }

  // 100 lines with batch size 10 -> exactly 10 batches
  const batches100 = createBatches(lines100, 10, 3);
  assert.equal(batches100.length, 10);
  for (let b = 0; b < 10; b++) {
    assert.equal(batches100[b].items.length, 10);
  }

  // Test surrounding context
  assert.equal(batches100[0].prevContext.length, 0);
  assert.equal(batches100[0].nextContext.length, 3);
  assert.equal(batches100[1].prevContext.length, 3);
  assert.equal(batches100[1].nextContext.length, 3);
  assert.equal(batches100[9].nextContext.length, 0);
});

// ── 6. 60 Sample Caption Lines End-to-End Simulation ──────────────────────

test('60 sample caption lines: produces exactly 60 lines, each starting with its exact input time, with skill style prefix', () => {
  // Generate 60 realistic caption lines at 3s intervals (0:00 to 2:57)
  const lines = [];
  for (let i = 0; i < 60; i++) {
    const totalSec = i * 3;
    const m = Math.floor(totalSec / 60);
    const s = String(totalSec % 60).padStart(2, '0');
    lines.push(`(${m}:${s}) Story narrative sentence for frame number ${i + 1}.`);
  }

  const rawCaptions = lines.join('\n');
  const validated = validateCaptionLines(rawCaptions);
  assert.equal(validated.valid, true);
  assert.equal(validated.validCount, 60);
  assert.equal(validated.lines.length, 60);

  // Divide into batches of 10
  const batches = createBatches(validated.lines, 10, 3);
  assert.equal(batches.length, 6); // exactly 6 batches of 10
  for (let b = 0; b < 6; b++) {
    assert.equal(batches[b].items.length, 10);
  }

  // Simulate model generation for all 6 batches (with varied/mangled model times)
  const detailedPromptSample = "A bright ordinary Tuesday morning in a cozy living room, shown as a wide establishing shot. Warm peach walls with a thin baseboard, a warm brown plank wooden floor, a large window letting in soft even daylight with a light sky-blue view, a slate-blue sofa with a mustard-yellow throw blanket, a small wooden side table holding a white mug, a tear-off wall calendar with no writing, and a potted plant in the corner. A round wall clock with a brown frame and tick marks only hangs above the sofa. The main character is a stick figure with a large perfectly round white head with a thick black outline, tiny dot eyes, a small flat mouth, a thin black line neck and body, wearing a plain blue t-shirt, blue jeans and white sneakers, sitting relaxed on the sofa with one arm resting on the armrest and a small smile, mid-ground with plenty of empty space around them. Flat colors, wobbly black ink outlines, minimal soft shading. hand-drawn 2D stick-figure doodle illustration, round white head with wobbly black ink outlines, thin black line limbs, flat colors with minimal soft shading, friendly saturated flat palette, simple even lighting, simple complete background, no text";

  const simulatedModelResponses = [];
  for (let i = 0; i < 60; i++) {
    // Model returns detailed ~200-word prompt
    simulatedModelResponses.push({
      time: `time_${i}`, // Model changed time
      prompt: detailedPromptSample
    });
  }

  const skillPrefix = 'Minimalist 2D black ink animation on textured parchment, stark rim lighting.';
  const built = buildPromptsOutput(validated.lines, simulatedModelResponses, {
    blankLineBetweenPrompts: false,
    stylePrefix: skillPrefix,
    aspectRatio: '16:9'
  });

  assert.equal(built.success, true);
  assert.equal(built.items.length, 60);

  const outputLines = built.rawOutputText.split('\n');
  assert.equal(outputLines.length, 60, 'Raw output must have exactly 60 lines separated by newline');

  // Verify each and every line
  for (let i = 0; i < 60; i++) {
    const expectedTime = validated.lines[i].rawTime;
    const line = outputLines[i];

    // Must start with exact input time
    assert.ok(
      line.startsWith(expectedTime),
      `Line ${i} should start with ${expectedTime}, got: ${line}`
    );

    // Must visibly include the skill style prefix
    assert.ok(
      line.includes(skillPrefix),
      `Line ${i} must include the skill prefix`
    );

    // Must end with the aspect ratio tag
    assert.ok(
      line.endsWith('--ar 16:9'),
      `Line ${i} must end with --ar 16:9`
    );

    // Must not have any internal line breaks
    assert.equal(line.includes('\r'), false);
  }
});

test('Prompts page HTML and scripts reflect streamlined UI, collapsible API, best background model, and 150-200 char prompts', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const start = html.indexOf('<div id="page-prompts"');
  const end = html.indexOf('<div id="page-images"');
  assert.ok(start > 0 && end > start, 'Expected #page-prompts section bounds');
  const promptsHtml = html.slice(start, end);

  for (const removed of [
    'Groq Storyboard Prompt Generation &amp; Visual Style Skills',
    'pr-btn-save-project',
    'pr-btn-open-project',
    'Save Project',
    'Open Project',
    'pr-model-select',
    'Groq Model',
    '1-Year Strict Cookie',
    'Saved securely in a browser cookie',
    'pr-style-notes',
    'Additional Directives',
    'pr-setting-length',
    'Prompt Length',
    'pr-setting-aspect-ratio',
    'Aspect Ratio',
    'Accepted formats:',
    'pr-btn-load-txt',
    'Load .txt',
    'pr-btn-clear-captions',
    'pr-skills-count',
    '0 of 5 skills used',
    '10 Prompts / Batch',
    "Skills are stored in this browser's IndexedDB",
    'Claude',
    'shadow-glow',
    'shadow-xl',
    'shadow-lg',
    'shadow-md'
  ]) {
    assert.equal(promptsHtml.includes(removed), false, `Removed text/element still present in #page-prompts: ${removed}`);
  }

  assert.ok(promptsHtml.includes('id="pr-api-toggle"'), 'Expected collapsible #pr-api-toggle header');
  assert.ok(promptsHtml.includes('id="pr-api-body"'), 'Expected collapsible #pr-api-body container');
  assert.ok(promptsHtml.includes('href="https://console.groq.com/keys"'), 'Expected Groq API link inside key section');
  assert.ok(promptsHtml.includes('id="pr-btn-reset"'), 'Expected Reset button inside Prompts');
  assert.ok(promptsHtml.includes('id="pr-btn-download-txt"'), 'Expected Export button inside Prompts output header');
  const outputHeaderIdx = promptsHtml.indexOf('id="pr-output-section"');
  const exportBtnIdx = promptsHtml.indexOf('id="pr-btn-download-txt"');
  const listIdx = promptsHtml.indexOf('id="pr-prompts-list"');
  assert.ok(outputHeaderIdx < exportBtnIdx && exportBtnIdx < listIdx, 'Expected Export button above generated prompts list');
  const capInputIdx = promptsHtml.indexOf('id="pr-captions-input"');
  const linesBadgeIdx = promptsHtml.indexOf('id="pr-lines-count-badge"');
  assert.ok(capInputIdx > 0 && linesBadgeIdx > capInputIdx, 'Expected timestamp lines count badge below captions textarea');

  const promptsUi = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'prompts_ui.js'), 'utf8');
  assert.ok(promptsUi.includes('model: DEFAULT_GROQ_MODEL'), 'Expected default best Groq model in prompts_ui.js');
  assert.ok(promptsUi.includes("aspectRatio: ''"), 'Expected no aspect ratio injected by default');

  const promptsGroq = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'prompts_groq.js'), 'utf8');
  assert.ok(promptsGroq.includes('150-200 characters') || promptsGroq.includes('150 to 200 characters'), 'Expected 150-200 character instruction in prompts_groq.js');
  assert.equal(promptsGroq.includes('doodle stick-figure'), false, 'No-skill prompt generator should not hardcode stick-figure / pastel style example');
  assert.equal(promptsUi.includes('(1:1 synced)'), false, 'Prompt output count badge should not show (1:1 synced)');

  const modalStart = html.indexOf('id="modal-skill-editor"');
  const modalEnd = html.indexOf('id="render-modal"', modalStart);
  assert.ok(modalStart > 0 && modalEnd > modalStart, 'Expected skill editor modal bounds');
  const modalHtml = html.slice(modalStart, modalEnd);
  assert.ok(modalHtml.includes('id="modal-btn-import-json"'), 'Expected Import JSON button in skill modal');
  assert.ok(modalHtml.includes('id="modal-btn-copy-claude-prompt"'), 'Expected Copy Claude Prompt button in skill modal');
  assert.ok(modalHtml.includes('How to Create JSON'), 'Expected How to Create JSON section in skill modal');
  assert.ok(modalHtml.includes('Open Claude'), 'Expected Open Claude instruction link in skill modal');
  assert.equal((modalHtml.match(/href="https:\/\/claude\.ai"/g) || []).length, 1, 'Expected exactly one clickable Claude link');
  const howToPos = modalHtml.indexOf('How to Create JSON');
  const importPos = modalHtml.indexOf('Already have a Style JSON?');
  const namePos = modalHtml.indexOf('id="modal-skill-name"');
  assert.ok(howToPos < importPos && importPos < namePos, 'Expected order: How to Create JSON -> Already have Style JSON -> Skill Name');
  assert.equal(modalHtml.includes('bg-teal-400'), false, 'Expected no teal dot on Already have a Style JSON');
  assert.equal(modalHtml.includes('points="20 6 9 17 4 12"'), false, 'Expected no tick checkmark icon in download instruction');
  assert.equal(modalHtml.includes('modal-btn-upload-images'), false, 'Upload images should be removed from skill modal');
  assert.equal(modalHtml.includes('modal-btn-analyze'), false, 'Analyze Style with Groq should be removed from skill modal');
  assert.equal(modalHtml.includes('modal-btn-toggle-json-paste'), false, 'Paste JSON toggle should be removed from skill modal');
  assert.equal(modalHtml.includes('(MAX 5 IMAGES)'), false, 'Max 5 images should be removed from skill modal title');
});

test('testGroqApiKey and generatePromptsBatch auto-fallback via /models when default model returns 404', async () => {
  const { testGroqApiKey, generatePromptsBatch } = await import('../public/js/prompts_groq.js');
  const origFetch = globalThis.fetch;
  const calledModels = [];

  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'whisper-large-v3' },
            { id: 'llama-3.1-8b-instant' },
            { id: 'openai/gpt-oss-120b' }
          ]
        })
      };
    }
    const body = JSON.parse(opts.body);
    calledModels.push(body.model);
    if (body.model === 'llama-3.3-70b-versatile') {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: { message: 'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.' } })
      };
    }
    if (body.messages?.[0]?.content?.includes('storyboard')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ prompts: [{ time: '(0:00)', prompt: 'Wide doodle scene with sunny window and desk, flat colors' }] }) } }]
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'OK' } }] })
    };
  };

  try {
    const res = await testGroqApiKey('gsk_test_key', 'llama-3.3-70b-versatile');
    assert.equal(res.ok, true);
    assert.equal(res.resolvedModel, 'openai/gpt-oss-120b');

    const batch = await generatePromptsBatch('gsk_test_key', 'llama-3.3-70b-versatile', {
      batchItems: [{ rawTime: '(0:00)', text: 'Morning coffee' }]
    });
    assert.equal(batch.length, 1);
    assert.equal(batch[0].time, '(0:00)');
    assert.ok(calledModels.includes('openai/gpt-oss-120b'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ── 9. Resume & Timestamp-Selective Regeneration ──────────────────────────

test('filterLinesFromTimestamp splits caption lines at start time without touching previous', () => {
  const sampleInput = `(0:00) First scene intro
(0:05) Walking along the beach
(0:12) Looking at the distant hills
(0:20) Sun setting over water
(0:23) Darkness falls upon the valley
(0:30) Stars begin to sparkle
(0:45) Campfire crackling softly`;

  const { lines } = validateCaptionLines(sampleInput);
  assert.equal(lines.length, 7);

  // 1. From beginning (0:00) -> all lines toGenerate, 0 preserved
  const r0 = filterLinesFromTimestamp(lines, '(0:00)');
  assert.equal(r0.preserved.length, 0);
  assert.equal(r0.toGenerate.length, 7);
  assert.equal(r0.startSec, 0);

  // 2. Start from (0:23) -> preserves 4 lines (< 23s), generates 3 lines (>= 23s)
  const r23 = filterLinesFromTimestamp(lines, '(0:23)');
  assert.equal(r23.preserved.length, 4);
  assert.equal(r23.toGenerate.length, 3);
  assert.equal(r23.startSec, 23);
  assert.equal(r23.preserved[r23.preserved.length - 1].rawTime, '(0:20)');
  assert.equal(r23.toGenerate[0].rawTime, '(0:23)');
  assert.equal(r23.toGenerate[1].rawTime, '(0:30)');
  assert.equal(r23.toGenerate[2].rawTime, '(0:45)');

  // 3. Start without parentheses "0:23"
  const r23b = filterLinesFromTimestamp(lines, '0:23');
  assert.equal(r23b.toGenerate.length, 3);
  assert.equal(r23b.startSec, 23);

  // 4. Start with raw seconds string "23", "23s", or number 23
  const r23c = filterLinesFromTimestamp(lines, '23');
  assert.equal(r23c.toGenerate.length, 3);
  assert.equal(r23c.startSec, 23);

  const r23d = filterLinesFromTimestamp(lines, '23s');
  assert.equal(r23d.toGenerate.length, 3);
  assert.equal(r23d.startSec, 23);

  const r23e = filterLinesFromTimestamp(lines, 23);
  assert.equal(r23e.toGenerate.length, 3);
  assert.equal(r23e.startSec, 23);

  // 5. Start beyond end
  const rBeyond = filterLinesFromTimestamp(lines, '(5:00)');
  assert.equal(rBeyond.preserved.length, 7);
  assert.equal(rBeyond.toGenerate.length, 0);
});

test('mergePreservedAndGeneratedItems keeps previous prompts intact and appends newly generated', () => {
  const preservedItems = [
    { index: 0, rawTime: '(0:00)', cleanTime: '0:00', timeSec: 0, promptText: 'CUSTOM USER EDITED PROMPT AT 0:00', fullPromptLine: '(0:00) CUSTOM USER EDITED PROMPT AT 0:00' },
    { index: 1, rawTime: '(0:20)', cleanTime: '0:20', timeSec: 20, promptText: 'PRESERVED SCENE PROMPT AT 0:20', fullPromptLine: '(0:20) PRESERVED SCENE PROMPT AT 0:20' }
  ];

  const newlyGeneratedItems = [
    { index: 0, rawTime: '(0:23)', cleanTime: '0:23', timeSec: 23, promptText: 'NEW PROMPT AT 0:23', fullPromptLine: '(0:23) NEW PROMPT AT 0:23' },
    { index: 1, rawTime: '(0:30)', cleanTime: '0:30', timeSec: 30, promptText: 'NEW PROMPT AT 0:30', fullPromptLine: '(0:30) NEW PROMPT AT 0:30' }
  ];

  const merged = mergePreservedAndGeneratedItems(preservedItems, newlyGeneratedItems);
  assert.equal(merged.length, 4);

  // Verify previous prompts were NOT overwritten and kept custom edits
  assert.equal(merged[0].promptText, 'CUSTOM USER EDITED PROMPT AT 0:00');
  assert.equal(merged[0].index, 0);
  assert.equal(merged[1].promptText, 'PRESERVED SCENE PROMPT AT 0:20');
  assert.equal(merged[1].index, 1);

  // Verify new prompts are in place and correctly re-indexed
  assert.equal(merged[2].rawTime, '(0:23)');
  assert.equal(merged[2].promptText, 'NEW PROMPT AT 0:23');
  assert.equal(merged[2].index, 2);
  assert.equal(merged[3].rawTime, '(0:30)');
  assert.equal(merged[3].promptText, 'NEW PROMPT AT 0:30');
  assert.equal(merged[3].index, 3);
});

test('index.html contains Start From Timestamp input and Resume button', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.ok(html.includes('id="pr-start-time"'), 'Should contain #pr-start-time input field');
  assert.ok(html.includes('id="pr-btn-reset-start-time"'), 'Should contain #pr-btn-reset-start-time button');
  assert.ok(html.includes('id="pr-btn-resume"'), 'Should contain #pr-btn-resume button');
  assert.ok(html.includes('id="pr-btn-generate-label"'), 'Should contain #pr-btn-generate-label');
  assert.ok(html.includes('id="pr-start-time-hint"'), 'Should contain #pr-start-time-hint');
});

test('parsePromptRange correctly parses custom ranges (1-10 for video, 11-end for images, all)', async () => {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const { parsePromptRange } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'prompts_ui.js')).href);

  // 1-10 for video
  const rangeVideo = parsePromptRange('1-10', 20);
  assert.deepEqual(rangeVideo, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // 11-end for images
  const rangeImages = parsePromptRange('11-end', 20);
  assert.deepEqual(rangeImages, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

  // 11- (trailing dash implies end)
  const rangeOpenEnd = parsePromptRange('11-', 20);
  assert.deepEqual(rangeOpenEnd, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

  // all
  const rangeAll = parsePromptRange('all', 5);
  assert.deepEqual(rangeAll, [0, 1, 2, 3, 4]);

  // single item
  const rangeSingle = parsePromptRange('5', 10);
  assert.deepEqual(rangeSingle, [4]);

  // mixed comma separated slices: 1-3, 5, 8-end
  const rangeMixed = parsePromptRange('1-3, 5, 8-end', 10);
  assert.deepEqual(rangeMixed, [0, 1, 2, 4, 7, 8, 9]);

  // out of bounds clamped safely
  const rangeClamped = parsePromptRange('1-999', 8);
  assert.equal(rangeClamped.length, 8);
  assert.equal(rangeClamped[0], 0);
  assert.equal(rangeClamped[7], 7);

  // invalid / empty returns empty array
  assert.deepEqual(parsePromptRange('', 20), []);
  assert.deepEqual(parsePromptRange('invalid', 20), []);
  assert.deepEqual(parsePromptRange('1-10', 0), []);
});

test('index.html renders Copy Prompts split button and custom range dropdown menu', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.ok(html.includes('id="pr-btn-copy-all"'), 'Should contain #pr-btn-copy-all');
  assert.ok(html.includes('id="pr-btn-copy-dropdown"'), 'Should contain #pr-btn-copy-dropdown');
  assert.ok(html.includes('id="pr-copy-menu"'), 'Should contain #pr-copy-menu');
  assert.ok(html.includes('id="pr-input-copy-range"'), 'Should contain #pr-input-copy-range');
  assert.ok(html.includes('id="pr-btn-copy-range-exec"'), 'Should contain #pr-btn-copy-range-exec');
  assert.ok(html.includes('1-10 (Video)'), 'Should contain 1-10 (Video) quick preset pill');
  assert.ok(html.includes('11-End (Images)'), 'Should contain 11-End (Images) quick preset pill');
});
