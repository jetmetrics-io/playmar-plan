# Playmar reels plan

https://jetmetrics-io.github.io/playmar-plan/

What goes out where and when: videos, captions, hashtags. No sign-in; the page is marked noindex, nofollow.

- `data/plan.json`: the plan. Built from the source plan, do not edit here: the next publish overwrites it.
- `data/videos/`, `data/posters/`: the files to post and their covers.
- `data/stats.json`: numbers read off the statistics screenshots (the Аналитика tab). Screenshots themselves go to a
  private Yandex Cloud bucket through a function; uploading needs a code.
- Ticks are kept in the browser of whoever ticks them, not in this repo.

Fonts: Ubuntu, Ubuntu Font Licence 1.0 (`fonts/UFL.txt`). Icons: Lucide, ISC.
