/* The Install page's command builder: the form's choices become the options
 * of scripts/install-movy.sh, shown as one line to paste into a terminal.
 *
 * The sound list is curated: every module plays without ROMs or files you
 * supply, comes with presets or kits, and works well on Movy's pages. `rec`
 * marks the starter kit. Names and descriptions follow Schwung's catalog. */
(function () {
  const URL = 'https://raw.githubusercontent.com/DimaDake/schwung-movy/main/scripts/install-movy.sh';

  const SOUNDS = [
    ['Synths', [
      ['dexed', 'Dexed', 'DX7 FM synth with the classic patches. The lightest synth on CPU.', true],
      ['obxd', 'OB-Xd', 'Oberheim OB-X analog polysynth, 128 presets.', true],
      ['hera', 'Hera', 'Juno-60 with its BBD chorus: pads and strings.', true],
      ['noisemaker', 'NoiseMaker', 'TAL NoiseMaker virtual analog, dual oscillators and sub.'],
      ['surge', 'Surge XT', 'Huge hybrid synth with 600+ presets. Heavy on CPU.'],
      ['wurl', 'Wurl', 'Physically modelled Wurlitzer 200A electric piano.'],
      ['quilt', 'Quilt', '38 soft instruments: felt pianos, vibraphones, bowed cello, flute, choir.'],
      ['setbfree-organ', 'setBfree', 'Hammond B3 tonewheel organ with drawbars.'],
    ]],
    ['Bass & mono', [
      ['hush1', 'HUSH ONE', 'Roland SH-101 mono synth: basses and leads.', true],
      ['303', '303', 'TB-303 acid bass with Devilfish mods and drive.'],
      ['model-72', 'Model-72', 'Circuit-modelled Minimoog Model D.'],
      ['plaits', 'Plaits', 'Mutable Instruments macro oscillator, 24 engines. Light on CPU.'],
      ['braids', 'Braids', 'Mutable Instruments macro oscillator, 47 algorithms.'],
    ]],
    ['Drums', [
      ['8w8', '8W8', 'TR-808: sixteen synthesized voices.', true],
      ['9w9', '9W9', 'TR-909: modelled kick, snare and toms, sampled hats.', true],
      ['dr32', 'DrumRack32', "Plays Move's own drum kits, on 32 pads.", true],
      ['simian', 'SIMIAN', 'Ten-voice drum synth, with per-voice sends.'],
      ['weird-dreams', 'Weird Dreams', 'Analog drum machine with 64 kits.'],
      ['forge', 'Forge', 'FM/subtractive drums with a Kit A/B morph.'],
      ['6w6', '6W6', 'TR-606 drums, all synthesized.'],
      ['cw78', 'CW-78', 'Roland CR-78 drums, all synthesized.'],
    ]],
    ['Effects', [
      ['dragonfly-hall', 'Dragonfly Hall', 'Lush hall reverb, 25 presets. Great on a send.', true],
      ['tapedelay', 'TapeDelay', 'Tape delay with flutter. Light enough for every track.', true],
      ['mverb', 'MVerb', 'Plate reverb.'],
      ['cloudseed', 'CloudSeed', 'Big, long ambient reverb.'],
      ['tape-echo2', 'Tape Echo 2', 'Three-head tape echo with spring reverb.'],
      ['shimmerwash', 'Shimwash', 'Shimmer reverb, 13 presets.'],
      ['junologue-chorus', 'Junologue Chorus', 'Juno-60 chorus.'],
      ['ottx', 'OTTx', 'Multiband compressor, the OTT sound.'],
      ['busdriver', 'Bus Driver', 'One-knob glue for drums.'],
    ]],
  ];

  function renderSounds(box) {
    box.innerHTML = SOUNDS.map(([group, mods]) => '<div><strong>' + group + '</strong>' + mods.map(([id, name, desc, rec]) =>
      '<label><input type="checkbox" name="module" value="' + id + '"' + (rec ? ' checked data-rec="1"' : '') + '> <b>' + name +
      '</b><span class="ib-desc">' + desc + '</span></label>').join('') + '</div>').join('');
  }

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
    renderSounds(document.getElementById('ib-modules'));
    const out = document.getElementById('ib-command');
    const update = () => { out.textContent = build(form); };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      const pick = b.dataset.pick;
      form.querySelectorAll('input[name="module"]').forEach((c) => {
        c.checked = pick === 'all' || (pick === 'rec' && c.dataset.rec === '1');
      });
      update();
    }));
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
