# CMS

A simple website editor and page builder for client sites. Each client site keeps its own
content, templates and design. The engine supplies the build, the editor screens and the
editor functions, so a fix is made once.

## What is in here
- `build/`      page builder: templates plus content in, finished pages out. Also writes the sitemap, robots.txt, llms.txt, share tags and schema.
- `admin/`      the editor the client logs in to
- `netlify/`    the editor functions (login check, drafts, photos, history, make it live)
- `starter/`    a blank client site to copy from
- `bin/cms.js`  the command line: `cms build`, `cms sync`, `cms init`, `cms version`

## Start a new client site
    node bin/cms.js init ../new-client --name "Client Name" --repo joeniemann/new-client
    cd ../new-client
    npm install
    npx cms build

Then fill in `content/site.json` (business details and the `seo` block), restyle `assets/css/site.css`,
and push the repo to GitHub.

## Connect it to Netlify
1. New site from the client's GitHub repo. The build command and publish folder come from `netlify.toml`.
2. Turn on Netlify Identity (invite only) and add the client's logins with the role `owner` or `editor`.
3. Set these environment variables: `GITHUB_TOKEN` (a token that can write to the client's repo) and, if the
   branches differ from `cms.config.json`, `LIVE_BRANCH` and `DRAFT_BRANCH`.
4. Set the production branch to the one named as `liveBranch` in `cms.config.json`.

## Settings a site controls
`cms.config.json`: `repo`, `liveBranch`, `draftBranch`, `copy` (extra files to publish, like a style guide), page types.
`content/site.json` `seo`: `siteUrl`, `serviceArea`, `shareImage`, `allowAiCrawlers`, `redirects` (old address to new).
`cms/blocks.json`: the blocks the editor offers and their fields. Each block has a template in `templates/blocks/`.

## Updating a site to a newer engine
Change the tag in the site's `package.json` (`github:joeniemann/cms#v0.2.0`), run `npm install`, then
`npx cms build` and look at the result before pushing. Tags are listed on the repo's releases page.

## Rules for the engine
Nothing client-specific goes in this repo. Names, colors, copy and templates belong to the site.
The old snapshot folder `_old-snapshot-2026-10-13/` is ignored by git and can be deleted.
