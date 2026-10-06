# ytm-desktop controller

![](assets/cover.png)

This streamdeck plugin allows you to control YouTube Music with [pear-desktop](https://github.com/pear-devs/pear-desktop) (previous name: th-ch/ytm-desktop). 

[![Marketplace](https://img.shields.io/badge/Available_at-Elgato_Marketplace-3E72BC)](https://marketplace.elgato.com/product/ytm-desktop-controller-7dfe9fc1-80a9-44e3-80c5-4cf456b74a2b)
[![Buy Me a Coffee](https://img.shields.io/badge/-buy_me_a%C2%A0coffee-gray?logo=buy-me-a-coffee)](https://www.buymeacoffee.com/yate)
[![Stars](https://img.shields.io/github/stars/tuat-yate/ytm-desktop-controller)](https://github.com/tuat-yate/ytm-desktop-controller/stargazers)
[![Watchers](https://img.shields.io/github/watchers/tuat-yate/ytm-desktop-controller)](https://github.com/tuat-yate/ytm-desktop-controller/watchers)

## Setup

> [!IMPORTANT]
> This plugin requires **pear-desktop v3.11.0 or later** (verified with v3.12.0), with its **API Server** plugin
> enabled and set to **no authorization**. Nothing works without it — the keys show a red **Setup** warning while the
> API cannot be reached.
>
> On older builds the keys still work, but Like / Dislike cannot show whether the current song is rated: the
> `/like-state` endpoint was added in v3.11.0.

1. Install [pear-desktop](https://github.com/pear-devs/pear-desktop) (v3.11.0 or later)  
    Please refer [pear-desktop installation guide](https://github.com/pear-devs/pear-desktop?tab=readme-ov-file#download).
2. Set API Plugin on pear-desktop  
    Please click `Plugins -> API Server [beta]`, then, set `Plugins -> API Server [beta] -> Authorization strategy -> No authorization`.  
    Note: Default port number of API is set to `26538` (you can check it in `Plugins -> API Server [beta] -> Port`). 

3. Install Streamdeck Plugin [here](https://marketplace.elgato.com/product/ytm-desktop-controller-7dfe9fc1-80a9-44e3-80c5-4cf456b74a2b)

### Installing a Beta build (`.streamDeckPlugin`)
Pre-release (beta) builds are published as a `.streamDeckPlugin` file on the [GitHub Releases](https://github.com/tuat-yate/ytm-desktop-controller/releases) page, so you can test fixes before they reach the Marketplace.

1. Make sure the Stream Deck app is installed and running.
2. Download the `.streamDeckPlugin` file from the [latest release](https://github.com/tuat-yate/ytm-desktop-controller/releases).
3. Double-click the downloaded file. The Stream Deck app shows an install prompt — click **Install**.
4. The action group **ytm-desktop controller (Beta)** appears in the actions list.

> [!NOTE]
> Installing a beta build replaces the Marketplace version (they share the same plugin ID). You can reinstall the Marketplace version anytime to go back.

For the general procedure of installing a downloaded plugin, see Elgato's official guide: [Stream Deck — Download and use Plugins](https://help.elgato.com/hc/en-us/articles/33589587352337-Elgato-Stream-Deck-Download-and-use-Plugins).

## Actions
- [Base Arguments](#base-arguments)
- [Add Playlist to Queue](#add-playlist-to-queue)
- [Add to Playlist](#add-to-playlist)
- [Artwork](#artwork)
- [Go Forward](#go-forward)
- [Go Back](#go-back)
- [Toggle Play](#toggle-play)
- [Next](#next)
- [Previous](#previous)
- [Like](#like)
- [Dislike](#dislike)
- [Shuffle](#shuffle)
- [Repeat](#repeat)
- [Set Volume](#set-volume)
- [Volume Up / Volume Down](#volume-up--volume-down)
- [Toggle Mute](#toggle-mute)
- [Volume Dial / Seek Dial (Stream Deck +)](#volume-dial--seek-dial-stream-deck-)

---
  
### Base Arguments
These options are shared by every action that can display the now-playing artwork (**Artwork**, **Add Playlist to Queue**, **Toggle Play**, **Next**, **Previous**). For example, enabling them on **Toggle Play** gives you a single key that shows the album art (with track info / progress) and toggles play/pause when pressed.

| Argument | Description |
|---|---|
| `Port` | Port number of the API. Default is `26538`. Shared by every key. |
| `Show Now-playing Artwork` | Show artwork if play. This option will save when the streamdeck is restarted. Please restart or page switch to apply the setting.  |
| `Show Track Info` | Overlay the now-playing text (e.g. title / artist) on top of the artwork. Long text scrolls automatically. Requires `Show Now-playing Artwork`. |
| `Text Template` | The text shown when `Show Track Info` is enabled. Supports the tokens below. Defaults to `{title} - {artist}`. |
| `Text Position` | Where the text sits on the key: `Top`, `Middle` or `Bottom` (default). |
| `Font` | Font of the text. Pick one of the common Windows / macOS fonts (including Korean and Japanese ones), or `Custom` to type any font name installed on your PC in `Custom Font`. |
| `Font Size` | Size of the text in pixels on the 144 × 144 key image. Default `24`. |
| `Font Weight` | `Bold` (default) or `Normal`. |
| `Text Color` | Color of the text. Default white. With a dark color the shade behind the text turns light so it stays readable. |
| `Text Background` | Shade the artwork behind the text (a fade at the top / bottom, a band in the middle). On by default. |
| `Show Progress Bar` | Show a green playback progress bar along the bottom edge of the artwork. Requires `Show Now-playing Artwork`. |

The text options are disabled while `Show Track Info` is off.

#### Text Template tokens
You can freely combine the following tokens (plus any literal text) in `Text Template`:

| Token | Replaced with |
|---|---|
| `{title}` | Track title |
| `{artist}` | Artist name |
| `{album}` | Album name |
| `{elapsed}` | Playback position, e.g. `1:23` |
| `{duration}` | Length of the song, e.g. `5:55` |
| `{remaining}` | Time left, e.g. `-4:32` |

Examples:
- `{title} - {artist}` → `Bohemian Rhapsody - Queen`
- `{artist}: {title}` → `Queen: Bohemian Rhapsody`
- `♪ {title}` → `♪ Bohemian Rhapsody`
- `{elapsed} / {duration}` → `1:23 / 5:55`

### Add Playlist to Queue
Add a YouTube Music playlist to the queue. While it works the key shows `Loading…`, then how many songs were queued.
> [!NOTE]
> The playlist must be shared as `Public` or `Unlisted` — or, if you have set up the cookie for [Add to Playlist](#add-to-playlist),
> it can also be one of your private playlists.

| Argument | Description |
|---|---|
| `Playlist` | The shared link (`https://music.youtube.com/playlist?list=abcde`) or just the ID (`abcde`). |
| `When pressed` | What the key does with the queue — see [When pressed](#when-pressed). |
| `Shuffle` | Shuffle the playlist before adding to the queue. |

Songs that cannot be played in your region are skipped, and at most 200 songs are added per press (pear-desktop adds them one
by one, so 200 songs take around 15 seconds — playback starts as soon as the first one is in).

#### When pressed

| Option | Behaviour |
|---|---|
| `Add to the end of the queue` (default) | Appends to the queue and leaves playback alone. Starts playing only when nothing is playing. |
| `Play now (replace the queue)` | Starts the playlist right away and removes the songs that were in the queue before. |
| `Play next (keep the queue)` | Inserts right after the current song and plays it immediately. The rest of the queue is kept. |

### Add to Playlist
Add the song that is playing now to one of your own YouTube Music playlists. The key turns green while the current song is
already in that playlist, and shows `Added` / `Already added` after a press.

| Argument | Description |
|---|---|
| `Playlist` | Pick one of your playlists (the list is loaded from YouTube Music; use the refresh button after creating a new one). |
| `Or Link / ID` | Paste a playlist link or ID instead. Used when filled in. |
| `Duplicates` | Add the song even if it is already in the playlist. Off by default (the key just shows `Already added`). |
| `Cookie` | Your YouTube Music login cookie — see below. Shared by every key. |
| `Account No.` | Only if you are signed in to several Google accounts in that browser: the account number (`0` for the first, `1` for the second, …). |
| `Brand Account` | Only for a brand account channel: its ID. |

pear-desktop's API cannot edit playlists, so this action talks to YouTube Music directly with the cookie of a browser that is
signed in to the same account:

1. Open [music.youtube.com](https://music.youtube.com) in Chrome / Edge / Firefox and sign in.
2. Press `F12` to open the developer tools and select the **Network** tab, then reload the page.
3. Type `browse` in the filter box and click one of the requests to `music.youtube.com/youtubei/v1/browse`.
4. Under **Request Headers**, copy the whole value of `cookie` (it is long and contains `SAPISID=` / `__Secure-3PAPISID=`).
5. Paste it into `Cookie`.

> [!WARNING]
> The cookie is your login session — treat it like a password. It is stored only in the Stream Deck settings on this PC, is
> not included when you export a profile, and is sent only to `music.youtube.com`. It stops working when you sign out in that
> browser (the key then shows `Cookie expired?`); copy it again in that case.

### Artwork
Displays the album art of the currently playing song. It can optionally overlay the
now-playing text (with automatic scrolling for long titles) and a playback progress bar.
See [Base Arguments](#base-arguments) for `Show Track Info`, `Text Template`, and
`Show Progress Bar`.

### Go Forward
Fast-forward the currently playing song. 

| Argument | Description |
|---|---|
| `time` | The number of seconds to fast-forward. |

### Go Back
Rewind the currently playing song.

| Argument | Description |
|---|---|
| `time` | The number of seconds to rewind. |

### Toggle Play
Toggle play/pause. Can also display the now-playing artwork (with optional track info / progress bar) — see [Base Arguments](#base-arguments).

### Next
Skip to the next track. Can also display the now-playing artwork — see [Base Arguments](#base-arguments).

### Previous
Skip to the previous track. Can also display the now-playing artwork — see [Base Arguments](#base-arguments).

### Like
Like the currently playing song.

The key turns pink while the currently playing song is liked, and goes back to the normal look when the like is removed
or the track changes. The state is polled once a second from pear-desktop, so it also follows likes you make in the app
itself. (Needs pear-desktop v3.11.0 or later — on older builds the key just keeps its normal look.)

If **Show Artwork** is enabled the artwork covers the key, so turn it off to see the colour.

### Dislike
Dislike the currently playing song. The key turns blue while the currently playing song is disliked — same behaviour as
[Like](#like). 

### Shuffle
Toggle shuffle. The key turns green while shuffle is on.

### Repeat
Switch the repeat mode: off → all → one → off. The key turns green for "repeat all" and shows a `1` for "repeat one".

### Set Volume
Set the volume to a fixed level.

| Argument | Description |
|---|---|
| `Volume` | 0–100, in steps of 5. |

### Volume Up / Volume Down
Raise or lower the volume. Hold the key to keep changing it. The new volume is shown on the key for a moment.

| Argument | Description |
|---|---|
| `Step` | How much one press changes the volume. Default `10%`. |

### Toggle Mute
Mute / unmute. The key turns red while muted.

### Volume Dial / Seek Dial (Stream Deck +)
Dial actions for the Stream Deck +. The touch strip shows the volume / the playback position.

| Action | Rotate | Press / touch |
|---|---|---|
| Volume Dial | Change the volume | Mute / unmute |
| Seek Dial | Seek forward / back | Play / pause |

| Argument | Description |
|---|---|
| `Step per click` | Volume Dial: % per click (default `5`). Seek Dial: seconds per click (default `5`). |

---

## Disclaimer
This plugin is an unofficial extension and is not affiliated with, endorsed by, or associated with YouTube, YouTube Music, or Google LLC. 
All product and company names are trademarks™ or registered® trademarks of their respective holders. Use of them does not imply any affiliation with or endorsement by them.

## Development & Support
This project is developed by an individual. While I strive to ensure stability, please understand that bugs or issues may exist.

* **Contributions:** Pull Requests are highly welcome! If you find a bug or want to improve the code, please feel free to contribute.
* **Donations:** If you find this plugin useful and would like to support its development, please consider buying me a coffee.  
[![Buy Me a Coffee](https://img.shields.io/badge/-buy_me_a%C2%A0coffee-gray?logo=buy-me-a-coffee)](https://www.buymeacoffee.com/yate)


### Releasing
Push a tag that starts with `v` and GitHub Actions builds the plugin, creates a GitHub Release and attaches the
`.streamDeckPlugin` file (`.github/workflows/release.yml`). The tag becomes the plugin version (`v0.4.1` → `0.4.1.0`), and a
tag with a hyphen (`v0.5.0-beta.1`) is published as a pre-release.

```
git tag v0.4.1
git push origin v0.4.1
```

### Icons
All key images are generated from the SVG sources in `tools/icons/` (a white glyph on a transparent 256x256 canvas):

```
npm run icons              # regenerate every image
npm run icons -- like next # only these sources
```

`<action>.svg` writes `imgs/actions/<action>/{icon,icon@2x,key,key@2x}.png`, and `logo.svg` writes the plugin's
`category-icon` / `marketplace` images. Actions with extra states (`like`, `dislike`, `add-to-playlist`, `toggle-mute`,
`shuffle`, `repeat`) additionally get `key-<state>[@2x].png` — the glyph on a full-bleed colour instead of the circle — and
a state can use a different glyph from `tools/icons/states/`. The dial actions also get `encoder[@2x].png`. Colours, sizes
and the state list live at the top of `tools/gen-icons.mjs`.
