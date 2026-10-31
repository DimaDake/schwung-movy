# Install

Movy runs on [Schwung](https://github.com/charlesvestal/schwung), a framework
that runs custom instruments, effects and tools on Ableton Move. Install Schwung
once, then add Movy from Schwung's module catalog. Your Move keeps working as
before, and Movy is one more tool on it.

!!! warning "Before you start"
    Schwung modifies the software on your Move. Back up any Sets and samples you
    care about. If you ever need to restore the Move completely, Ableton's
    **DFU restore mode** returns it to factory software. Schwung's README links
    the instructions.

## 1. Install Schwung

You need **Schwung 1.6.0 or newer**. First connect the Move to the same Wi-Fi
network as your computer (in Move's own settings). Your computer then reaches it
as `move.local`.

=== "Desktop installer (recommended)"

    1. Download the **[Schwung Installer](https://github.com/charlesvestal/schwung-installer/releases/latest)**
       for macOS, Windows or Linux.
    2. Run it and follow the steps. It sets up remote access to the Move (SSH) for
       you, installs Schwung and offers a list of modules to add.
    3. While you are there, tick **Movy** and a few **sound generators** (see step 3).

=== "Command line"

    On macOS or Linux, run this in a terminal:

    ```bash
    curl -L https://raw.githubusercontent.com/charlesvestal/schwung/main/scripts/install.sh | sh
    ```

    The script walks you through SSH setup if needed, installs Schwung and
    offers to install modules from the catalog.

Already have Schwung? Check its version in **Schwung Manager**: open
<http://move.local:7700> and go to **System**. Update there if it is older than 1.6.0.

## 2. Install Movy

=== "Schwung Manager (no terminal)"

    1. On your computer, open **<http://move.local:7700>**. This is Schwung Manager,
       the web page the Move serves.
    2. Go to **Modules** and find **Movy** (it is listed under **Tools**).
    3. Click **Install**.

=== "One-line script"

    ```bash
    curl -fsSL https://raw.githubusercontent.com/DimaDake/schwung-movy/main/scripts/install-movy.sh | sh
    ```

    The script asks Schwung Manager on the Move to install the latest Movy
    release, so the result is the same as clicking **Install**. Options:

    | Option | What it does |
    | --- | --- |
    | `--boot` | Also make the Move power on straight into Movy (see below). |
    | `--host <name>` | Use another address than `move.local`, for example an IP address. |

    Pass options after `sh -s --`, for example `... | sh -s -- --boot`.

## 3. Add some sounds

Movy plays Schwung **modules**, so it needs at least one sound generator
installed. In Schwung Manager → **Modules**, install a few from the
**Sound generators** list, for example:

- a synth such as **Dexed** (FM) or **OB-Xd** (analog-style),
- a drum machine such as **Mr Drums**, **DR32** or **Simian**,
- an effect or two (reverb, delay) for the track FX slots and the send effects.

Modules you install later appear in Movy's module browser the next time you open Movy.

## 4. Open Movy

From the Move's **Tools** menu
: Hold **Shift**, touch the **volume knob** and click the **jog wheel** to open
  Schwung's Tools menu. Turn the jog to **Movy** and click. Move's own software
  closes while Movy runs (this takes a few seconds), and comes back when you
  leave Movy.

Straight from power-on
: Installing Movy adds a **Movy** entry to Schwung's boot picker. At power-on the
  screen shows `Loading <name> — press Back to change` for about two seconds.
  Press **Back**, turn the jog to **Movy** and click. From then on the Move
  starts in Movy every time. To go back, press **Back** in that same window and
  pick **Schwung**. You can also set this in Schwung Manager → **Boot**.

To leave Movy, press **Back** until the **Leave Movy?** menu appears, then click
**Close Movy**. See [Settings & system](manual/system.md#opening-and-leaving-movy).

## Updating

New Movy versions appear in Schwung Manager → **Modules** with an **Update**
button. You can also rerun the one-line script. Your Sets are kept.

## Uninstalling

In Schwung Manager → **Modules** → **Movy**, click **Uninstall**. If the Move
was set to boot into Movy, set the boot default back to Schwung first, on the
**Boot** page. Your Sets stay on the Move.

## Building from source

Developers who want to build and deploy Movy from a checkout should read
[CONTRIBUTING.md](https://github.com/DimaDake/schwung-movy/blob/main/CONTRIBUTING.md).
