/* global browser, chrome */
if (typeof browser !== 'undefined') {
  browser.devtools.panels.create('Rede limpa', '', 'panel.html').catch(console.error);
} else {
  chrome.devtools.panels.create('Rede limpa', '', 'panel.html');
}
