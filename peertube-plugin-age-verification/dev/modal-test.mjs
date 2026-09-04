// Drives the verification modal in jsdom, because two things about it are easy
// to break and impossible to see from the server side:
//
//  1. Clicking the buttons. The navigation blocker installs capture-phase
//     listeners on document, and anything it stops never reaches its target --
//     which once left both modal buttons completely dead.
//  2. Translating the labels. peertubeHelpers.translate is an exact key lookup
//     that falls back to the string it was given, so any age interpolated into
//     a label BEFORE the lookup silently defeats every translation.
//
// Needs jsdom, deliberately not a dependency of the plugin itself:
//
//   cd dev && npm install && node modal-test.mjs

import { JSDOM } from 'jsdom'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CLIENT = new URL('../age-verification-client.js', import.meta.url)
const DE = JSON.parse(readFileSync(new URL('../languages/de.json', import.meta.url), 'utf8'))

const BASE_SETTINGS = {
  enabled: true,
  'minimum-age': '18',
  'verification-title': 'Age Verification Required',
  'verification-message': 'This website contains age-restricted content. You must be {age} years or older to access this content.',
  'redirect-url': 'https://example.com',
  'verification-expiry-days': '30',
  'apply-blur-effect': true,
  'block-navigation': true
}

// Same semantics as peertubeTranslate() in @peertube/peertube-core-utils:
// exact key match, otherwise the original string.
const translateWith = translations => async str => translations?.[str] ?? str

async function showModal ({ settings = {}, translations = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><my-app><a href="/videos">a link</a></my-app></body></html>', {
    url: 'http://localhost:9000/',
    pretendToBeVisual: true
  })
  for (const k of [ 'window', 'document', 'localStorage', 'Element', 'Node', 'HTMLElement', 'MouseEvent', 'KeyboardEvent' ]) {
    globalThis[k] = k === 'window' ? dom.window : dom.window[k]
  }

  const state = { confirmRan: false, cancelRan: false }
  const peertubeHelpers = {
    getSettings: async () => ({ ...BASE_SETTINGS, ...settings }),
    translate: translateWith(translations),
    notifier: { success: () => {} },
    // Mirrors client/src/app/modal/custom-modal.component.html: ng-bootstrap
    // appends the modal to <body>, and its buttons use (click) bindings, i.e.
    // ordinary bubble-phase listeners on the elements themselves.
    showModal: ({ title, content, cancel, confirm }) => {
      const win = dom.window.document.createElement('ngb-modal-window')
      win.innerHTML = `<div class="modal"><div class="modal-header">${title}</div>` +
        `<div class="modal-body">${content}</div><div class="modal-footer">` +
        `<input type="button" class="secondary-button" value="${cancel.value}">` +
        `<input type="button" class="primary-button" value="${confirm.value}"></div></div>`
      dom.window.document.body.appendChild(win)
      win.querySelector('.secondary-button').addEventListener('click', () => { state.cancelRan = true; cancel.action() })
      win.querySelector('.primary-button').addEventListener('click', () => { state.confirmRan = true; confirm.action() })
    }
  }

  // The client script is an ES module, so it has to export register
  let code = readFileSync(CLIENT, 'utf8')
  if (!/export\s+(async\s+)?function register/.test(code)) code += '\nexport { register }\n'
  const tmp = pathToFileURL(join(tmpdir(), 'age-verification-client.test.mjs'))
  writeFileSync(tmp, code)

  const hooks = {}
  const { register } = await import(tmp.href + '?t=' + Date.now())
  register({ registerHook: ({ target, handler }) => { hooks[target] = handler }, peertubeHelpers })

  await hooks['action:application.init']()
  await new Promise(r => setTimeout(r, 800))

  const modal = dom.window.document.querySelector('ngb-modal-window')
  return {
    dom,
    state,
    modal,
    title: modal?.querySelector('.modal-header').textContent,
    message: modal?.querySelector('.modal-body').textContent.trim(),
    cancelLabel: modal?.querySelector('.secondary-button').value,
    confirmLabel: modal?.querySelector('.primary-button').value,
    click: el => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  }
}

const results = {}

// --- buttons respond, and the page stays inert until they do -----------------
{
  const m = await showModal()
  results['modal is shown'] = !!m.modal

  const link = m.dom.window.document.querySelector('my-app a')
  const before = new m.dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
  link.dispatchEvent(before)
  results['page click blocked while unverified'] = before.defaultPrevented

  m.click(m.modal.querySelector('.primary-button'))
  await new Promise(r => setTimeout(r, 200))

  results['"Yes" handler ran'] = m.state.confirmRan
  results['verification stored'] = globalThis.localStorage.getItem('peertube-age-verification-status') === 'verified'
  results['blur removed'] = !m.dom.window.document.querySelector('my-app').classList.contains('age-verification-blur-active')

  const after = new m.dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
  link.dispatchEvent(after)
  results['page click allowed after verifying'] = !after.defaultPrevented
}

// --- labels stay translated when the configured age is not the default -------
{
  const m = await showModal({ settings: { 'minimum-age': '21' }, translations: DE })
  results['title translated'] = m.title === DE['Age Verification Required']
  results['message translated'] = m.message.includes('altersbeschränkte')
  results['message uses configured age'] = m.message.includes('21') && !m.message.includes('18')
  results['buttons translated'] = m.confirmLabel.startsWith('Ja,') && m.cancelLabel.startsWith('Nein,')
  results['buttons use configured age'] = m.confirmLabel.includes('21') && m.cancelLabel.includes('21')
}

for (const [ k, v ] of Object.entries(results)) console.log((v ? 'PASS  ' : 'FAIL  ') + k)
process.exit(Object.values(results).every(Boolean) ? 0 : 1)
