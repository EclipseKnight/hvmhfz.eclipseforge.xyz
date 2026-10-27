# Page backgrounds

Monster Hunter Frontier pictures shown behind every page, one picked at random on each page load,
darkened and blurred (`js/background.js`, "page background" in `css/styles.css`). The folder is empty
for now: the repo had no Frontier screenshots or art we may publish, and the game client's files are
Capcom's, so nothing was copied from them or from the web.

## Adding a picture

1. Only pictures we may publish: screenshots the owner or a player took in game and agreed to share,
   or art with a licence that allows it. Note the source of each one in the table below.
2. Landscape, **1920 x 1080** (at least 1600 x 900), WebP, quality around 70, **under 300 KB**.
   The page blurs and darkens it, so fine detail and sharpness don't matter; a smaller file loads faster.
   Avoid text and UI in the picture.
3. Lowercase file name with dashes, for example `mezeporta-square.webp`.
4. Add the name to `IMAGES` in `js/background.js`, then run `python3 dev/check-site.py`
   (it fails when a listed picture is missing).

The first picture in the list is the one shown to visitors who ask for reduced motion.

Convert a screenshot: `cwebp -q 70 -resize 1920 0 shot.png -o assets/backgrounds/name.webp`.

| File | Source |
|---|---|
