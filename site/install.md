# Install

Movy runs on [Schwung](https://github.com/charlesvestal/schwung), a framework
that runs custom instruments, effects and tools on Ableton Move. One command
installs both, plus a few sounds, and makes the Move start in Movy. Your Move
keeps everything it had: Move's own software is still there when you leave Movy.

!!! warning "Before you start"
    Schwung modifies the software on your Move and is not supported by Ableton.
    Back up any Sets and samples you care about. If you ever need to restore the
    Move completely, Ableton's **DFU restore mode** returns it to factory
    software; Schwung's README links the instructions.

## What you need

- The Move connected to the **same Wi-Fi network** as your computer (in Move's
  own settings). Your computer reaches it as `move.local`.
- A computer with a terminal: **macOS** or **Linux**. On Windows, use the
  [desktop installer](#other-ways-to-install) instead.

## Install with one command

Choose what you want, then copy the command into a terminal and press Enter.

<form id="install-builder" class="install-builder" onsubmit="return false">
<fieldset>
<legend>Start-up</legend>
<label><input type="checkbox" id="ib-boot" checked> Start the Move in Movy at power-on</label>
</fieldset>
<fieldset>
<legend>Sounds to install</legend>
<div class="ib-cols">
<div>
<strong>Synths</strong>
<label><input type="checkbox" name="module" value="dexed" checked> Dexed: FM synth</label>
<label><input type="checkbox" name="module" value="obxd" checked> OB-Xd: analog-style synth</label>
<label><input type="checkbox" name="module" value="plaits"> Plaits: macro oscillator</label>
<label><input type="checkbox" name="module" value="surge"> Surge XT: hybrid synth</label>
</div>
<div>
<strong>Drums</strong>
<label><input type="checkbox" name="module" value="mrdrums" checked> MrDrums: sample drums</label>
<label><input type="checkbox" name="module" value="simian"> SIMIAN: drum synth</label>
<label><input type="checkbox" name="module" value="dr32"> DrumRack32: Move's kits, 32 pads</label>
</div>
<div>
<strong>Effects</strong>
<label><input type="checkbox" name="module" value="mverb" checked> MVerb: plate reverb</label>
<label><input type="checkbox" name="module" value="dragonfly-hall"> Dragonfly Hall: hall reverb</label>
<label><input type="checkbox" name="module" value="tapedelay" checked> TapeDelay: tape delay</label>
</div>
</div>
</fieldset>
<fieldset>
<legend>Schwung version</legend>
<label><input type="radio" name="schwung" value="pinned" checked> The version this Movy is tested with (recommended)</label>
<label><input type="radio" name="schwung" value="latest"> Schwung's latest release</label>
<label><input type="radio" name="schwung" value="skip"> Don't touch Schwung</label>
</fieldset>
<fieldset>
<legend>More</legend>
<label><input type="checkbox" id="ib-sr"> Turn on Schwung's screen reader</label>
<label>Move address <input type="text" id="ib-host" value="move.local" size="16"></label>
</fieldset>
</form>

<div class="ib-out"><pre><code id="ib-command">curl -fsSL https://raw.githubusercontent.com/DimaDake/schwung-movy/main/scripts/install-movy.sh | sh -s -- --modules dexed,obxd,mrdrums,mverb,tapedelay</code></pre><button id="ib-copy" class="md-button md-button--primary">Copy</button></div>

**What the command does:**

1. Installs **Schwung** if it is missing or older than the version this Movy
   release is tested with. It never downgrades. The first time, Schwung's
   installer helps you set up access to the Move and asks you to confirm.
2. Installs the latest **Movy** and the **sounds** you ticked.
3. Makes the Move **start in Movy** at power-on, if you ticked it.

When it says **All set**, restart the Move. Then work through the
[Quick start](manual/quick-start.md).

The same command updates Movy later. Run it again any time.

## Other ways to install

=== "Desktop installer"

    For macOS, Windows and Linux, with no terminal:

    1. Download the **[Schwung Installer](https://github.com/charlesvestal/schwung-installer/releases/latest)**
       and run it. It sets up access to the Move, installs Schwung and offers
       a list of modules: tick **Movy** and a few sounds.
    2. To start in Movy at power-on, see [Open Movy](#open-movy) below.

=== "Schwung Manager"

    If Schwung (1.6.0 or newer) is already installed:

    1. On your computer, open **<http://move.local:7700>**. This is Schwung Manager,
       the web page the Move serves.
    2. Go to **Modules**, find **Movy** and click **Install**. Install a few sound
       generators and effects the same way.

## Open Movy

From the Move's **Tools** menu
: Hold **Shift**, touch the **volume knob** and click the **jog wheel** to open
  Schwung's Tools menu. Turn the jog to **Movy** and click. Move's own software
  closes while Movy runs, and comes back when you leave Movy.

At power-on
: If you chose it, the Move starts in Movy. To change it, press **Back** while the
  screen shows `Loading Movy — press Back to change` (about two seconds), and
  pick **Schwung** or **Movy**. Schwung Manager → **Boot** sets it too.

To leave Movy, press **Back** until the **Leave Movy?** menu appears, then click
**Close Movy**.

Modules you install later appear in Movy's module browser the next time you open Movy.

## Updating

Run the install command again, or click **Update** next to Movy in Schwung
Manager → **Modules**. Your Sets are kept.

## Uninstalling

In Schwung Manager, set **Boot** back to Schwung, then **Modules** → **Movy** →
**Uninstall**. Your Sets stay on the Move.

## Building from source

Developers who want to build and deploy Movy from a checkout should read
[CONTRIBUTING.md](https://github.com/DimaDake/schwung-movy/blob/main/CONTRIBUTING.md).
