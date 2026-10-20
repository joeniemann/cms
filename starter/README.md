# __NAME__

Website and editor, built with the CMS engine (github.com/joeniemann/cms).

## What lives here
- `content/` the words, photos and pages the client edits
- `templates/` how each block looks (this site's design)
- `assets/` CSS, scripts, fonts, images
- `cms/blocks.json` the blocks the editor offers and their fields
- `cms.config.json` the site's settings (GitHub repo, branches, page types)

The editor, page builder and editor functions come from the engine. Don't edit
`cms/build/`, `netlify/functions/` or `netlify/lib/`. They are rebuilt from the engine every time.

## Build it
    npm install
    npx cms build        # writes the site and the editor into dist/

## Update the engine
Change the version tag after `joeniemann/cms#` in package.json, run `npm install`, then `npx cms build`.

## A function only this site needs
Put it in `netlify/site-functions/`. The build copies it next to the engine's functions.
