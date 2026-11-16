/**
 * video_ui.js — UI Controller for SceneFlow Video (Google Flow Video Batcher)
 */

export const GOOGLE_FLOW_VIDEO_URL = 'https://flow.google.com/shared/tool/5a227913-6905-4e4f-ad45-bcfa29faa5ca';

const $ = (id) => document.getElementById(id);

export async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document !== 'undefined') {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
  return false;
}

export function extractGeneratedPromptsText() {
  if (typeof document === 'undefined') return '';
  const rows = document.querySelectorAll('#pr-prompts-list .prompt-row');
  if (!rows || !rows.length) return '';

  const lines = [];
  rows.forEach((row) => {
    const timeBadge = row.querySelector('span');
    const textarea = row.querySelector('.prompt-input');
    const rawTime = timeBadge ? timeBadge.textContent.trim() : '';
    const promptVal = textarea ? textarea.value.trim() : '';
    if (rawTime && promptVal) {
      lines.push(`${rawTime} ${promptVal}`);
    } else if (promptVal) {
      lines.push(promptVal);
    }
  });
  return lines.join('\n');
}

export function initVideoUI() {
  const copyLinkBtn = $('vid-btn-copy-link');
  const copyLinkLabel = $('vid-copy-link-label');
  const openBtn = $('vid-btn-open-batcher');

  if (openBtn) {
    openBtn.href = GOOGLE_FLOW_VIDEO_URL;
  }

  let resetTimer = null;

  if (copyLinkBtn) {
    copyLinkBtn.onclick = async () => {
      const ok = await copyTextToClipboard(GOOGLE_FLOW_VIDEO_URL);
      if (copyLinkLabel) {
        copyLinkLabel.textContent = ok ? 'Copied!' : GOOGLE_FLOW_VIDEO_URL;
      }
      copyLinkBtn.classList.add('border-emerald-500/60', 'text-emerald-300');
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        if (copyLinkLabel) copyLinkLabel.textContent = 'Copy link';
        copyLinkBtn.classList.remove('border-emerald-500/60', 'text-emerald-300');
      }, 2200);
    };
  }

  // Wire navigation links inside #page-video (e.g. "Prompts" and "Studio")
  if (typeof document !== 'undefined') {
    document.querySelectorAll('#page-video [data-nav-target]').forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault();
        const target = el.getAttribute('data-nav-target');
        if (target && typeof window.switchToTab === 'function') {
          window.switchToTab(target);
        }
      };
    });
  }
}
