/* The Install page's command builder: the form's choices become the options
 * of scripts/install-movy.sh, shown as one line to paste into a terminal. */
(function () {
  const URL = 'https://raw.githubusercontent.com/DimaDake/schwung-movy/main/scripts/install-movy.sh';

  function build(form) {
    const args = [];
    const modules = [...form.querySelectorAll('input[name="module"]:checked')].map((c) => c.value);
    if (modules.length) args.push('--modules ' + modules.join(','));
    if (!form.querySelector('#ib-boot').checked) args.push('--no-boot');
    const schwung = form.querySelector('input[name="schwung"]:checked').value;
    if (schwung !== 'pinned') args.push('--schwung ' + schwung);
    if (form.querySelector('#ib-sr').checked) args.push('--screen-reader');
    const host = form.querySelector('#ib-host').value.trim();
    if (host && host !== 'move.local' && /^[\w.:-]+$/.test(host)) args.push('--host ' + host);
    return 'curl -fsSL ' + URL + ' | sh' + (args.length ? ' -s -- ' + args.join(' ') : '');
  }

  function init() {
    const form = document.getElementById('install-builder');
    if (!form || form.dataset.ready) return;
    form.dataset.ready = '1';
    const out = document.getElementById('ib-command');
    const update = () => { out.textContent = build(form); };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    document.getElementById('ib-copy').addEventListener('click', (e) => {
      e.preventDefault();
      navigator.clipboard.writeText(out.textContent).then(() => {
        e.target.textContent = 'Copied';
        setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
      });
    });
    update();
  }

  // Material's instant navigation swaps pages without a reload.
  if (window.document$) window.document$.subscribe(init);
  else document.addEventListener('DOMContentLoaded', init);
})();
