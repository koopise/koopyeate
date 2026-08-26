# koopyeate

A lightweight, single-file browser whiteboard for quick ideation — built for pasting reference photos, sketching, and sticky-note brainstorming without any backend or account.

## Features

- **Paste images** — `Ctrl+V` / `Cmd+V` drops any clipboard image straight onto the canvas
- **Drag & drop** — drop image files from your desktop directly onto the board
- **Sticky notes** — press `N`, click to place, double-click to edit text
- **Freehand pen + eraser** — sketch quick ideas, adjustable color and size
- **Infinite canvas** — scroll to pan, `Ctrl` + scroll to zoom
- **Move / resize / delete** — click any item to select, drag corner to resize, click × to delete
- **Undo** — `Ctrl+Z`
- **Autosave** — board persists in browser local storage automatically
- **Export / Import** — save board as `.json` for backup, or export the canvas as a `.png` image

## Usage

Open `index.html` in any modern browser — no build step, no dependencies, no server required.

## Deploying

This is a static site. Deploy directly with [Vercel](https://vercel.com):

1. Import this repository at [vercel.com/new](https://vercel.com/new)
2. Leave all build settings blank (no framework, static site)
3. Click **Deploy**

Your whiteboard will be live at a `*.vercel.app` URL within a minute. Every future push to `main` auto-redeploys.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `V` | Select / move tool |
| `P` | Pen tool |
| `E` | Eraser tool |
| `N` | Add sticky note |
| `Ctrl/Cmd + V` | Paste image from clipboard |
| `Ctrl/Cmd + Z` | Undo |
| `Delete` / `Backspace` | Delete selected item |

## Notes

Board state is stored in browser `localStorage`, scoped to one browser on one device. Export to `.json` regularly if you want a portable backup or plan to switch devices.
